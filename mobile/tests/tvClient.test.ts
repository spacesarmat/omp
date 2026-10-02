import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setTransport,
  tvState,
  tvError,
  connectTv,
  launchOnTv,
  pressButton,
  moveCursor,
  click,
  volume,
  typeText,
  deleteText,
  sendEnter,
  turnOffTv,
  disconnectTv,
  sessionIp,
  foregroundAppId,
  ompVersionOnTv,
  type TvTransport,
} from '../src/tv/tvClient';
import { tvs, saveTv, reloadTvs } from '../src/tv/tvStore';
import { native } from '../src/platform/native';

const TV = { ip: '192.168.1.5', name: 'LG' };

/** In-memory transport: records traffic, lets the test answer as the TV. */
class FakeTv implements TvTransport {
  sent: any[] = [];
  frames: string[] = [];
  pointerUrls: string[] = [];
  connects: { ip: string; register: any }[] = [];
  disconnects = 0;
  onRequest: ((msg: any) => void) | null = null;
  private msgCbs = new Set<(m: any) => void>();
  private closeCbs = new Set<(r: string) => void>();
  failPointerSend = 0;

  async tvConnect(ip: string, register: object) {
    this.connects.push({ ip, register });
  }
  async tvSend(message: object) {
    this.sent.push(message);
    this.onRequest?.(message);
  }
  onTvMessage(cb: (m: any) => void) {
    this.msgCbs.add(cb);
    return () => this.msgCbs.delete(cb);
  }
  onTvClosed(cb: (r: string) => void) {
    this.closeCbs.add(cb);
    return () => this.closeCbs.delete(cb);
  }
  async pointerConnect(url: string) {
    this.pointerUrls.push(url);
  }
  async pointerSend(frame: string) {
    if (this.failPointerSend > 0) {
      this.failPointerSend--;
      throw new Error('Пульт телевизора не подключён');
    }
    this.frames.push(frame);
  }
  async tvDisconnect() {
    this.disconnects++;
  }
  emit(m: any) {
    for (const cb of [...this.msgCbs]) cb(m);
  }
  close(reason = 'gone') {
    for (const cb of [...this.closeCbs]) cb(reason);
  }
  get listeners() {
    return this.msgCbs.size + this.closeCbs.size;
  }
  get lastRegister() {
    return this.connects[this.connects.length - 1].register;
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Answers every request with `{returnValue:true, ...extra}`; the pointer socket request gets a socketPath. */
function autoReply(fake: FakeTv) {
  fake.onRequest = (msg) => {
    const payload =
      msg.uri === 'ssap://com.webos.service.networkinput/getPointerInputSocket'
        ? { returnValue: true, socketPath: 'ws://192.168.1.5:3000/resources/abc/netinput.pointer.sock' }
        : { returnValue: true };
    queueMicrotask(() => fake.emit({ type: 'response', id: msg.id, payload }));
  };
}

async function connected(fake: FakeTv) {
  const p = connectTv(TV);
  await flush();
  fake.emit({ type: 'registered', id: fake.lastRegister.id, payload: { 'client-key': 'K' } });
  await p;
}

let fake: FakeTv;

beforeEach(() => {
  localStorage.clear();
  reloadTvs();
  fake = new FakeTv();
  setTransport(fake);
});

afterEach(async () => {
  vi.useRealTimers();
  await disconnectTv();
  setTransport(native);
});

describe('tvClient connection', () => {
  it('subscribes before connecting and walks through pairing', async () => {
    const order: string[] = [];
    const origMsg = fake.onTvMessage.bind(fake);
    fake.onTvMessage = (cb) => (order.push('listen'), origMsg(cb));
    const origConnect = fake.tvConnect.bind(fake);
    fake.tvConnect = (ip, r) => (order.push('connect'), origConnect(ip, r));

    const p = connectTv(TV);
    expect(tvState.value).toBe('connecting');
    await flush();
    expect(order).toEqual(['listen', 'connect']);
    expect(fake.connects[0].ip).toBe('192.168.1.5');
    const reg = fake.lastRegister;
    expect(reg.type).toBe('register');
    expect(reg.payload['client-key']).toBeUndefined();

    fake.emit({ type: 'response', id: reg.id, payload: { pairingType: 'PROMPT', returnValue: true } });
    expect(tvState.value).toBe('pairing');

    fake.emit({ type: 'registered', id: reg.id, payload: { 'client-key': 'K' } });
    await p;
    expect(tvState.value).toBe('connected');
    expect(tvs.value).toEqual([{ ip: '192.168.1.5', name: 'LG', clientKey: 'K' }]);
  });

  it('sends the saved client key', async () => {
    connectTv({ ...TV, clientKey: 'OLD' }).catch(() => {});
    await flush();
    expect(fake.lastRegister.payload['client-key']).toBe('OLD');
  });

  it('rejects when the user declines on the TV', async () => {
    const p = connectTv(TV);
    await flush();
    fake.emit({ type: 'error', id: fake.lastRegister.id, error: '403 cancelled' });
    await expect(p).rejects.toThrow('Подключение отклонено на телевизоре');
    expect(tvState.value).toBe('error');
    expect(tvError.value).toBe('Подключение отклонено на телевизоре');
  });

  it('retries with the unsigned manifest when the certificate is blacklisted', async () => {
    const p = connectTv(TV);
    await flush();
    const id = fake.lastRegister.id;
    fake.emit({ type: 'error', id, error: '403 blacklisted certificate detected' });
    await flush();
    const retry = fake.sent[fake.sent.length - 1];
    expect(retry.type).toBe('register');
    expect(retry.payload.manifest.signed).toBeUndefined();
    fake.emit({ type: 'registered', id: retry.id, payload: { 'client-key': 'K' } });
    await p;
    expect(tvState.value).toBe('connected');
  });

  it('times out when the TV does not answer', async () => {
    vi.useFakeTimers();
    const p = connectTv(TV);
    const assertion = expect(p).rejects.toThrow('Телевизор не отвечает');
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;
    expect(tvState.value).toBe('error');
  });

  it('fails when the socket cannot be opened', async () => {
    fake.tvConnect = async () => {
      throw new Error('ECONNREFUSED');
    };
    await expect(connectTv(TV)).rejects.toThrow('Телевизор не отвечает');
    expect(tvState.value).toBe('error');
    expect(fake.listeners).toBe(0);
  });

  it('goes idle when the TV closes the socket', async () => {
    await connected(fake);
    fake.close();
    expect(tvState.value).toBe('idle');
    expect(fake.listeners).toBe(0);
  });

  it('exposes the IP of the live session and clears it on disconnect', async () => {
    expect(sessionIp.value).toBeNull();
    connectTv(TV).catch(() => {});
    expect(sessionIp.value).toBe('192.168.1.5');
    await disconnectTv();
    expect(sessionIp.value).toBeNull();
  });

  it('disconnects without waiting for a close event', async () => {
    await connected(fake);
    await disconnectTv();
    expect(fake.disconnects).toBe(1);
    expect(tvState.value).toBe('idle');
    expect(fake.listeners).toBe(0);
  });

  it('gives the socket up to 12 s to open, then 8 s to answer', async () => {
    vi.useFakeTimers();
    let open!: () => void;
    fake.tvConnect = (ip, register) => {
      fake.connects.push({ ip, register });
      return new Promise<void>((r) => (open = r));
    };
    const p = connectTv(TV);
    const assertion = expect(p).rejects.toThrow('Телевизор не отвечает');
    await vi.advanceTimersByTimeAsync(10000);
    expect(tvState.value).toBe('connecting');
    open();
    await vi.advanceTimersByTimeAsync(7999);
    expect(tvState.value).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(tvState.value).toBe('error');
  });

  it('fails when the socket does not open in 12 s', async () => {
    vi.useFakeTimers();
    fake.tvConnect = () => new Promise<void>(() => {});
    const p = connectTv(TV);
    const assertion = expect(p).rejects.toThrow('Телевизор не отвечает');
    await vi.advanceTimersByTimeAsync(11999);
    expect(tvState.value).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });

  it('shares one connection between actions started while connecting', async () => {
    saveTv(TV);
    autoReply(fake);
    const a = volume('up');
    const b = typeText('x');
    await flush();
    expect(fake.connects).toHaveLength(1);
    fake.emit({ type: 'registered', id: fake.lastRegister.id, payload: { 'client-key': 'K' } });
    await expect(Promise.all([a, b])).resolves.toEqual([undefined, undefined]);
    expect(fake.sent.map((m) => m.uri)).toEqual(['ssap://audio/volumeUp', 'ssap://com.webos.service.ime/insertText']);
  });

  it('cancels pairing on disconnect', async () => {
    const p = connectTv(TV);
    await flush();
    fake.emit({ type: 'response', id: fake.lastRegister.id, payload: { pairingType: 'PROMPT' } });
    expect(tvState.value).toBe('pairing');
    await disconnectTv();
    await expect(p).rejects.toThrow('Телевизор не подключён');
    expect(tvState.value).toBe('idle');
    expect(fake.listeners).toBe(0);
    expect(fake.disconnects).toBe(1);
  });

  it('switches to another TV while the first one connects', async () => {
    const order: string[] = [];
    const origConnect = fake.tvConnect.bind(fake);
    fake.tvConnect = (ip, r) => (order.push(`connect ${ip}`), origConnect(ip, r));
    fake.tvDisconnect = async () => {
      order.push('disconnect');
      fake.disconnects++;
    };
    const first = connectTv(TV);
    await flush();
    const firstId = fake.lastRegister.id;
    const second = connectTv({ ip: '192.168.1.6', name: 'LG 2' });
    await expect(first).rejects.toThrow('Телевизор не подключён');
    await flush();
    expect(order).toEqual(['connect 192.168.1.5', 'disconnect', 'connect 192.168.1.6']);
    expect(fake.listeners).toBe(2);

    fake.emit({ type: 'registered', id: firstId, payload: { 'client-key': 'OLD' } });
    expect(tvState.value).toBe('connecting');
    fake.emit({ type: 'registered', id: fake.lastRegister.id, payload: { 'client-key': 'K2' } });
    await second;
    expect(tvState.value).toBe('connected');
    expect(tvs.value).toEqual([{ ip: '192.168.1.6', name: 'LG 2', clientKey: 'K2' }]);
  });
});

describe('tvClient commands', () => {
  it('launches OMP and resolves on the response', async () => {
    await connected(fake);
    const p = launchOnTv({ torrent: 'h' });
    await flush();
    const req = fake.sent[fake.sent.length - 1];
    expect(req).toMatchObject({
      type: 'request',
      uri: 'ssap://system.launcher/launch',
      payload: { id: 'com.spacesarmat.torrplayer', params: { torrent: 'h' } },
    });
    fake.emit({ type: 'response', id: req.id, payload: { returnValue: true } });
    await expect(p).resolves.toBeUndefined();
  });

  it('reports a missing OMP app', async () => {
    await connected(fake);
    const p = launchOnTv({ torrent: 'h' });
    await flush();
    const req = fake.sent[fake.sent.length - 1];
    fake.emit({ type: 'error', id: req.id, error: '404 no such app' });
    await expect(p).rejects.toThrow('На телевизоре нет OMP');
  });

  it('connects to the active TV before launching', async () => {
    saveTv({ ...TV, clientKey: 'K' });
    autoReply(fake);
    const p = launchOnTv({ torrent: 'h' });
    await flush();
    expect(fake.connects).toHaveLength(1);
    expect(fake.lastRegister.payload['client-key']).toBe('K');
    fake.emit({ type: 'registered', id: fake.lastRegister.id, payload: { 'client-key': 'K' } });
    await p;
    expect(fake.sent.some((m) => m.uri === 'ssap://system.launcher/launch')).toBe(true);
  });

  it('rejects when no TV is chosen', async () => {
    await expect(launchOnTv({ torrent: 'h' })).rejects.toThrow('Телевизор не подключён');
  });

  it('times out a request after 8 s, drops the dead socket and reconnects on the next action', async () => {
    await connected(fake);
    vi.useFakeTimers();
    const p = volume('up');
    const assertion = expect(p).rejects.toThrow('Телевизор не отвечает');
    await vi.advanceTimersByTimeAsync(7999);
    expect(tvState.value).toBe('connected');
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(tvState.value).toBe('error');
    expect(tvError.value).toBe('Телевизор не отвечает');
    expect(fake.disconnects).toBe(1);
    expect(fake.listeners).toBe(0);
    vi.useRealTimers();

    autoReply(fake);
    const next = volume('down');
    await flush();
    expect(fake.connects).toHaveLength(2);
    expect(fake.lastRegister.payload['client-key']).toBe('K');
    fake.emit({ type: 'registered', id: fake.lastRegister.id, payload: { 'client-key': 'K' } });
    await next;
    expect(tvState.value).toBe('connected');
    expect(fake.sent[fake.sent.length - 1].uri).toBe('ssap://audio/volumeDown');
  });

  it('opens the pointer socket once and sends button frames', async () => {
    await connected(fake);
    autoReply(fake);
    await pressButton('UP');
    expect(fake.sent.map((m) => m.uri)).toEqual(['ssap://com.webos.service.networkinput/getPointerInputSocket']);
    expect(fake.pointerUrls).toEqual(['ws://192.168.1.5:3000/resources/abc/netinput.pointer.sock']);
    expect(fake.frames).toEqual(['type:button\nname:UP\n\n']);

    await pressButton('CHANNELUP');
    await moveCursor(2, -1);
    await click();
    expect(fake.sent).toHaveLength(1);
    expect(fake.pointerUrls).toHaveLength(1);
    expect(fake.frames.slice(1)).toEqual([
      'type:button\nname:CHANNELUP\n\n',
      'type:move\ndx:2\ndy:-1\ndown:0\n\n',
      'type:click\n\n',
    ]);
  });

  it('reopens the pointer socket once when a frame fails', async () => {
    await connected(fake);
    autoReply(fake);
    await pressButton('UP');
    fake.failPointerSend = 1;
    await pressButton('DOWN');
    expect(fake.sent.filter((m) => m.uri === 'ssap://com.webos.service.networkinput/getPointerInputSocket')).toHaveLength(2);
    expect(fake.pointerUrls).toHaveLength(2);
    expect(fake.frames).toEqual(['type:button\nname:UP\n\n', 'type:button\nname:DOWN\n\n']);

    fake.failPointerSend = 2;
    await expect(pressButton('LEFT')).rejects.toThrow('Телевизор не подключён');
    expect(fake.pointerUrls).toHaveLength(3);
  });

  it('sends text, volume and power commands', async () => {
    await connected(fake);
    autoReply(fake);
    await typeText('abc');
    await deleteText(2);
    await sendEnter();
    await volume('up');
    await volume('down');
    await turnOffTv();
    expect(fake.sent.map((m) => [m.uri, m.payload])).toEqual([
      ['ssap://com.webos.service.ime/insertText', { text: 'abc', replace: 0 }],
      ['ssap://com.webos.service.ime/deleteCharacters', { count: 2 }],
      ['ssap://com.webos.service.ime/sendEnterKey', {}],
      ['ssap://audio/volumeUp', {}],
      ['ssap://audio/volumeDown', {}],
      ['ssap://system/turnOff', {}],
    ]);
  });

  it('reports a pointer permission error from the TV', async () => {
    await connected(fake);
    fake.onRequest = (msg) =>
      queueMicrotask(() => fake.emit({ type: 'error', id: msg.id, error: '401 insufficient permissions', payload: {} }));
    await expect(pressButton('UP')).rejects.toThrow('Телевизор не разрешил управление пультом');
    expect(tvState.value).toBe('connected');
    expect(fake.pointerUrls).toEqual([]);
  });

  it('does not drop a fresh pointer opened by a concurrent call', async () => {
    await connected(fake);
    autoReply(fake);
    await pressButton('UP');
    // Both frames fail on the old pointer; only one reopen should happen.
    fake.failPointerSend = 2;
    await Promise.all([pressButton('DOWN'), pressButton('LEFT')]);
    expect(fake.pointerUrls).toHaveLength(2);
    expect(fake.frames.slice(1).sort()).toEqual(['type:button\nname:DOWN\n\n', 'type:button\nname:LEFT\n\n']);
  });

  it('treats a close after turnOff as success', async () => {
    await connected(fake);
    fake.onRequest = () => queueMicrotask(() => fake.close());
    await expect(turnOffTv()).resolves.toBeUndefined();
    expect(tvState.value).toBe('idle');
    expect(fake.listeners).toBe(0);
  });

  it('treats a timeout after turnOff as success', async () => {
    await connected(fake);
    vi.useFakeTimers();
    const p = turnOffTv();
    const assertion = expect(p).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;
    expect(tvState.value).toBe('idle');
    expect(fake.disconnects).toBe(1);
  });

  it('rejects pending requests when the TV disconnects', async () => {
    await connected(fake);
    const p = volume('up');
    await flush();
    fake.close();
    await expect(p).rejects.toThrow('Телевизор не подключён');
  });
});

describe('tvClient app info', () => {
  const reply = (fn: (msg: any) => object | 'error') => {
    fake.onRequest = (msg) =>
      queueMicrotask(() => {
        const r = fn(msg);
        if (r === 'error') fake.emit({ type: 'error', id: msg.id, error: '500 boom' });
        else fake.emit({ type: 'response', id: msg.id, payload: { returnValue: true, ...r } });
      });
  };

  it('reads the foreground app id', async () => {
    await connected(fake);
    reply(() => ({ appId: 'com.spacesarmat.torrplayer' }));
    expect(await foregroundAppId()).toBe('com.spacesarmat.torrplayer');
    expect(fake.sent[fake.sent.length - 1].uri).toBe('ssap://com.webos.applicationManager/getForegroundAppInfo');
    reply(() => ({}));
    expect(await foregroundAppId()).toBeNull();
    reply(() => 'error');
    expect(await foregroundAppId()).toBeNull();
  });

  it('is null without a TV', async () => {
    expect(await foregroundAppId()).toBeNull();
    expect(await ompVersionOnTv()).toBeNull();
  });

  it('finds the OMP version in listApps and caches it per connection', async () => {
    await connected(fake);
    reply(() => ({ apps: [{ id: 'x', version: '1' }, { id: 'com.spacesarmat.torrplayer', version: '0.8.1' }] }));
    expect(await ompVersionOnTv()).toBe('0.8.1');
    expect(await ompVersionOnTv()).toBe('0.8.1');
    expect(fake.sent.filter((m) => m.uri.endsWith('listApps'))).toHaveLength(1);

    await disconnectTv();
    await connected(fake);
    reply(() => ({ apps: [{ id: 'com.spacesarmat.torrplayer', version: '0.9.0' }] }));
    expect(await ompVersionOnTv()).toBe('0.9.0');
  });

  it('is null when OMP is not installed or the TV errors, and does not cache that', async () => {
    await connected(fake);
    reply(() => ({ apps: [{ id: 'x', version: '1' }] }));
    expect(await ompVersionOnTv()).toBeNull();
    reply(() => 'error');
    expect(await ompVersionOnTv()).toBeNull();
    reply(() => ({ apps: [{ id: 'com.spacesarmat.torrplayer', version: '0.8.0' }] }));
    expect(await ompVersionOnTv()).toBe('0.8.0');
  });
});

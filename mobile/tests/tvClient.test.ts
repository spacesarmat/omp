import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setTransport,
  tvState,
  tvError,
  connectTv,
  launchOnTv,
  pressButton,
  moveCursor,
  scroll,
  click,
  volume,
  typeText,
  deleteText,
  sendEnter,
  turnOffTv,
  disconnectTv,
  sessionIp,
  tvWaking,
  warmUp,
  cancelWarmUp,
  foregroundAppId,
  ompVersionOnTv,
  macFromInfo,
  type TvTransport,
} from '../src/tv/tvClient';
import { tvs, saveTv, reloadTvs, setActiveTv } from '../src/tv/tvStore';
import { native } from '../src/platform/native';

const TV = { ip: '192.168.1.5', name: 'LG' };

/** In-memory transport: records traffic, lets the test answer as the TV. */
class FakeTv implements TvTransport {
  sent: any[] = [];
  frames: string[] = [];
  pointerUrls: string[] = [];
  connects: { ip: string; register: any; preferPort?: number }[] = [];
  /** Port the fake TV "opened" on. */
  openPort: number | undefined = 3001;
  disconnects = 0;
  onRequest: ((msg: any) => void) | null = null;
  private msgCbs = new Set<(m: any) => void>();
  private closeCbs = new Set<(r: string) => void>();
  failPointerSend = 0;

  async tvConnect(ip: string, register: object, preferPort?: 3000 | 3001) {
    this.connects.push({ ip, register, preferPort });
    return { port: (this.openPort ?? 3000) as 3000 | 3001 };
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

const buttonFrameOf = (n: string) => ['type:button', 'name:' + n, '', ''].join(String.fromCharCode(10));
const GETINFO_URI = 'ssap://com.webos.service.connectionmanager/getinfo';
const POINTER_URI = 'ssap://com.webos.service.networkinput/getPointerInputSocket';

/** Connects and answers the pointer-socket prefetch the client sends right after registering. */
async function connected(fake: FakeTv, pointer: 'ok' | 'denied' = 'ok') {
  const p = connectTv(TV);
  await flush();
  fake.emit({ type: 'registered', id: fake.lastRegister.id, payload: { 'client-key': 'K' } });
  await p;
  await flush();
  const req = fake.sent.find((m) => m.uri === POINTER_URI);
  if (req) {
    if (pointer === 'denied') fake.emit({ type: 'error', id: req.id, error: '401 insufficient permissions', payload: {} });
    else {
      fake.emit({
        type: 'response',
        id: req.id,
        payload: { returnValue: true, socketPath: 'ws://192.168.1.5:3000/resources/abc/netinput.pointer.sock' },
      });
    }
    await flush();
  }
}

let fake: FakeTv;

beforeEach(() => {
  localStorage.clear();
  reloadTvs();
  fake = new FakeTv();
  setTransport(fake);
});

afterEach(async () => {
  cancelWarmUp();
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
    fake.tvConnect = (ip, r, p) => (order.push('connect'), origConnect(ip, r, p));

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
    expect(tvs.value).toEqual([{ ip: '192.168.1.5', name: 'LG', defaultName: 'LG', clientKey: 'K', port: 3001 }]);
  });

  it('passes the saved port and stores the port that opened', async () => {
    fake.openPort = 3000;
    const p = connectTv({ ...TV, port: 3001 });
    await flush();
    expect(fake.connects[0].preferPort).toBe(3001);
    fake.emit({ type: 'registered', id: fake.lastRegister.id, payload: { 'client-key': 'K' } });
    await p;
    expect(tvs.value[0].port).toBe(3000);
  });

  it('stores the port even if the TV answers before tvConnect settles', async () => {
    let open!: () => void;
    fake.tvConnect = (ip, register) => {
      fake.connects.push({ ip, register });
      return new Promise<{ port: 3000 | 3001 }>((r) => (open = () => r({ port: 3001 })));
    };
    const p = connectTv(TV);
    await flush();
    fake.emit({ type: 'registered', id: fake.lastRegister.id, payload: { 'client-key': 'K' } });
    await p;
    open();
    await flush();
    expect(tvs.value[0].port).toBe(3001);
  });

  it('an LG answering on the IP of a saved Android TV is saved as LG (DHCP reuse)', async () => {
    saveTv({ ip: TV.ip, name: 'Старый ATV', kind: 'atv', token: 'a'.repeat(32), ctlPort: 8095 });
    const p = connectTv(TV);
    await flush();
    fake.emit({ type: 'registered', id: fake.lastRegister.id, payload: { 'client-key': 'K' } });
    await p;
    await flush();
    expect(tvs.value).toHaveLength(1);
    expect(tvs.value[0].kind).toBeUndefined();
    expect(tvs.value[0].token).toBeUndefined();
    expect(tvs.value[0].clientKey).toBe('K');
    expect(tvs.value[0].port).toBe(3001);
    reloadTvs();
    expect(tvs.value[0].kind).toBeUndefined();
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
      return new Promise<{ port: 3000 | 3001 }>((r) => (open = () => r({ port: 3000 })));
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
    fake.tvConnect = () => new Promise<{ port: 3000 | 3001 }>(() => {});
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
    expect(fake.sent.map((m) => m.uri).filter((u) => u !== POINTER_URI && u !== GETINFO_URI)).toEqual([
      'ssap://audio/volumeUp',
      'ssap://com.webos.service.ime/insertText',
    ]);
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
    fake.tvConnect = (ip, r, p) => (order.push(`connect ${ip}`), origConnect(ip, r, p));
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
    expect(tvs.value).toEqual([{ ip: '192.168.1.6', name: 'LG 2', defaultName: 'LG 2', clientKey: 'K2', port: 3001 }]);
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
    expect(fake.sent.map((m) => m.uri).filter((u) => u !== GETINFO_URI)).toEqual(['ssap://com.webos.service.networkinput/getPointerInputSocket']);
    expect(fake.pointerUrls).toEqual(['ws://192.168.1.5:3000/resources/abc/netinput.pointer.sock']);
    expect(fake.frames).toEqual(['type:button\nname:UP\n\n']);

    await pressButton('CHANNELUP');
    await moveCursor(2, -1);
    await scroll(0, 3);
    await click();
    expect(fake.sent.filter((m) => m.uri !== GETINFO_URI)).toHaveLength(1);
    expect(fake.pointerUrls).toHaveLength(1);
    expect(fake.frames.slice(1)).toEqual([
      'type:button\nname:CHANNELUP\n\n',
      'type:move\ndx:2\ndy:-1\ndown:0\n\n',
      'type:scroll\ndx:0\ndy:3\n\n',
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
    fake.sent.length = 0;
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
    await connected(fake, 'denied');
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

describe('tvClient early connect', () => {
  const REG = (f: FakeTv) => ({ type: 'registered', id: f.lastRegister.id, payload: { 'client-key': 'K' } });
  /** Lets the pending connect fail: the fake TV does not open the socket. */
  const failNextConnects = () => {
    fake.tvConnect = async (ip, register, preferPort) => {
      fake.connects.push({ ip, register, preferPort });
      throw new Error('no route');
    };
  };

  beforeEach(() => {
    saveTv({ ip: '192.168.1.5', name: 'LG' });
    setActiveTv('192.168.1.5');
    vi.useFakeTimers();
  });

  it('does nothing without an active TV', async () => {
    reloadTvs();
    localStorage.clear();
    reloadTvs();
    await warmUp();
    expect(fake.connects).toHaveLength(0);
    expect(tvState.value).toBe('idle');
  });

  it('retries every 1.5 s while the TV wakes and stops after success', async () => {
    failNextConnects();
    const p = warmUp();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.connects).toHaveLength(1);
    expect(tvWaking.value).toBe(true);
    await vi.advanceTimersByTimeAsync(1499);
    expect(fake.connects).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.connects).toHaveLength(2);
    // the TV is awake now
    fake.tvConnect = FakeTv.prototype.tvConnect.bind(fake);
    await vi.advanceTimersByTimeAsync(1500);
    expect(fake.connects).toHaveLength(3);
    fake.emit(REG(fake));
    await p;
    expect(tvState.value).toBe('connected');
    expect(tvWaking.value).toBe(false);
    await vi.advanceTimersByTimeAsync(10000);
    expect(fake.connects).toHaveLength(3);
  });

  it('gives up after 30 s', async () => {
    failNextConnects();
    const p = warmUp();
    await vi.advanceTimersByTimeAsync(60000);
    await p;
    expect(fake.connects).toHaveLength(21);
    expect(tvWaking.value).toBe(false);
  });

  it('stops when cancelled (app went to background)', async () => {
    failNextConnects();
    const p = warmUp();
    await vi.advanceTimersByTimeAsync(1600);
    expect(fake.connects).toHaveLength(2);
    cancelWarmUp();
    await p;
    await vi.advanceTimersByTimeAsync(10000);
    expect(fake.connects).toHaveLength(2);
    expect(tvWaking.value).toBe(false);
  });

  it('stops when the active TV changes', async () => {
    saveTv({ ip: '192.168.1.9', name: 'Other' });
    failNextConnects();
    const p = warmUp();
    await vi.advanceTimersByTimeAsync(1600);
    expect(fake.connects).toHaveLength(2);
    setActiveTv('192.168.1.9');
    await p;
    await vi.advanceTimersByTimeAsync(10000);
    expect(fake.connects).toHaveLength(2);
  });

  it('stops retrying once the TV shows the pairing prompt', async () => {
    const p = warmUp();
    await vi.advanceTimersByTimeAsync(0);
    fake.emit({ type: 'response', id: fake.lastRegister.id, payload: { pairingType: 'PROMPT', returnValue: true } });
    expect(tvState.value).toBe('pairing');
    // the user declines
    fake.emit({ type: 'error', id: fake.lastRegister.id, error: 'denied' });
    await p;
    await vi.advanceTimersByTimeAsync(10000);
    expect(fake.connects).toHaveLength(1);
  });

  it('does not start a second connect while connecting or connected', async () => {
    void warmUp();
    await vi.advanceTimersByTimeAsync(0);
    void warmUp();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.connects).toHaveLength(1);
  });

  it('opens the pointer socket right after connecting', async () => {
    const p = warmUp();
    await vi.advanceTimersByTimeAsync(0);
    fake.emit(REG(fake));
    await p;
    expect(fake.sent.map((m) => m.uri).filter((u) => u !== GETINFO_URI)).toEqual([POINTER_URI]);
    fake.emit({
      type: 'response',
      id: fake.sent[0].id,
      payload: { returnValue: true, socketPath: 'ws://192.168.1.5:3000/x' },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.pointerUrls).toEqual(['ws://192.168.1.5:3000/x']);
  });

  it('queues presses made while connecting and sends them in order', async () => {
    autoReply(fake);
    void warmUp();
    await vi.advanceTimersByTimeAsync(0);
    const sent = [pressButton('UP'), pressButton('DOWN'), pressButton('ENTER')];
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.frames).toEqual([]);
    fake.emit(REG(fake));
    await Promise.all(sent);
    expect(fake.frames).toEqual(['UP', 'DOWN', 'ENTER'].map((n) => buttonFrameOf(n)));
  });

  it('a warm-up on TV A does not kill a user connect to TV B', async () => {
    saveTv({ ip: '192.168.1.9', name: 'B' });
    failNextConnects();
    const p = warmUp();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.connects.map((c) => c.ip)).toEqual(['192.168.1.5']);
    // user taps TV B: ends A's session, B waits for pairing
    fake.tvConnect = async (ip, register, preferPort) => {
      fake.connects.push({ ip, register, preferPort });
      return { port: 3000 as const };
    };
    void connectTv({ ip: '192.168.1.9', name: 'B' }).catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    fake.emit({ type: 'response', id: fake.lastRegister.id, payload: { pairingType: 'PROMPT', returnValue: true } });
    await vi.advanceTimersByTimeAsync(3000);
    await p;
    expect(fake.connects.map((c) => c.ip)).toEqual(['192.168.1.5', '192.168.1.9']);
    expect(sessionIp.value).toBe('192.168.1.9');
    expect(tvState.value).toBe('pairing');
  });

  it('drops pointer moves made while connecting but queues buttons and clicks', async () => {
    autoReply(fake);
    void warmUp();
    await vi.advanceTimersByTimeAsync(0);
    const sent = [pressButton('UP'), moveCursor(5, 5), click()];
    await vi.advanceTimersByTimeAsync(0);
    fake.emit(REG(fake));
    await Promise.all(sent);
    expect(fake.frames).toEqual([buttonFrameOf('UP'), 'type:click\n\n']);
  });

  /** Pairing prompt shown, so the registration waits long enough for the TTL tests. */
  const startPairing = async () => {
    void warmUp();
    await vi.advanceTimersByTimeAsync(0);
    fake.emit({ type: 'response', id: fake.lastRegister.id, payload: { pairingType: 'PROMPT', returnValue: true } });
  };

  it('drops a queued press after 15 s silently, keeps a younger one', async () => {
    autoReply(fake);
    await startPairing();
    const old = pressButton('UP');
    await vi.advanceTimersByTimeAsync(14000);
    const young = pressButton('DOWN');
    await vi.advanceTimersByTimeAsync(2000);
    // the old one expired at 15 s (resolved, not rejected)
    await expect(old).resolves.toBeUndefined();
    expect(fake.frames).toEqual([]);
    fake.emit(REG(fake));
    await young;
    expect(fake.frames).toEqual([buttonFrameOf('DOWN')]);
  });

  it('sends nothing when every queued press expired before the connect', async () => {
    autoReply(fake);
    await startPairing();
    const a = pressButton('UP');
    const b = pressButton('DOWN');
    await vi.advanceTimersByTimeAsync(16000);
    fake.emit(REG(fake));
    await Promise.all([a, b]);
    expect(fake.frames).toEqual([]);
  });

  it('keeps at most 10 queued presses (the oldest are dropped silently)', async () => {
    autoReply(fake);
    await startPairing();
    const all = Array.from({ length: 12 }, (_, i) => pressButton(i < 2 ? 'LEFT' : 'UP'));
    fake.emit(REG(fake));
    await Promise.all(all);
    expect(fake.frames).toEqual(Array.from({ length: 10 }, () => buttonFrameOf('UP')));
  });

  it('surfaces the declined message to queued presses', async () => {
    await startPairing();
    const p = pressButton('UP');
    const settled = p.then(() => 'ok', (e) => e.message);
    await vi.advanceTimersByTimeAsync(0);
    fake.emit({ type: 'error', id: fake.lastRegister.id, error: 'denied' });
    await vi.advanceTimersByTimeAsync(0);
    expect(await settled).toBe('Подключение отклонено на телевизоре');
  });

  it('does not leave a tvError while the warm-up retries, only after it gives up', async () => {
    failNextConnects();
    const p = warmUp();
    await vi.advanceTimersByTimeAsync(3100);
    expect(tvState.value).toBe('error');
    expect(tvError.value).toBe('');
    await vi.advanceTimersByTimeAsync(60000);
    await p;
    expect(tvError.value).toBe('Телевизор не отвечает');
  });

  it('starts a new warm-up after the previous one was cancelled', async () => {
    failNextConnects();
    const p = warmUp();
    await vi.advanceTimersByTimeAsync(100);
    cancelWarmUp();
    void warmUp();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.connects).toHaveLength(2);
    cancelWarmUp();
    await p;
  });

  it('a pointer prefetch that never gets an answer does not drop the session', async () => {
    const p = warmUp();
    await vi.advanceTimersByTimeAsync(0);
    fake.emit(REG(fake));
    await p;
    expect(fake.sent.map((m) => m.uri).filter((u) => u !== GETINFO_URI)).toEqual([POINTER_URI]);
    await vi.advanceTimersByTimeAsync(8000);
    expect(tvState.value).toBe('connected');
    // the lazy path asks again
    autoReply(fake);
    const press = pressButton('UP');
    await vi.advanceTimersByTimeAsync(0);
    await press;
    expect(fake.sent.filter((m) => m.uri === POINTER_URI)).toHaveLength(2);
    expect(fake.frames).toEqual([buttonFrameOf('UP')]);
  });
});

describe('MAC for Wake-on-LAN', () => {
  const GETINFO = 'ssap://com.webos.service.connectionmanager/getinfo';

  it('macFromInfo prefers a connected wired adapter, else Wi-Fi, and normalises', () => {
    const ip = '192.168.1.5';
    expect(
      macFromInfo({ wiredInfo: { macAddress: 'AA-BB-CC-DD-EE-01', state: 'connected' }, wifiInfo: { macAddress: 'aa:bb:cc:dd:ee:02' } }, ip),
    ).toBe('aa:bb:cc:dd:ee:01');
    expect(
      macFromInfo({ wiredInfo: { macAddress: 'aa:bb:cc:dd:ee:01', state: 'disconnected' }, wifiInfo: { macAddress: 'aabbccddee02' } }, ip),
    ).toBe('aa:bb:cc:dd:ee:02');
    expect(macFromInfo({ wiredInfo: { macAddress: 'aa:bb:cc:dd:ee:01', ipAddress: ip } }, ip)).toBe('aa:bb:cc:dd:ee:01');
    expect(macFromInfo({ wifiInfo: { macAddress: 'junk' } }, ip)).toBeUndefined();
    expect(macFromInfo(null, ip)).toBeUndefined();
    expect(macFromInfo({}, ip)).toBeUndefined();
  });

  it('requests getinfo after connecting and saves the MAC', async () => {
    fake.onRequest = (msg) => {
      if (msg.uri !== GETINFO) return;
      queueMicrotask(() =>
        fake.emit({ type: 'response', id: msg.id, payload: { returnValue: true, wifiInfo: { macAddress: 'AA-BB-CC-DD-EE-FF' } } }),
      );
    };
    await connected(fake);
    await flush();
    expect(fake.sent.some((m) => m.uri === GETINFO)).toBe(true);
    expect(tvs.value[0].mac).toBe('aa:bb:cc:dd:ee:ff');
    expect(tvState.value).toBe('connected');
  });

  it('ignores a getinfo error', async () => {
    fake.onRequest = (msg) => {
      if (msg.uri !== GETINFO) return;
      queueMicrotask(() => fake.emit({ type: 'error', id: msg.id, error: '404 no such service', payload: {} }));
    };
    await connected(fake);
    await flush();
    expect(tvState.value).toBe('connected');
    expect(tvs.value[0].mac).toBeUndefined();
  });
});

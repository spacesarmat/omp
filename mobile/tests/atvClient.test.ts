import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import { mockFetch, type MockResponse } from '../../tests/helpers/fetchMock';
import {
  setTransport,
  tvState,
  tvError,
  connectTv,
  disconnectTv,
  launchOnTv,
  pressButton,
  pressAtvKey,
  volume,
  typeText,
  deleteText,
  sendEnter,
  turnOffTv,
  moveCursor,
  click,
  foregroundAppId,
  ompVersionOnTv,
  attachOnTv,
  pairAtv,
  tvKind,
  sessionIp,
  warmUp,
  cancelWarmUp,
  tvForgot,
  tvNoAnswer,
  atvBackground,
  pairBadCode,
  pairExpired,
  atvRejected,
  atvError,
  type TvTransport,
} from '../src/tv/tvClient';
import { tvs, activeTv, saveTv, reloadTvs, type SavedTv } from '../src/tv/tvStore';
import { native } from '../src/platform/native';
import { toast } from '../src/ui/toast';

const TOKEN = '0123456789abcdef0123456789abcdef';
const ATV: SavedTv = { ip: '192.168.1.40', name: 'Гостиная', kind: 'atv', token: TOKEN, ctlPort: 8095 };
const BASE = 'http://192.168.1.40:8095';

interface Call {
  url: string;
  method: string;
  auth?: string;
  body: any;
}

let calls: Call[];
let info: { name: string; version: string; paired: boolean; foreground: boolean };
let route: (c: Call) => MockResponse | Promise<MockResponse> | null;

/** A fake OMP control server: GET /omp/info answers `info`, POSTs answer ok unless `route` says otherwise. */
function server() {
  return mockFetch((url, init) => {
    const c: Call = {
      url,
      method: init.method || 'GET',
      auth: init.headers?.Authorization,
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(c);
    const r = route(c);
    if (r) return r;
    if (url === BASE + '/omp/info') return { body: JSON.stringify({ ...info, paired: info.paired && c.auth === 'Bearer ' + TOKEN }) };
    return { body: '{"ok":true}' };
  });
}

/** Fails the test if the SSAP transport is touched. */
const noSsap: TvTransport = {
  tvConnect: () => Promise.reject(new Error('ssap used')),
  tvSend: () => Promise.reject(new Error('ssap used')),
  onTvMessage: () => () => {},
  onTvClosed: () => () => {},
  pointerConnect: () => Promise.reject(new Error('ssap used')),
  pointerSend: () => Promise.reject(new Error('ssap used')),
  tvDisconnect: () => Promise.resolve(),
};

const flush = () => new Promise((r) => setTimeout(r, 0));
const posts = (path: string) => calls.filter((c) => c.method === 'POST' && c.url === BASE + path).map((c) => c.body);

beforeEach(() => {
  localStorage.clear();
  reloadTvs();
  calls = [];
  info = { name: 'Гостиная', version: '0.10.0', paired: true, foreground: true };
  route = () => null;
  toast.value = '';
  setTransport(noSsap);
  server();
});

afterEach(async () => {
  cancelWarmUp();
  vi.useRealTimers();
  await disconnectTv();
  setTransport(native);
  vi.unstubAllGlobals();
});

describe('Android TV transport', () => {
  it('connects with GET /omp/info and the bearer token, no socket', async () => {
    await connectTv(ATV);
    expect(tvState.value).toBe('connected');
    expect(sessionIp.value).toBe('192.168.1.40');
    expect(tvKind()).toBe('atv');
    expect(calls).toEqual([{ url: BASE + '/omp/info', method: 'GET', auth: 'Bearer ' + TOKEN, body: undefined }]);
    expect(activeTv.value).toMatchObject({ ip: '192.168.1.40', kind: 'atv', token: TOKEN });
  });

  it('a TV that forgot the phone ends in an error asking to pair again', async () => {
    info.paired = false;
    await expect(connectTv(ATV)).rejects.toThrow(tvForgot());
    expect(tvState.value).toBe('error');
    expect(tvError.value).toBe('Телевизор забыл этот телефон — подключитесь заново кодом');
  });

  it('an unreachable TV is «Телевизор не отвечает»', async () => {
    route = () => Promise.reject(new TypeError('Failed to fetch'));
    await expect(connectTv(ATV)).rejects.toThrow(tvNoAnswer());
    expect(tvState.value).toBe('error');
    expect(tvError.value).toBe(tvNoAnswer());
  });

  it('gives up on a silent TV after 5 s', async () => {
    vi.useFakeTimers();
    route = () => new Promise(() => {});
    const p = connectTv(ATV);
    const done = expect(p).rejects.toThrow(tvNoAnswer());
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    expect(tvState.value).toBe('error');
  });

  it('uses the saved control port', async () => {
    route = (c) => (c.url.startsWith('http://192.168.1.40:9000/') ? { body: JSON.stringify({ ...info }) } : null);
    await connectTv({ ...ATV, ctlPort: 9000 });
    expect(calls[0].url).toBe('http://192.168.1.40:9000/omp/info');
  });

  it('launches with POST /omp/launch {params}', async () => {
    saveTv(ATV);
    await launchOnTv({ server: 'http://192.168.1.2:8090', torrent: 'abc', file: 1, t: 0 });
    expect(posts('/omp/launch')).toEqual([{ params: { server: 'http://192.168.1.2:8090', torrent: 'abc', file: 1, t: 0, lang: 'ru' } }]);
    expect(calls.find((c) => c.url === BASE + '/omp/launch')!.auth).toBe('Bearer ' + TOKEN);
  });

  it('warns when OMP stayed in the background after a launch', async () => {
    saveTv(ATV);
    await connectTv(ATV);
    vi.useFakeTimers();
    info.foreground = false;
    await launchOnTv({ server: 's', torrent: 'h' });
    expect(toast.value).toBe('');
    await vi.advanceTimersByTimeAsync(3000);
    expect(toast.value).toBe('Откройте OMP на телевизоре — Android не даёт вывести его на экран из фона');
    expect(atvBackground()).toBe(toast.value);
  });

  it('no warning when OMP came to the front', async () => {
    saveTv(ATV);
    await connectTv(ATV);
    vi.useFakeTimers();
    await launchOnTv({ server: 's', torrent: 'h' });
    await vi.advanceTimersByTimeAsync(3000);
    expect(toast.value).toBe('');
  });

  it('remote keys, text and volume go to /omp/*', async () => {
    saveTv(ATV);
    await pressButton('UP');
    await pressButton('ENTER');
    await pressButton('BACK');
    await pressAtvKey('CATALOG');
    await pressAtvKey('NOWPLAYING');
    await volume('up');
    await volume('down');
    await typeText('Дюна');
    await deleteText(2);
    await sendEnter();
    expect(posts('/omp/key')).toEqual([
      { name: 'UP' },
      { name: 'ENTER' },
      { name: 'BACK' },
      { name: 'CATALOG' },
      { name: 'NOWPLAYING' },
    ]);
    expect(posts('/omp/volume')).toEqual([{ dir: 'up' }, { dir: 'down' }]);
    expect(posts('/omp/text')).toEqual([{ text: 'Дюна' }, { delete: 2 }, { enter: true }]);
  });

  it('LG-only actions are refused for Android TV', async () => {
    saveTv(ATV);
    await expect(pressButton('HOME')).rejects.toThrow('Недоступно на Android TV');
    await expect(turnOffTv()).rejects.toThrow('Недоступно на Android TV');
    await expect(moveCursor(1, 1)).rejects.toThrow('Недоступно на Android TV');
    await expect(click()).rejects.toThrow('Недоступно на Android TV');
  });

  it('a 401 on a command turns into «forgot this phone»', async () => {
    saveTv(ATV);
    await connectTv(ATV);
    route = (c) => (c.method === 'POST' ? { status: 401, body: '{"error":"unauthorized"}' } : null);
    await expect(pressButton('UP')).rejects.toThrow(tvForgot());
    expect(tvState.value).toBe('error');
    expect(tvError.value).toBe(tvForgot());
  });

  it('a forgetful TV drops the saved token (the next tap asks for a code)', async () => {
    saveTv(ATV);
    info.paired = false;
    await expect(connectTv(activeTv.value!)).rejects.toThrow(tvForgot());
    expect(tvs.value[0].token).toBeUndefined();
    expect(tvs.value[0].kind).toBe('atv');
  });

  it('a 401 on a command drops the saved token', async () => {
    saveTv(ATV);
    await connectTv(ATV);
    route = (c) => (c.method === 'POST' ? { status: 401, body: '{"error":"unauthorized"}' } : null);
    await expect(pressButton('UP')).rejects.toThrow(tvForgot());
    expect(activeTv.value?.token).toBeUndefined();
  });

  it('server error codes are shown in Russian', async () => {
    saveTv(ATV);
    await connectTv(ATV);
    route = (c) => (c.method === 'POST' ? { status: 400, body: '{"error":"bad_request"}' } : null);
    await expect(pressButton('UP')).rejects.toThrow(atvRejected());
    expect(atvRejected()).toBe('Телевизор отклонил запрос');
    route = (c) => (c.method === 'POST' ? { status: 500, body: '{"error":"internal"}' } : null);
    const e = await pressButton('UP').catch((x: Error) => x);
    expect((e as Error).message).toBe(atvError());
    expect(atvError()).toBe('Телевизор ответил ошибкой');
    expect((e as Error).message).not.toMatch(/internal|500|bad_request|400/);
  });

  it('foreground app and OMP version come from /omp/info', async () => {
    saveTv(ATV);
    expect(await foregroundAppId()).toBe('com.spacesarmat.torrplayer');
    info.foreground = false;
    expect(await foregroundAppId()).toBeNull();
    expect(await ompVersionOnTv()).toBe('0.10.0');
  });

  it('launch and attach carry the phone resolved language', async () => {
    saveTv(ATV);
    applyLanguageSetting('en');
    await launchOnTv({ open: 'update' });
    await attachOnTv('http://192.168.1.2:8123/omp/x');
    expect(posts('/omp/launch')).toEqual([{ params: { open: 'update', lang: 'en' } }]);
    expect(posts('/omp/attach')).toEqual([{ report: 'http://192.168.1.2:8123/omp/x', lang: 'en' }]);
  });

  it('attach posts the report URL', async () => {
    saveTv(ATV);
    await attachOnTv('http://192.168.1.2:8123/omp/x');
    expect(posts('/omp/attach')).toEqual([{ report: 'http://192.168.1.2:8123/omp/x', lang: 'ru' }]);
  });

  it('warm-up stops at once when the TV forgot the phone', async () => {
    saveTv(ATV);
    info.paired = false;
    await warmUp();
    expect(calls.filter((c) => c.url === BASE + '/omp/info')).toHaveLength(1);
    expect(tvError.value).toBe(tvForgot());
  });

  it('warm-up retries an unreachable TV', async () => {
    vi.useFakeTimers();
    saveTv(ATV);
    let n = 0;
    route = (c) => (c.url === BASE + '/omp/info' && n++ < 1 ? Promise.reject(new TypeError('x')) : null);
    const p = warmUp();
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(tvState.value).toBe('connected');
  });

  it('switching to an LG TV drops the Android TV session', async () => {
    await connectTv(ATV);
    const lg: string[] = [];
    setTransport({ ...noSsap, tvConnect: async (ip) => (lg.push(ip), { port: 3000 }) });
    expect(tvState.value).toBe('idle');
    void connectTv({ ip: '192.168.1.5', name: 'LG' }).catch(() => {});
    await flush();
    expect(lg).toEqual(['192.168.1.5']);
    expect(tvKind()).toBe('lg');
  });
});

describe('pairing with an Android TV', () => {
  const FOUND = { ip: '192.168.1.40', port: 8095, name: 'Гостиная', version: '0.10.0' };

  it('posts the code, saves the TV with its token and connects', async () => {
    route = (c) => (c.url === BASE + '/omp/pair' ? { body: JSON.stringify({ token: TOKEN }) } : null);
    await pairAtv(FOUND, '0482');
    expect(posts('/omp/pair')).toEqual([{ code: '0482', phone: 'Телефон' }]);
    expect(tvs.value).toEqual([
      { ip: '192.168.1.40', name: 'Гостиная', defaultName: 'Гостиная', kind: 'atv', token: TOKEN, ctlPort: 8095, usedAt: expect.any(Number) },
    ]);
    expect(activeTv.value?.ip).toBe('192.168.1.40');
    expect(tvState.value).toBe('connected');
  });

  it('a wrong code is «Неверный код»', async () => {
    route = (c) => (c.url === BASE + '/omp/pair' ? { status: 403, body: '{"error":"bad_code"}' } : null);
    await expect(pairAtv(FOUND, '1111')).rejects.toThrow(pairBadCode());
    expect(pairBadCode()).toBe('Неверный код');
    expect(tvs.value).toEqual([]);
  });

  it('an expired code asks for a new one', async () => {
    route = (c) => (c.url === BASE + '/omp/pair' ? { status: 403, body: '{"error":"expired"}' } : null);
    await expect(pairAtv(FOUND, '1111')).rejects.toThrow(pairExpired());
    expect(pairExpired()).toBe('Код устарел — нажмите «Новый код» на телевизоре');
  });

  it('an unreachable TV is «Телевизор не отвечает»', async () => {
    route = () => Promise.reject(new TypeError('x'));
    await expect(pairAtv(FOUND, '1111')).rejects.toThrow(tvNoAnswer());
  });

  it('other pairing answers are Russian, never a raw code', async () => {
    route = (c) => (c.url === BASE + '/omp/pair' ? { status: 415, body: '{"error":"unsupported_media_type"}' } : null);
    await expect(pairAtv(FOUND, '1111')).rejects.toThrow(/^Телевизор отклонил запрос$/);
    route = (c) => (c.url === BASE + '/omp/pair' ? { status: 500, body: '{"error":"internal"}' } : null);
    await expect(pairAtv(FOUND, '1111')).rejects.toThrow(/^Телевизор ответил ошибкой$/);
    route = (c) => (c.url === BASE + '/omp/pair' ? { body: '{"token":"short"}' } : null);
    await expect(pairAtv(FOUND, '1111')).rejects.toThrow(/^Телевизор ответил ошибкой$/);
    expect(tvs.value).toEqual([]);
  });

  it('a failed connect after pairing keeps the TV and reports the error in tvState', async () => {
    route = (c) => {
      if (c.url === BASE + '/omp/pair') return { body: JSON.stringify({ token: TOKEN }) };
      if (c.url === BASE + '/omp/info') return Promise.reject(new TypeError('x'));
      return null;
    };
    await pairAtv(FOUND, '0482');
    expect(tvs.value[0]).toMatchObject({ ip: '192.168.1.40', kind: 'atv', token: TOKEN });
    expect(activeTv.value?.ip).toBe('192.168.1.40');
    expect(tvState.value).toBe('error');
    expect(tvError.value).toBe(tvNoAnswer());
  });

  it('re-pairing a forgotten TV uses the new token', async () => {
    saveTv({ ...ATV, token: 'ffffffffffffffffffffffffffffffff' });
    await expect(connectTv(activeTv.value!)).rejects.toThrow(tvForgot());
    route = (c) => (c.url === BASE + '/omp/pair' ? { body: JSON.stringify({ token: TOKEN }) } : null);
    await pairAtv(FOUND, '0482');
    expect(tvState.value).toBe('connected');
    expect(activeTv.value?.token).toBe(TOKEN);
  });
});

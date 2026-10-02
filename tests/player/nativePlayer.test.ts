import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  NativeSession, toNativeQueue, nativeHeading, sanitizeNativeState, nativeSnapshot,
} from '../../src/player/nativePlayer';
import type { OmpNativeTvPlugin } from '../../src/platform/androidNative';
import { TorrServerClient } from '../../src/api/torrserver';
import { getLocalProgress, reloadProgress } from '../../src/store/progress';
import type { PlayItem } from '../../src/player/types';

const H1 = 'a'.repeat(40);

const queue: PlayItem[] = [
  {
    url: 'http://h:1/stream/e1.mkv?link=' + H1 + '&index=1&play', title: 'Show.S01E01.mkv', hash: H1, fileIndex: 1,
    torrentTitle: 'Show', poster: 'http://p/1.jpg',
    subtitles: [{ url: 'http://h:1/stream/e1.srt?link=' + H1 + '&index=5&play', label: 'rus', ext: 'srt' }],
  },
  { url: 'http://h:1/stream/e2.mkv?link=' + H1 + '&index=2&play', title: 'Show.S01E02.mkv', hash: H1, fileIndex: 2, torrentTitle: 'Show' },
];

function fakePlugin() {
  const listeners: { [e: string]: ((d: any) => void)[] } = {};
  const removed: string[] = [];
  const plugin = {
    localIpv4: vi.fn(),
    downloadAndInstallApk: vi.fn(),
    playNative: vi.fn((_o: any) => Promise.resolve()),
    nativePlayerCommand: vi.fn((_o: any) => Promise.resolve()),
    addListener: vi.fn((event: string, cb: (d: any) => void) => {
      (listeners[event] = listeners[event] || []).push(cb);
      return Promise.resolve({ remove: () => { removed.push(event); listeners[event] = listeners[event].filter((x) => x !== cb); } });
    }),
  };
  return {
    plugin: plugin as unknown as OmpNativeTvPlugin & typeof plugin,
    emit: (e: string, d: any) => (listeners[e] || []).slice().forEach((cb) => cb(d)),
    listeners, removed,
  };
}

function fakeClient() {
  const setViewed = vi.fn((_h: string, _i: number, _t?: number) => Promise.resolve());
  const c = { videoSrc: (u: string) => u.replace('http://', 'http://u:p@'), setViewed };
  return { c: c as unknown as TorrServerClient, setViewed };
}

const opts = { index: 0, startAt: 125, seekStep: 10, autoNext: true, audioLang: 'ru', subLang: 'ru', subtitlesOn: false };

function state(over: any = {}) {
  return {
    index: 0, time: 30, duration: 1000, paused: false, buffering: false,
    audio: { list: ['Русский · AC3 5.1', 'English'], sel: 0 },
    subs: { list: [{ label: 'Выкл', value: 'off' }, { label: 'Русские (файл)', value: 'x0' }], sel: 'off' },
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
  reloadProgress();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('native queue', () => {
  it('heading: torrent · episode · title without repeats', () => {
    expect(nativeHeading(queue[0])).toBe('Show · S01E01 · Show.S01E01.mkv');
    expect(nativeHeading({ url: 'x', title: 'Film' })).toBe('Film');
    expect(nativeHeading({ url: 'x', title: 'Film', torrentTitle: 'Film' })).toBe('Film');
  });
  it('carries credentials in own stream and subtitle URLs', () => {
    const real = new TorrServerClient({ url: 'http://h:1', user: 'u', password: 'p' });
    const q = toNativeQueue(queue, real);
    expect(q[0].url).toBe('http://u:p@h:1/stream/e1.mkv?link=' + H1 + '&index=1&play');
    expect(q[0].subtitles).toEqual([{ url: 'http://u:p@h:1/stream/e1.srt?link=' + H1 + '&index=5&play', label: 'rus', ext: 'srt', lang: 'ru' }]);
    expect(q[0].hash).toBe(H1);
    expect(q[0].fileIndex).toBe(1);
    expect(q[1].subtitles).toEqual([]);
    expect(toNativeQueue(queue, null)[0].url).toBe(queue[0].url);
  });
});

describe('native state', () => {
  it('sanitizes malformed events', () => {
    expect(sanitizeNativeState(null)).toBeNull();
    expect(sanitizeNativeState({ index: -1 })).toBeNull();
    const s = sanitizeNativeState({ index: 1, time: 'x', duration: 50, paused: true, audio: { list: ['a', 3], sel: 7 }, subs: 5 })!;
    expect(s).toEqual({
      index: 1, time: 0, duration: 50, paused: true, buffering: false,
      audio: { list: ['a'], sel: -1 }, subs: { list: [{ label: 'Выкл', value: 'off' }], sel: 'off' },
    });
  });
  it('builds the phone snapshot like the HTML5 player', () => {
    const snap = nativeSnapshot(queue, sanitizeNativeState(state({ paused: true, subs: { list: state().subs.list, sel: 'x0' } })))!;
    expect(snap).toEqual({
      hash: H1, file: 1, title: 'Show.S01E01.mkv', subtitle: 'Show · S01E01', poster: 'http://p/1.jpg',
      time: 30, duration: 1000, paused: true, buffering: false,
      audio: { list: ['Русский · AC3 5.1', 'English'], sel: 0 },
      subs: { list: [{ label: 'Выкл', value: 'off' }, { label: 'Русские (файл)', value: 'x0' }], sel: 'x0' },
      next: { title: 'Show.S01E02.mkv' },
    });
    expect(nativeSnapshot(queue, null)).toBeNull();
  });
});

describe('NativeSession', () => {
  it('registers listeners before playNative and passes queue and options', async () => {
    const f = fakePlugin();
    const { c } = fakeClient();
    const order: string[] = [];
    f.plugin.addListener.mockImplementation((e: string) => { order.push('listen:' + e); return Promise.resolve({ remove: () => undefined }); });
    f.plugin.playNative.mockImplementation(() => { order.push('play'); return Promise.resolve(); });
    await new NativeSession(f.plugin, c, queue).start(opts);
    expect(order).toEqual(['listen:nativePlayerState', 'listen:nativePlayerClosed', 'play']);
    const arg = f.plugin.playNative.mock.calls[0][0];
    expect(typeof arg.session).toBe('number');
    expect(arg).toEqual({
      queue: toNativeQueue(queue, c), index: 0, startAt: 125, session: arg.session, seekStep: 10, autoNext: true,
      audioLang: 'ru', subLang: 'ru', subtitlesOn: false,
    });
    expect(arg.queue[0].url.indexOf('http://u:p@h:1/')).toBe(0);
  });

  it('saves locally every 5 s and to the server every 15 s (driven by state events)', async () => {
    const f = fakePlugin();
    const { c, setViewed } = fakeClient();
    const s = new NativeSession(f.plugin, c, queue);
    await s.start(opts);
    f.emit('nativePlayerState', state({ time: 200 }));
    expect(getLocalProgress(H1, 1)).toBeNull();
    vi.advanceTimersByTime(5000);
    f.emit('nativePlayerState', state({ time: 205 }));
    expect(getLocalProgress(H1, 1)!.time).toBe(205);
    expect(setViewed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4000);
    f.emit('nativePlayerState', state({ time: 209 }));
    expect(getLocalProgress(H1, 1)!.time).toBe(205);
    vi.advanceTimersByTime(6000);
    f.emit('nativePlayerState', state({ time: 215.7 }));
    expect(setViewed).toHaveBeenCalledWith(H1, 1, 215);
    expect(getLocalProgress(H1, 1)!.time).toBe(215.7);
    s.dispose();
  });

  it('item change saves the previous item; watched → server timecode 0', async () => {
    const f = fakePlugin();
    const { c, setViewed } = fakeClient();
    const s = new NativeSession(f.plugin, c, queue);
    await s.start(opts);
    f.emit('nativePlayerState', state({ time: 950 }));
    f.emit('nativePlayerState', state({ index: 1, time: 2, duration: 900 }));
    expect(setViewed).toHaveBeenCalledWith(H1, 1, 0);
    expect(getLocalProgress(H1, 1)!.time).toBe(950);
    expect(s.state!.index).toBe(1);
    s.dispose();
  });

  it('closed: final save, listeners removed, hook called; later events ignored', async () => {
    const f = fakePlugin();
    const { c, setViewed } = fakeClient();
    const closed = vi.fn();
    const s = new NativeSession(f.plugin, c, queue, { onClosed: closed });
    await s.start(opts);
    f.emit('nativePlayerState', state({ time: 300 }));
    f.emit('nativePlayerClosed', { index: 0, time: 320.4, duration: 1000 });
    expect(closed).toHaveBeenCalledWith({ index: 0, time: 320.4, duration: 1000 }, false);
    expect(getLocalProgress(H1, 1)!.time).toBe(320.4);
    expect(setViewed).toHaveBeenCalledWith(H1, 1, 320);
    expect(f.removed.sort()).toEqual(['nativePlayerClosed', 'nativePlayerState']);
    expect(s.snapshot()).toBeNull();
    setViewed.mockClear();
    await vi.advanceTimersByTimeAsync(30000);
    expect(setViewed).not.toHaveBeenCalled();
    s.dispose();
    expect(setViewed).not.toHaveBeenCalled();
  });

  it('snapshot from the latest state; phone commands go to nativePlayerCommand', async () => {
    const f = fakePlugin();
    const onState = vi.fn();
    const s = new NativeSession(f.plugin, null, queue, { onState });
    await s.start(opts);
    expect(s.snapshot()).toBeNull();
    f.emit('nativePlayerState', state({ time: 40 }));
    expect(onState).toHaveBeenCalledTimes(1);
    expect(s.snapshot()!.time).toBe(40);
    f.emit('nativePlayerState', state({ index: 9 }));
    expect(onState).toHaveBeenCalledTimes(1);
    s.exec({ id: 3, type: 'skip', d: 30 });
    expect(f.plugin.nativePlayerCommand).toHaveBeenCalledWith({ cmd: { id: 3, type: 'skip', d: 30 } });
    s.dispose();
    s.exec({ id: 4, type: 'pause' });
    expect(f.plugin.nativePlayerCommand).toHaveBeenCalledTimes(1);
  });

  it('ignores events of another run; a replaced close does not navigate', async () => {
    const f = fakePlugin();
    const closed = vi.fn();
    const s = new NativeSession(f.plugin, null, queue, { onClosed: closed });
    await s.start(opts);
    const sid = f.plugin.playNative.mock.calls[0][0].session;
    f.emit('nativePlayerState', state({ time: 77, session: sid + 1000 }));
    expect(s.state).toBeNull();
    f.emit('nativePlayerState', state({ time: 78, session: sid }));
    expect(s.state!.time).toBe(78);
    f.emit('nativePlayerClosed', { index: 0, time: 80, duration: 1000, session: sid + 1000 });
    expect(closed).not.toHaveBeenCalled();
    f.emit('nativePlayerClosed', { index: 0, time: 80, duration: 1000, session: sid, replaced: true });
    expect(closed).toHaveBeenCalledWith({ index: 0, time: 80, duration: 1000 }, true);
  });

  it('a playNative failure rejects and releases the listeners', async () => {
    const f = fakePlugin();
    f.plugin.playNative.mockImplementation(() => Promise.reject({ message: 'Нет плеера' }));
    const s = new NativeSession(f.plugin, null, queue);
    await expect(s.start(opts)).rejects.toEqual({ message: 'Нет плеера' });
    expect(f.removed.length).toBe(2);
  });

  it('dispose before the listeners resolve still removes them', async () => {
    const f = fakePlugin();
    const s = new NativeSession(f.plugin, null, queue);
    const p = s.start(opts);
    s.dispose();
    await p;
    expect(f.removed.length).toBe(2);
    expect(f.plugin.playNative).not.toHaveBeenCalled();
  });
});

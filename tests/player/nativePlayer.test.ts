import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  NativeSession, toNativeQueue, nativeHeading, sanitizeNativeState, nativeSnapshot, nativePlayerOpen,
} from '../../src/player/nativePlayer';
import type { OmpNativeTvPlugin } from '../../src/platform/androidNative';
import { TorrServerClient } from '../../src/api/torrserver';
import { getLocalProgress, reloadProgress, saveProgress } from '../../src/store/progress';
import { decideStart } from '../../src/player/resume';
import type { PlayItem } from '../../src/player/types';
import { WatchJournal, journalSource } from '../../src/player/watchJournal';

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
const sessions: NativeSession[] = [];
function track(s: NativeSession): NativeSession {
  sessions.push(s);
  return s;
}

afterEach(() => {
  sessions.splice(0).forEach((s) => s.dispose());
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
  it('carries the resume point of each item (0 when none or nearly watched)', () => {
    saveProgress(H1, 2, 400, 1000);
    saveProgress(H1, 1, 950, 1000);
    const q = toNativeQueue(queue.concat([{ url: 'http://x/y.mkv', title: 'y' }]), null);
    expect(q.map((i) => i.resume)).toEqual([0, 400, 0]);
  });
  it('decideStart without asking uses the saved position', async () => {
    saveProgress(H1, 2, 400, 1000);
    expect(await decideStart(queue[1], undefined, false)).toBe(400);
    expect(await decideStart(queue[0], undefined, false)).toBe(0);
    expect(await decideStart(queue[1], 12, false)).toBe(12);
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
    await track(new NativeSession(f.plugin, c, queue)).start(opts);
    expect(order).toEqual(['listen:nativePlayerState', 'listen:nativePlayerClosed', 'listen:nativePlayerMark', 'play']);
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
    const s = track(new NativeSession(f.plugin, c, queue));
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
    const s = track(new NativeSession(f.plugin, c, queue));
    await s.start(opts);
    f.emit('nativePlayerState', state({ time: 950 }));
    f.emit('nativePlayerState', state({ index: 1, time: 2, duration: 900 }));
    expect(setViewed).toHaveBeenCalledWith(H1, 1, 0);
    expect(getLocalProgress(H1, 1)!.time).toBe(950);
    expect(s.state!.index).toBe(1);
    s.dispose();
  });

  it('watch journal: start once open, item change ends and starts, close ends; once per item', async () => {
    const f = fakePlugin();
    const { c } = fakeClient();
    const rec = vi.fn();
    const s = track(new NativeSession(f.plugin, c, queue, {}, new WatchJournal(rec, journalSource('Pixel'))));
    await s.start(opts);
    expect(rec.mock.calls).toEqual([[H1, { f: 1, t: 125, d: 0, src: 'phone', name: 'Pixel' }]]);
    for (let i = 0; i < 30; i++) f.emit('nativePlayerState', state({ time: 130 + i }));
    expect(rec).toHaveBeenCalledTimes(1);
    f.emit('nativePlayerState', state({ index: 1, time: 3, duration: 900 }));
    f.emit('nativePlayerClosed', { index: 1, time: 400, duration: 900 });
    expect(rec.mock.calls.slice(1).map((x) => [x[1].f, x[1].t, x[1].d])).toEqual([[1, 159, 1000], [2, 3, 900], [2, 400, 900]]);
  });

  it('closed: final save, listeners removed, hook called; later events ignored', async () => {
    const f = fakePlugin();
    const { c, setViewed } = fakeClient();
    const closed = vi.fn();
    const s = track(new NativeSession(f.plugin, c, queue, { onClosed: closed }));
    await s.start(opts);
    f.emit('nativePlayerState', state({ time: 300 }));
    f.emit('nativePlayerClosed', { index: 0, time: 320.4, duration: 1000 });
    expect(closed).toHaveBeenCalledWith({ index: 0, time: 320.4, duration: 1000 }, false);
    expect(getLocalProgress(H1, 1)!.time).toBe(320.4);
    expect(setViewed).toHaveBeenCalledWith(H1, 1, 320);
    expect(f.removed.sort()).toEqual(['nativePlayerClosed', 'nativePlayerMark', 'nativePlayerState']);
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
    const s = track(new NativeSession(f.plugin, null, queue, { onState }));
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
    const s = track(new NativeSession(f.plugin, null, queue, { onClosed: closed }));
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

  it('nativePlayerOpen while a run is launched and not closed', async () => {
    const f = fakePlugin();
    const s = track(new NativeSession(f.plugin, null, queue));
    expect(nativePlayerOpen()).toBe(false);
    await s.start(opts);
    expect(nativePlayerOpen()).toBe(true);
    f.emit('nativePlayerClosed', { index: 0, time: 1, duration: 10 });
    expect(nativePlayerOpen()).toBe(false);
  });

  it('detach after launch keeps listening until the close (progress saved, hooks not called)', async () => {
    const f = fakePlugin();
    const { c, setViewed } = fakeClient();
    const closed = vi.fn();
    const s = track(new NativeSession(f.plugin, c, queue, { onClosed: closed }));
    await s.start(opts);
    s.detach();
    expect(f.removed.length).toBe(0);
    f.emit('nativePlayerClosed', { index: 0, time: 333, duration: 1000 });
    expect(getLocalProgress(H1, 1)!.time).toBe(333);
    expect(setViewed).toHaveBeenCalledWith(H1, 1, 333);
    expect(closed).not.toHaveBeenCalled();
    expect(f.removed.length).toBe(3);
    expect(nativePlayerOpen()).toBe(false);
  });

  it('detach before the launch stops without calling playNative', async () => {
    const f = fakePlugin();
    const s = track(new NativeSession(f.plugin, null, queue));
    const p = s.start(opts);
    s.detach();
    await p;
    expect(f.plugin.playNative).not.toHaveBeenCalled();
    expect(f.removed.length).toBe(3);
    expect(nativePlayerOpen()).toBe(false);
  });

  it('a playNative failure rejects and releases the listeners', async () => {
    const f = fakePlugin();
    f.plugin.playNative.mockImplementation(() => Promise.reject({ message: 'Нет плеера' }));
    const s = track(new NativeSession(f.plugin, null, queue));
    await expect(s.start(opts)).rejects.toEqual({ message: 'Нет плеера' });
    expect(f.removed.length).toBe(3);
  });

  it('dispose before the listeners resolve still removes them', async () => {
    const f = fakePlugin();
    const s = track(new NativeSession(f.plugin, null, queue));
    const p = s.start(opts);
    s.dispose();
    await p;
    expect(f.removed.length).toBe(3);
    expect(f.plugin.playNative).not.toHaveBeenCalled();
  });

  describe('chapters and skips', () => {
    const withIntro = {
      streams: [],
      chapters: [
        { start_time: '0', end_time: '5', tags: { title: 'Пролог' } },
        { start_time: '5', end_time: '95', tags: { title: 'Opening' } },
        { start_time: '95', end_time: '900', tags: { title: '' } },
      ],
    } as any;
    const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
    const sent = (f: ReturnType<typeof fakePlugin>) => f.plugin.nativePlayerCommand.mock.calls.map((c: any[]) => c[0].cmd);
    const io = (prefs: any = { i: true, c: false }) => ({
      load: vi.fn((_h: string) => Promise.resolve(prefs)),
      save: vi.fn((_h: string, patch: any) => Promise.resolve({ ...prefs, ...patch })),
    });

    it('sends the chapters, intro and flags of the current item and of each item it advances to', async () => {
      const f = fakePlugin();
      const probeOf = vi.fn((item: PlayItem) => Promise.resolve(item === queue[0] ? withIntro : null));
      const skip = io();
      const s = track(new NativeSession(f.plugin, null, queue, {}, null, probeOf, skip));
      await s.start(opts);
      await flush();
      const sid = f.plugin.playNative.mock.calls[0][0].session;
      expect(sent(f)).toEqual([{
        type: 'segments', index: 0, session: sid,
        chapters: [{ start: 0, title: 'Пролог' }, { start: 5, title: 'Opening' }, { start: 95, title: '' }],
        intro: { start: 5, end: 95 }, autoIntro: true, autoCredits: false,
      }]);
      f.emit('nativePlayerState', state({ index: 1, duration: 0 }));
      f.emit('nativePlayerState', state({ index: 0, duration: 0 }));
      await flush();
      // item 1 without chapters is sent too (CH± may fall back to episodes); probes and prefs are asked once
      expect(sent(f)[1]).toEqual({ type: 'segments', index: 1, session: sid, chapters: [], autoIntro: true, autoCredits: false });
      expect(sent(f).length).toBe(2);
      expect(probeOf).toHaveBeenCalledTimes(2);
      expect(skip.load).toHaveBeenCalledTimes(1);
      expect(skip.load).toHaveBeenCalledWith(H1);
    });

    it('credits mark: sent again once the duration is known', async () => {
      const f = fakePlugin();
      const s = track(new NativeSession(f.plugin, null, queue, {}, null, () => Promise.resolve(null), io({ i: false, c: true, mc: 90 })));
      await s.start(opts);
      await flush();
      expect(sent(f)[0].credits).toBeUndefined();
      f.emit('nativePlayerState', state({ duration: 1000 }));
      f.emit('nativePlayerState', state({ duration: 1000, time: 31 }));
      await flush();
      expect(sent(f).length).toBe(2);
      expect(sent(f)[1]).toMatchObject({ credits: { start: 910 }, mc: 90, autoCredits: true });
    });

    it('a failed probe or prefs load counts as «no chapters», defaults off', async () => {
      const f = fakePlugin();
      const skip = { load: vi.fn(() => Promise.reject(new Error('x'))), save: vi.fn() };
      await track(new NativeSession(f.plugin, null, queue, {}, null, () => Promise.reject(new Error('x')), skip as any)).start(opts);
      await flush();
      expect(sent(f)).toEqual([expect.objectContaining({ type: 'segments', index: 0, chapters: [], autoIntro: false, autoCredits: false })]);
    });

    it('without a probe loader (no server): probed without chapters, so CH± fall back to episodes', async () => {
      const f = fakePlugin();
      await track(new NativeSession(f.plugin, null, queue)).start(opts);
      await flush();
      expect(sent(f)).toEqual([expect.objectContaining({ type: 'segments', index: 0, chapters: [], autoIntro: false, autoCredits: false })]);
    });

    it('marks from the menu: pending intro start, then the end is saved; the player gets a message and new segments', async () => {
      const f = fakePlugin();
      const skip = io({ i: false, c: false });
      const s = track(new NativeSession(f.plugin, null, queue, {}, null, () => Promise.resolve(null), skip));
      await s.start(opts);
      await flush();
      const sid = f.plugin.playNative.mock.calls[0][0].session;
      f.plugin.nativePlayerCommand.mockClear();
      f.emit('nativePlayerMark', { session: sid, index: 0, kind: 'intro-start', now: 45.4, duration: 1000 });
      await flush();
      expect(skip.save).not.toHaveBeenCalled();
      expect(sent(f)).toEqual([
        expect.objectContaining({ type: 'segments', index: 0, pending: 45 }),
        { type: 'toast', text: 'Начало заставки 0:45 · теперь отметьте конец', error: false, session: sid },
      ]);
      f.plugin.nativePlayerCommand.mockClear();
      f.emit('nativePlayerMark', { session: sid, index: 0, kind: 'intro-end', now: 135, duration: 1000 });
      await flush();
      expect(skip.save).toHaveBeenCalledWith(H1, { mi: [45, 135] });
      const cmds = sent(f);
      expect(cmds[cmds.length - 1]).toEqual({ type: 'toast', text: 'Отмечено: заставка 0:45–2:15', error: false, session: sid });
      expect(cmds[cmds.length - 2]).toMatchObject({ type: 'segments', intro: { start: 45, end: 135 }, mi: [45, 135] });
      expect(cmds[cmds.length - 2].pending).toBeUndefined();
      // credits: the last N whole seconds
      f.emit('nativePlayerMark', { session: sid, index: 0, kind: 'credits', now: 910.2, duration: 1000 });
      await flush();
      expect(skip.save).toHaveBeenLastCalledWith(H1, { mc: 90 });
      // marks of another run are ignored
      f.emit('nativePlayerMark', { session: sid + 1, index: 0, kind: 'credits', now: 900, duration: 1000 });
      await flush();
      expect(skip.save).toHaveBeenCalledTimes(2);
    });

    it('a failed save or no server: error message', async () => {
      const f = fakePlugin();
      const skip = { load: vi.fn(() => Promise.resolve({ i: false, c: false })), save: vi.fn(() => Promise.reject(new Error('нет сети'))) };
      const s = track(new NativeSession(f.plugin, null, queue, {}, null, () => Promise.resolve(null), skip as any));
      await s.start(opts);
      await flush();
      f.emit('nativePlayerMark', { index: 0, kind: 'credits', now: 900, duration: 1000 });
      await flush();
      const last = sent(f).pop();
      expect(last).toMatchObject({ type: 'toast', error: true });
      expect(last.text).toMatch(/^Не удалось сохранить отметку: /);
      const g = fakePlugin();
      await track(new NativeSession(g.plugin, null, [{ url: 'http://x/y.mkv', title: 'y' }], {}, null, () => Promise.resolve(null))).start(opts);
      await flush();
      g.emit('nativePlayerMark', { index: 0, kind: 'credits', now: 900, duration: 1000 });
      expect(sent(g).pop()).toMatchObject({ type: 'toast', text: 'Не удалось сохранить отметку: нет связи с сервером', error: true });
    });
  });
});

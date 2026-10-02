import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal } from '@preact/signals';
import {
  launchedAt,
  launching,
  markLaunched,
  nowPlaying,
  lastSeen,
  linkStatus,
  reportUrl,
  sendCmd,
  attachIfOmpForeground,
  startPlayerLink,
  setPlayerLinkDeps,
} from '../src/tv/playerLink';

const state = (o: object = {}) => ({
  hash: 'a'.repeat(40), file: 0, title: 'T', subtitle: 'S', time: 10, duration: 100, paused: false, buffering: false,
  audio: { list: [], sel: 0 }, subs: { list: [], sel: '' }, next: null, ...o,
});
const body = (s: object | null) => JSON.stringify({ v: 1, app: '0.8.0', state: s });

let clock = 1000;
let handler: ((b: string) => void) | null;
let queued: any[][];
let launches: object[];
let fg: string | null;
const ip = signal<string | null>(null);
let failed: boolean;
let started: string[];

beforeEach(() => {
  clock = 1000;
  handler = null;
  queued = [];
  launches = [];
  started = [];
  fg = 'com.spacesarmat.torrplayer';
  ip.value = '192.168.1.5';
  failed = false;
  setPlayerLinkDeps({
    now: () => clock,
    tvIp: () => ip.value,
    tvFailed: () => failed,
    foregroundAppId: async () => fg,
    launchOnTv: async (p) => void launches.push(p),
    native: {
      startPlayerServer: async (i: string) => (started.push(i), 'http://192.168.1.2:8123/'),
      queuePlayerCommands: async (c: object[]) => void queued.push(c as any[]),
      onPlayerMessage: (cb: (b: string) => void) => {
        handler = cb;
        return () => (handler = null);
      },
    } as any,
  });
  startPlayerLink();
});
afterEach(() => setPlayerLinkDeps(null));

describe('playerLink', () => {
  it('message updates signals and ignores garbage', () => {
    expect(linkStatus.value).toBe('none');
    handler!('not json');
    handler!(JSON.stringify({ v: 2 }));
    expect(nowPlaying.value).toBeNull();
    handler!(body(state()));
    expect(nowPlaying.value?.title).toBe('T');
    expect(lastSeen.value).toBe(1000);
    expect(linkStatus.value).toBe('live');
    handler!(body(null));
    expect(nowPlaying.value).toBeNull();
    expect(linkStatus.value).toBe('none');
  });

  it('goes stale after 5 s and none after 30 s on the 1 s ticker', () => {
    vi.useFakeTimers();
    try {
      handler!(body(state()));
      clock += 5000;
      vi.advanceTimersByTime(1000);
      expect(linkStatus.value).toBe('live');
      clock += 1;
      vi.advanceTimersByTime(1000);
      expect(linkStatus.value).toBe('stale');
      clock += 30000;
      vi.advanceTimersByTime(1000);
      expect(linkStatus.value).toBe('none');
    } finally {
      vi.useRealTimers();
    }
  });

  it('queues commands with increasing ids and updates optimistically', () => {
    handler!(body(state()));
    sendCmd({ type: 'pause' });
    expect(nowPlaying.value?.paused).toBe(true);
    sendCmd({ type: 'play' });
    expect(nowPlaying.value?.paused).toBe(false);
    sendCmd({ type: 'seek', t: 50 });
    expect(nowPlaying.value?.time).toBe(50);
    sendCmd({ type: 'skip', d: 100 });
    expect(nowPlaying.value?.time).toBe(100);
    sendCmd({ type: 'skip', d: -500 });
    expect(nowPlaying.value?.time).toBe(0);
    expect(queued.map((q) => q[0].id)).toEqual([1, 2, 3, 4, 5]);
    expect(queued[2][0]).toEqual({ type: 'seek', t: 50, id: 3 });
    clock += 1000;
    handler!(body(state({ time: 12 })));
    expect(nowPlaying.value?.time).toBe(12);
  });

  it('sendCmd is a no-op unless the link is live', () => {
    sendCmd({ type: 'next' });
    expect(queued).toHaveLength(0);
    expect(nowPlaying.value).toBeNull();
    handler!(body(state()));
    clock += 6000;
    sendCmd({ type: 'pause' });
    expect(queued).toHaveLength(0);
    expect(nowPlaying.value?.paused).toBe(false);
    clock -= 6000;
    sendCmd({ type: 'pause' });
    expect(queued).toHaveLength(1);
  });

  it('keeps the optimistic overlay over the first report sent before the TV applied it', () => {
    handler!(body(state()));
    sendCmd({ type: 'pause' });
    clock += 400;
    handler!(body(state({ paused: false, time: 11 })));
    expect(nowPlaying.value?.paused).toBe(true);
    expect(nowPlaying.value?.time).toBe(11);
    clock += 100;
    handler!(body(state({ paused: false, time: 11.5 })));
    expect(nowPlaying.value?.paused).toBe(false);
  });

  it('drops the overlay on a report received 1 s after the command', () => {
    handler!(body(state()));
    sendCmd({ type: 'skip', d: 30 });
    expect(nowPlaying.value?.time).toBe(40);
    clock += 1000;
    handler!(body(state({ time: 13 })));
    expect(nowPlaying.value?.time).toBe(13);
  });

  it('drops the overlay when the TV switches to another file', () => {
    handler!(body(state()));
    sendCmd({ type: 'pause' });
    handler!(body(state({ file: 1, paused: false })));
    expect(nowPlaying.value?.paused).toBe(false);
  });

  it('clears the state and stops the ticker once the link is gone', () => {
    vi.useFakeTimers();
    try {
      handler!(body(state()));
      clock += 30001;
      vi.advanceTimersByTime(1000);
      expect(nowPlaying.value).toBeNull();
      expect(linkStatus.value).toBe('none');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('launching lasts until the first report or 15 s', () => {
    vi.useFakeTimers();
    try {
      expect(launching.value).toBe(false);
      markLaunched();
      expect(launchedAt.value).toBe(1000);
      expect(launching.value).toBe(true);
      clock += 15000;
      vi.advanceTimersByTime(15100);
      expect(launching.value).toBe(false);
      markLaunched();
      expect(launching.value).toBe(true);
      handler!(body(state()));
      expect(launching.value).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a switch to another TV clears the state', () => {
    handler!(body(state()));
    markLaunched();
    ip.value = null;
    expect(nowPlaying.value).not.toBeNull();
    ip.value = '192.168.1.5';
    expect(nowPlaying.value).not.toBeNull();
    ip.value = '192.168.1.9';
    expect(nowPlaying.value).toBeNull();
    expect(lastSeen.value).toBe(0);
    expect(launchedAt.value).toBe(0);
  });

  it('reportUrl starts the server for the TV ip, null without TV or on failure', async () => {
    expect(await reportUrl()).toBe('http://192.168.1.2:8123/');
    expect(started).toEqual(['192.168.1.5']);
    ip.value = null;
    expect(await reportUrl()).toBeNull();
    ip.value = '1.1.1.1';
    setPlayerLinkDeps({
      native: {
        startPlayerServer: async () => {
          throw new Error('x');
        },
      } as any,
    });
    expect(await reportUrl()).toBeNull();
  });

  it('attaches only when OMP is in the foreground', async () => {
    fg = 'com.webos.app.hdmi1';
    await attachIfOmpForeground();
    expect(launches).toEqual([]);
    fg = null;
    await attachIfOmpForeground();
    expect(launches).toEqual([]);
    fg = 'com.spacesarmat.torrplayer';
    await attachIfOmpForeground();
    expect(launches).toEqual([{ report: 'http://192.168.1.2:8123/' }]);
  });

  it('skips a live link and a failed TV', async () => {
    handler!(body(state()));
    await attachIfOmpForeground();
    expect(launches).toEqual([]);
    clock += 6000;
    failed = true;
    await attachIfOmpForeground();
    expect(launches).toEqual([]);
    failed = false;
    await attachIfOmpForeground();
    expect(launches).toHaveLength(1);
  });

  it('concurrent attaches share one launch', async () => {
    await Promise.all([attachIfOmpForeground(), attachIfOmpForeground()]);
    expect(launches).toHaveLength(1);
    await attachIfOmpForeground();
    expect(launches).toHaveLength(2);
  });

  it('swallows launch errors', async () => {
    setPlayerLinkDeps({
      launchOnTv: async () => {
        throw new Error('x');
      },
    });
    await expect(attachIfOmpForeground()).resolves.toBeUndefined();
  });
});

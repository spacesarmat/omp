// Phone side of the player link: the TV posts its state to the phone's local server, the phone queues commands.
import { signal, computed, effect, untracked, type Signal, type ReadonlySignal } from '@preact/signals';
import { native } from '../platform/native';
import { sessionIp, tvState, foregroundAppId, launchOnTv, attachOnTv, tvKind } from './tvClient';
import type { TvKind } from './tvStore';
import { sanitizeMessage, STALE_MS, GONE_MS, type PlayerState, type Cmd } from '../../../src/phone/protocol';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export interface PlayerLinkDeps {
  native: Pick<typeof native, 'startPlayerServer' | 'queuePlayerCommands' | 'onPlayerMessage'>;
  now: () => number;
  foregroundAppId: () => Promise<string | null>;
  launchOnTv: (params: object) => Promise<void>;
  /** Android TV: start reporting without navigating (`POST /omp/attach`). */
  attachOnTv: (report: string) => Promise<void>;
  /** Kind of the TV in use. */
  tvKind: () => TvKind;
  /** Reactive (read inside an effect): the IP of the current TV session. */
  tvIp: () => string | null;
  /** True when the TV connection is in the error state. */
  tvFailed: () => boolean;
}

const realDeps: PlayerLinkDeps = {
  native,
  now: () => Date.now(),
  foregroundAppId,
  launchOnTv,
  attachOnTv,
  tvKind,
  tvIp: () => sessionIp.value,
  tvFailed: () => tvState.value === 'error',
};
let deps: PlayerLinkDeps = realDeps;

const OMP_APP_ID = 'com.spacesarmat.torrplayer';
/** How long after a launch the phone waits for the first state report. */
export const LAUNCH_WAIT_MS = 15000;
/** An optimistic overlay survives reports received sooner than this after the command. */
const OPTIMISTIC_HOLD_MS = 1000;

export const nowPlaying: Signal<PlayerState | null> = signal(null);
export const lastSeen: Signal<number> = signal(0);
/** When the phone last launched a video with a report URL on the TV; 0 = none. */
export const launchedAt: Signal<number> = signal(0);
const tick = signal(0);

function statusAt(now: number): 'none' | 'live' | 'stale' {
  if (!nowPlaying.value || !lastSeen.value) return 'none';
  const age = now - lastSeen.value;
  if (age > GONE_MS) return 'none';
  return age > STALE_MS ? 'stale' : 'live';
}

export const linkStatus: ReadonlySignal<'none' | 'live' | 'stale'> = computed(() => {
  tick.value;
  return statusAt(deps.now());
});

/** True for [LAUNCH_WAIT_MS] after a launch while the TV has not reported a video yet. */
export const launching: ReadonlySignal<boolean> = computed(() => {
  tick.value;
  return !nowPlaying.value && launchedAt.value > 0 && deps.now() - launchedAt.value < LAUNCH_WAIT_MS;
});

let ticker: ReturnType<typeof setInterval> | null = null;
let launchTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
let stopIpWatch: (() => void) | null = null;
let lastIp: string | null = null;
let cmdSeq = 0;
let attaching: Promise<void> | null = null;

/** Optimistic values shown over the TV reports until the TV has had time to apply the command. */
interface Overlay {
  hash: string;
  file: number;
  at: number;
  msgs: number;
  paused?: boolean;
  time?: number;
}
let overlay: Overlay | null = null;

function syncTicker(): void {
  if (nowPlaying.value && !ticker) {
    ticker = setInterval(() => {
      if (deps.now() - lastSeen.value > GONE_MS) {
        nowPlaying.value = null;
        overlay = null;
      }
      tick.value++;
      syncTicker();
    }, 1000);
  } else if (!nowPlaying.value && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

function withOverlay(s: PlayerState | null): PlayerState | null {
  const o = overlay;
  if (!o) return s;
  if (!s || s.hash !== o.hash || s.file !== o.file) {
    overlay = null;
    return s;
  }
  o.msgs++;
  if (deps.now() - o.at >= OPTIMISTIC_HOLD_MS || o.msgs >= 2) {
    overlay = null;
    return s;
  }
  const r = { ...s };
  if (o.paused !== undefined) r.paused = o.paused;
  if (o.time !== undefined) r.time = o.time;
  return r;
}

function onBody(body: string): void {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return;
  }
  const m = sanitizeMessage(raw);
  if (!m) return;
  nowPlaying.value = withOverlay(m.state);
  lastSeen.value = deps.now();
  tick.value++;
  syncTicker();
}

function clearLink(): void {
  nowPlaying.value = null;
  lastSeen.value = 0;
  launchedAt.value = 0;
  overlay = null;
  syncTicker();
}

/** Subscribes to TV messages and watches TV switches (idempotent). */
export function startPlayerLink(): void {
  if (!stopIpWatch) {
    stopIpWatch = effect(() => {
      const ip = deps.tvIp();
      if (!ip) return;
      if (lastIp !== null && ip !== lastIp) untracked(clearLink);
      lastIp = ip;
    });
  }
  if (unsubscribe) return;
  try {
    unsubscribe = deps.native.onPlayerMessage(onBody);
  } catch {
    unsubscribe = null;
  }
}

/** Test seam: replaces the dependencies (null restores the real ones) and resets the store. */
export function setPlayerLinkDeps(d: Partial<PlayerLinkDeps> | null): void {
  unsubscribe?.();
  unsubscribe = null;
  stopIpWatch?.();
  stopIpWatch = null;
  lastIp = null;
  if (ticker) clearInterval(ticker);
  ticker = null;
  if (launchTimer) clearTimeout(launchTimer);
  launchTimer = null;
  deps = d ? { ...deps, ...d } : realDeps;
  nowPlaying.value = null;
  lastSeen.value = 0;
  launchedAt.value = 0;
  overlay = null;
  attaching = null;
  cmdSeq = 0;
}

/** Records a successful launch: «Запускаем на телевизоре…» until the TV reports or the wait ends. */
export function markLaunched(): void {
  launchedAt.value = deps.now();
  if (launchTimer) clearTimeout(launchTimer);
  launchTimer = setTimeout(() => {
    launchTimer = null;
    tick.value++;
  }, LAUNCH_WAIT_MS + 50);
}

/** Starts the server for the active TV; null off-device or with no TV. */
export async function reportUrl(): Promise<string | null> {
  const ip = deps.tvIp();
  if (!ip) return null;
  try {
    return await deps.native.startPlayerServer(ip);
  } catch {
    return null;
  }
}

function optimisticFields(s: PlayerState, c: DistributiveOmit<Cmd, 'id'>): { paused?: boolean; time?: number } | null {
  switch (c.type) {
    case 'pause':
      return { paused: true };
    case 'play':
      return { paused: false };
    case 'seek':
      return { time: c.t };
    case 'chapter': {
      const ch = s.chapters && s.chapters[c.i];
      return ch ? { time: ch.t } : null;
    }
    case 'skip': {
      const t = s.time + c.d;
      return { time: Math.max(0, s.duration > 0 ? Math.min(s.duration, t) : t) };
    }
    default:
      return null;
  }
}

/** Queues a command for the TV; does nothing unless the link is live. */
export function sendCmd(c: DistributiveOmit<Cmd, 'id'>): void {
  const now = deps.now();
  const s = nowPlaying.value;
  if (!s || statusAt(now) !== 'live') return;
  const cmd = { ...c, id: ++cmdSeq } as Cmd;
  try {
    deps.native.queuePlayerCommands([cmd]).catch(() => {});
  } catch {
    /* off-device */
  }
  const f = optimisticFields(s, c);
  if (!f) return;
  const prev = overlay && overlay.hash === s.hash && overlay.file === s.file ? overlay : null;
  overlay = { ...(prev || {}), ...f, hash: s.hash, file: s.file, at: now, msgs: 0 };
  nowPlaying.value = { ...s, ...f };
}

async function attach(): Promise<void> {
  try {
    if ((await deps.foregroundAppId()) !== OMP_APP_ID) return;
    const url = await reportUrl();
    if (!url) return;
    if (deps.tvKind() === 'atv') await deps.attachOnTv(url);
    else await deps.launchOnTv({ report: url });
  } catch {
    /* TV unreachable */
  }
}

/**
 * When the TV shows OMP, asks it to start reporting to this phone. Skips a live link and a failed TV;
 * concurrent calls share one attempt. Never rejects.
 */
export function attachIfOmpForeground(): Promise<void> {
  if (statusAt(deps.now()) === 'live' || deps.tvFailed()) return Promise.resolve();
  if (!attaching) {
    const p = attach().finally(() => {
      if (attaching === p) attaching = null;
    });
    attaching = p;
  }
  return attaching;
}

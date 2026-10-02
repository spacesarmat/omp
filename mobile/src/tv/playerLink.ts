// Phone side of the player link: the TV posts its state to the phone's local server, the phone queues commands.
import { signal, computed, type Signal, type ReadonlySignal } from '@preact/signals';
import { native } from '../platform/native';
import { sessionIp, foregroundAppId, launchOnTv } from './tvClient';
import { sanitizeMessage, STALE_MS, GONE_MS, type PlayerState, type Cmd } from '../../../src/phone/protocol';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export interface PlayerLinkDeps {
  native: Pick<typeof native, 'startPlayerServer' | 'queuePlayerCommands' | 'onPlayerMessage'>;
  now: () => number;
  foregroundAppId: () => Promise<string | null>;
  launchOnTv: (params: object) => Promise<void>;
  tvIp: () => string | null;
}

const realDeps: PlayerLinkDeps = {
  native,
  now: () => Date.now(),
  foregroundAppId,
  launchOnTv,
  tvIp: () => sessionIp.value,
};
let deps: PlayerLinkDeps = realDeps;

const OMP_APP_ID = 'com.spacesarmat.torrplayer';

export const nowPlaying: Signal<PlayerState | null> = signal(null);
export const lastSeen: Signal<number> = signal(0);
const tick = signal(0);

export const linkStatus: ReadonlySignal<'none' | 'live' | 'stale'> = computed(() => {
  tick.value;
  if (!nowPlaying.value || !lastSeen.value) return 'none';
  const age = deps.now() - lastSeen.value;
  if (age > GONE_MS) return 'none';
  return age > STALE_MS ? 'stale' : 'live';
});

let ticker: ReturnType<typeof setInterval> | null = null;
let unsubscribe: (() => void) | null = null;
let cmdSeq = 0;

function syncTicker(): void {
  if (nowPlaying.value && !ticker) {
    ticker = setInterval(() => {
      tick.value++;
    }, 1000);
  } else if (!nowPlaying.value && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
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
  nowPlaying.value = m.state;
  lastSeen.value = deps.now();
  tick.value++;
  syncTicker();
}

/** Subscribes to TV messages (idempotent). */
export function startPlayerLink(): void {
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
  if (ticker) clearInterval(ticker);
  ticker = null;
  deps = d ? { ...deps, ...d } : realDeps;
  nowPlaying.value = null;
  lastSeen.value = 0;
  cmdSeq = 0;
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

function applyOptimistic(s: PlayerState, c: DistributiveOmit<Cmd, 'id'>): PlayerState {
  switch (c.type) {
    case 'pause':
      return { ...s, paused: true };
    case 'play':
      return { ...s, paused: false };
    case 'seek':
      return { ...s, time: c.t };
    case 'skip': {
      const t = s.time + c.d;
      return { ...s, time: Math.max(0, s.duration > 0 ? Math.min(s.duration, t) : t) };
    }
    default:
      return s;
  }
}

export function sendCmd(c: DistributiveOmit<Cmd, 'id'>): void {
  const cmd = { ...c, id: ++cmdSeq } as Cmd;
  try {
    deps.native.queuePlayerCommands([cmd]).catch(() => {});
  } catch {
    /* off-device */
  }
  if (nowPlaying.value) nowPlaying.value = applyOptimistic(nowPlaying.value, c);
}

/** When the TV shows OMP, asks it to start reporting to this phone. Errors are swallowed. */
export async function attachIfOmpForeground(): Promise<void> {
  try {
    if ((await deps.foregroundAppId()) !== OMP_APP_ID) return;
    const url = await reportUrl();
    if (!url) return;
    await deps.launchOnTv({ report: url });
  } catch {
    /* TV unreachable */
  }
}

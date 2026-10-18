// Live swarm numbers for a screen that is open, and the shared dead-release streak.
// list() only — get() would wake an idle torrent. Polling stops when the screen is hidden or gone.
// Chromium 53 safe: no Object.values/entries, no AbortController.
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { CacheState, Torrent } from '../api/types';
import { client } from '../store/servers';
import { torrents } from '../store/library';
import { swarmActive } from './torrentStatus';
import { deadRelease, type DeadSample } from './deadRelease';

export const SWARM_POLL_MS = 4000;

/** Bumps only when a torrent's dead flag flips, so a card can re-read isDeadRelease. */
export const swarmVersion = signal(0);

interface Streak {
  since: number | null;
  dead: boolean;
}

const streaks: { [hash: string]: Streak } = {};
const holds: { [hash: string]: boolean } = {};
const lastSample: { [hash: string]: DeadSample } = {};

let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let listening = false;

function keyOf(hash: string): string {
  return (hash || '').toLowerCase();
}

export function resetSwarmWatch(): void {
  Object.keys(streaks).forEach((k) => delete streaks[k]);
  Object.keys(holds).forEach((k) => delete holds[k]);
  Object.keys(lastSample).forEach((k) => delete lastSample[k]);
  swarmVersion.value = 0;
}

/**
 * The player owns this hash: a library poll that still sees the torrent idle (stat 5) must not wipe
 * the streak the player's /cache samples are building.
 */
export function holdPlayback(hash: string, on: boolean): void {
  const k = keyOf(hash);
  if (!k) return;
  if (on) holds[k] = true;
  else delete holds[k];
}

/** Folds one sample into the streak. Returns whether the dead flag flipped. */
export function noteSwarm(hash: string, sample: DeadSample, now: number): boolean {
  const k = keyOf(hash);
  if (!k) return false;
  const prev = streaks[k];
  if (holds[k] && !sample.active && prev && prev.since !== null) return false;
  const next = deadRelease(prev ? prev.since : null, now, sample);
  const was = !!(prev && prev.dead);
  if (next.since === null) {
    if (prev) delete streaks[k];
  } else streaks[k] = { since: next.since, dead: next.dead };
  if (next.dead === was) return false;
  swarmVersion.value = swarmVersion.value + 1;
  return true;
}

export function isDeadRelease(hash: string | undefined): boolean {
  if (!hash) return false;
  const s = streaks[keyOf(hash)];
  return !!(s && s.dead);
}

function downloaded(t: Pick<Torrent, 'loaded_size' | 'preloaded_bytes'>): number {
  const loaded = t.loaded_size && t.loaded_size > 0 ? t.loaded_size : 0;
  const pre = t.preloaded_bytes && t.preloaded_bytes > 0 ? t.preloaded_bytes : 0;
  return loaded + pre;
}

function sampleOf(t: Torrent): DeadSample {
  return {
    active: swarmActive(t.stat),
    seeders: t.connected_seeders && t.connected_seeders > 0 ? t.connected_seeders : 0,
    bytes: downloaded(t),
  };
}

function sameSwarm(a: Torrent, b: Torrent): boolean {
  return a.stat === b.stat && a.connected_seeders === b.connected_seeders && a.active_peers === b.active_peers && a.loaded_size === b.loaded_size && a.preloaded_bytes === b.preloaded_bytes && a.download_speed === b.download_speed;
}

function applyList(list: Torrent[]): void {
  const now = Date.now();
  const by: { [h: string]: Torrent } = {};
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t && t.hash) by[keyOf(t.hash)] = t;
  }
  const cur = torrents.value;
  let changed = false;
  const next = cur.map((t) => {
    const f = by[keyOf(t.hash)];
    if (!f || sameSwarm(t, f)) return t;
    changed = true;
    return {
      ...t,
      stat: f.stat,
      connected_seeders: f.connected_seeders,
      active_peers: f.active_peers,
      loaded_size: f.loaded_size,
      preloaded_bytes: f.preloaded_bytes,
      download_speed: f.download_speed,
    };
  });
  if (changed) torrents.value = next;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t && t.hash) noteSwarm(t.hash, sampleOf(t), now);
  }
}

function hidden(): boolean {
  try {
    return typeof document !== 'undefined' && document.hidden === true;
  } catch (e) {
    return false;
  }
}

function tick(): void {
  if (hidden() || ticking || users <= 0) return;
  const c = client.value;
  if (!c) return;
  ticking = true;
  c.list().then(
    (list) => {
      ticking = false;
      if (users > 0) applyList(list || []);
    },
    () => {
      ticking = false;
    },
  );
}

function onVis(): void {
  if (!hidden()) tick();
}

function start(): void {
  if (timer !== null) return;
  // the first sample waits for the interval: a screen that reads the list itself must not see an extra list() on mount
  timer = setInterval(tick, SWARM_POLL_MS);
  if (!listening && typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', onVis);
    listening = true;
  }
}

function stop(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  if (listening && typeof document !== 'undefined' && document.removeEventListener) {
    document.removeEventListener('visibilitychange', onVis);
    listening = false;
  }
}

/** Poll list() every ~4s while this screen is mounted and the document is visible. */
export function useLiveSwarm(): void {
  swarmVersion.value;
  useEffect(() => {
    users += 1;
    if (users === 1) start();
    return () => {
      users -= 1;
      if (users <= 0) {
        users = 0;
        stop();
      }
    };
  }, []);
}

/**
 * Player /cache samples. `active` stays true while the player is waiting, so a list that still says
 * "in db" cannot clear the streak (holdPlayback). The interval moves the clock even when the numbers stay 0.
 */
export function usePlaybackDead(hash: string | undefined, cache: CacheState | null): boolean {
  swarmVersion.value;
  useEffect(() => {
    if (!hash) return undefined;
    holdPlayback(hash, true);
    const timerId = setInterval(() => {
      const s = lastSample[keyOf(hash)];
      if (s) noteSwarm(hash, s, Date.now());
    }, 1000);
    return () => {
      holdPlayback(hash, false);
      clearInterval(timerId);
    };
  }, [hash]);
  useEffect(() => {
    if (!hash || !cache || !cache.Torrent) return;
    const t = cache.Torrent;
    const sample: DeadSample = { active: true, seeders: t.connected_seeders && t.connected_seeders > 0 ? t.connected_seeders : 0, bytes: downloaded(t) };
    lastSample[keyOf(hash)] = sample;
    noteSwarm(hash, sample, Date.now());
  }, [hash, cache]);
  return isDeadRelease(hash);
}

// Crowd swarm counts for POST /v1/watch-signals (the additive `swarm` field, phase 3 of the seed
// monitoring). While a torrent gets info, preloads or works, TorrServer shows the device the live
// swarm; this module reports connected_seeders and the active-peer split along the existing signal
// path - same endpoint, same device token, same «Помогать улучшать подбор» gate as the watch votes.
// Only infohash + seeders + leechers leave the device: the server derives the irreversible device
// key and stores nothing else. One report per hash per window, batches of 20, a 30 s flush.
// Chromium 53 safe: no ?., no ??, no Object.values.
import { deviceId } from '../billing/session';
import { settings } from '../store/settings';
import { swarmActive } from '../lib/torrentStatus';
import { sendSignalBody } from './watchReport';

export const SWARM_REPORT_WINDOW_MS = 10 * 60 * 1000;
export const SWARM_REPORT_BATCH_MAX = 20;
export const SWARM_REPORT_FLUSH_MS = 30000;
const COUNT_CAP = 1000000;

export interface SwarmSample {
  infohash: string;
  seeders: number;
  leechers: number;
}

let poster: ((body: { [key: string]: string }) => Promise<void>) | null = null;
const queue: { [hash: string]: { sample: SwarmSample; at: number } } = {};
const lastSent: { [hash: string]: number } = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Tests replace the network. Null restores the shared watch-signals sender. */
export function setSwarmPoster(fn: ((body: { [key: string]: string }) => Promise<void>) | null): void {
  poster = fn;
}

export function resetSwarmReport(): void {
  Object.keys(queue).forEach((k) => delete queue[k]);
  Object.keys(lastSent).forEach((k) => delete lastSent[k]);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
}

function helpOn(): boolean {
  return settings.value.helpRank !== false;
}

function raw(v: number | undefined): number {
  return typeof v === 'number' && isFinite(v) && v > 0 ? v : 0;
}

function cap(v: number): number {
  const n = Math.floor(v);
  return n > COUNT_CAP ? COUNT_CAP : n;
}

function send(body: { [key: string]: string }): Promise<void> {
  if (poster) return poster(body).then(() => undefined, () => undefined);
  return sendSignalBody(body);
}

function schedule(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushSwarm();
  }, SWARM_REPORT_FLUSH_MS);
  const timer = flushTimer as { unref?: () => void };
  if (timer.unref) timer.unref();
}

/**
 * One TorrServer stat sample. Only an active torrent (getting info, preload, working) is reported:
 * the idle «in db» snapshot carries 0/0 and would pollute the crowd. Seeders are connected_seeders;
 * leechers are the rest of the active peers, clamped at zero. A hash already sent inside the window
 * is skipped; a pending hash keeps the newest counts.
 */
export function noteSwarmSample(
  t: { hash?: string; stat?: number; connected_seeders?: number; active_peers?: number },
  now?: number,
): void {
  const hash = (t.hash || '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(hash)) return;
  if (!swarmActive(t.stat)) return;
  if (!helpOn()) return;
  const at = typeof now === 'number' ? now : Date.now();
  const sent = lastSent[hash] || 0;
  if (sent && at - sent < SWARM_REPORT_WINDOW_MS) return;
  const seeders = raw(t.connected_seeders);
  const peers = raw(t.active_peers);
  queue[hash] = {
    sample: { infohash: hash, seeders: cap(seeders), leechers: cap(Math.max(peers - seeders, 0)) },
    at: at,
  };
  if (Object.keys(queue).length >= SWARM_REPORT_BATCH_MAX) flushSwarm();
  else schedule();
}

export function flushSwarm(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const keys = Object.keys(queue);
  if (!keys.length) return;
  if (!helpOn()) {
    keys.forEach((k) => delete queue[k]);
    return;
  }
  const items: SwarmSample[] = [];
  for (let i = 0; i < keys.length && items.length < SWARM_REPORT_BATCH_MAX; i++) {
    const entry = queue[keys[i]];
    delete queue[keys[i]];
    lastSent[entry.sample.infohash] = entry.at;
    items.push(entry.sample);
  }
  void send({ swarm: JSON.stringify(items), deviceId: deviceId(), help: '1' });
  if (Object.keys(queue).length) schedule();
}

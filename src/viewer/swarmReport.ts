// Crowd swarm counts for POST /v1/watch-signals (the additive `swarm` field, phase 3 of the seed
// monitoring). While a torrent gets info, preloads or works, TorrServer shows the device the live
// swarm; this module reports connected_seeders and the active-peer split along the existing signal
// path - same endpoint, same device token, same «Помогать улучшать подбор» gate as the watch votes.
// Only infohash + seeders + leechers leave the device: the server derives the irreversible device
// key and stores nothing else. One report per hash per window, batches of 20, a 30 s flush. The
// window starts only when the server accepted the batch; a failed send retries on a later flush.
// A sample older than SWARM_SAMPLE_TTL_MS is dropped, never sent or retried: the server stamps the
// receive time, so stale counts (playback stopped during a billing outage) must not reach the crowd
// as a fresh report. Active playback produces a new sample every few seconds - nothing is lost.
// Chromium 53 safe: no ?., no ??, no Object.values.
import { deviceId } from '../billing/session';
import { settings } from '../store/settings';
import { swarmActive } from '../lib/torrentStatus';
import { sendSignalBody, type SignalDelivery } from './watchReport';

export const SWARM_REPORT_WINDOW_MS = 10 * 60 * 1000;
export const SWARM_REPORT_BATCH_MAX = 20;
export const SWARM_REPORT_FLUSH_MS = 30000;
/**
 * Max age of a sample at send time. Same order as the dedup window, a separate meaning: the window
 * bounds how OFTEN a hash is reported, the TTL bounds how OLD the counts may be when they go out.
 * The server stamps reported_at with the receive time, so anything older would look fresh to the
 * 6 h crowd trust window and could displace bitmagnet with stale numbers.
 */
export const SWARM_SAMPLE_TTL_MS = 10 * 60 * 1000;
const COUNT_CAP = 1000000;

export interface SwarmSample {
  infohash: string;
  seeders: number;
  leechers: number;
}

let poster: ((body: { [key: string]: string }) => Promise<void | SignalDelivery>) | null = null;
const queue: { [hash: string]: { sample: SwarmSample; at: number } } = {};
const lastSent: { [hash: string]: number } = {};
// Hashes whose batch is on the wire right now: a sample arriving mid-flight does not queue a
// duplicate. This is NOT the dedup window - that one (lastSent) starts only on server acceptance.
const inFlight: { [hash: string]: number } = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Tests replace the network. Null restores the shared watch-signals sender. */
export function setSwarmPoster(fn: ((body: { [key: string]: string }) => Promise<void | SignalDelivery>) | null): void {
  poster = fn;
}

export function resetSwarmReport(): void {
  Object.keys(queue).forEach((k) => delete queue[k]);
  Object.keys(lastSent).forEach((k) => delete lastSent[k]);
  Object.keys(inFlight).forEach((k) => delete inFlight[k]);
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

function send(body: { [key: string]: string }): Promise<SignalDelivery> {
  if (poster) return poster(body).then((r) => (r === 'failed' || r === 'no-session' ? r : 'accepted'), () => 'failed');
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
  const sent = lastSent[hash] || inFlight[hash] || 0;
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

/**
 * Send one batch. Samples older than SWARM_SAMPLE_TTL_MS are dropped first - stale counts must
 * never go out as a fresh report, even after a long outage. The dedup window starts ONLY when the
 * server accepted the batch: a failed send (network, timeout, non-2xx) puts the still-fresh reports
 * back for a later flush - the next scheduled one, no storm - and a missing session never counts as
 * sent. Samples arriving mid-flight do not queue a duplicate (inFlight); if the batch is not
 * accepted, the original report is restored while it is younger than the TTL.
 */
export function flushSwarm(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const now = Date.now();
  Object.keys(queue).forEach((k) => {
    if (now - queue[k].at >= SWARM_SAMPLE_TTL_MS) delete queue[k];
  });
  const keys = Object.keys(queue);
  if (!keys.length) return;
  if (!helpOn()) {
    keys.forEach((k) => delete queue[k]);
    return;
  }
  const entries: { sample: SwarmSample; at: number }[] = [];
  for (let i = 0; i < keys.length && entries.length < SWARM_REPORT_BATCH_MAX; i++) {
    const entry = queue[keys[i]];
    delete queue[keys[i]];
    inFlight[entry.sample.infohash] = entry.at;
    entries.push(entry);
  }
  const items = entries.map((e) => e.sample);
  void send({ swarm: JSON.stringify(items), deviceId: deviceId(), help: '1' }).then((result) => {
    const at = Date.now();
    for (let i = 0; i < entries.length; i++) {
      const h = entries[i].sample.infohash;
      delete inFlight[h];
      if (result === 'accepted') {
        lastSent[h] = entries[i].at;
      } else if (!queue[h] && at - entries[i].at < SWARM_SAMPLE_TTL_MS) {
        // Not accepted: the window must not start. Put the report back for a later flush,
        // unless it expired while in flight - then wait for a new sample instead.
        queue[h] = entries[i];
      }
    }
    // A failed batch retries on the next flush; without a session the reports wait for a later
    // sample to schedule one (the sender resolves at once, nothing to retry against).
    if (result === 'failed' && Object.keys(queue).length) schedule();
  });
  if (Object.keys(queue).length) schedule();
}

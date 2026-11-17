// Background refresh of popular seed probes (phase 1 of the real-seed monitoring).
// One hash a minute, through the same gate/transport/DHT as POST /v1/seed-check, so the shared
// per-host limits still hold. Selection is pure (refreshDue, itemFromCache) and testable without
// a clock or a network. The cache row carries the public announce addresses (migration 015);
// tracker URLs are never logged: the tick result and the log line carry counts only.
import { POPULAR_HITS, POPULAR_SEEDS, publicTrackers, trackerKey, ttlMs } from './seedProbe.mjs';

/** A popular row (many seeds, or asked often) past half its TTL is due for a re-scrape. */
export function refreshDue(row, now) {
  if (!row || typeof row.measuredAt !== 'number' || !(row.measuredAt > 0)) return false;
  const popular =
    (row.seeders || 0) >= POPULAR_SEEDS || (row.dhtSeeds || 0) >= POPULAR_SEEDS || (row.hits || 0) >= POPULAR_HITS;
  if (!popular) return false;
  return now - row.measuredAt >= Math.floor(ttlMs(row) / 2);
}

/**
 * Rebuild the runSeedCheck item from a cache row: the infohash plus its stored public trackers.
 * Null when the row has no usable tracker address, or the rebuilt tracker key differs from the
 * stored one (a refresh must update the same row, not create a second one).
 */
export function itemFromCache(row) {
  const hash = String((row && row.infohash) || '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(hash)) return null;
  const trackers = publicTrackers({ infohash: hash, trackers: row && row.trackers });
  if (!trackers.length) return null;
  const item = { infohash: hash, trackers: trackers };
  if (trackerKey(item) !== String((row && row.trackerKey) || '')) return null;
  return item;
}

/**
 * Scheduler in the shape of startPgBackups: a first look after a delay, then every minute.
 * `list(now)` returns the most popular stale row (or null); `check(item)` runs runSeedCheck for
 * that one item. Without both wired there is nothing to do and the tick is idle. One tick at a
 * time; a slow scrape cannot stack. Timers are unref'ed: the scheduler never holds the process.
 */
export function startSeedRefresh(opts) {
  const o = opts || {};
  const log = o.log || ((s) => process.stdout.write(s + '\n'));
  const nowFn = o.now || (() => Date.now());
  const everyMs = o.everyMs === undefined ? 60 * 1000 : o.everyMs;
  const firstDelayMs = o.firstDelayMs === undefined ? 60 * 1000 : o.firstDelayMs;
  let busy = null;
  let lastError = '';
  async function tick() {
    if (busy) return busy;
    busy = (async () => {
      if (typeof o.list !== 'function' || typeof o.check !== 'function') return null;
      const now = nowFn();
      const row = await o.list(now);
      if (!row || !refreshDue(row, now)) return null;
      const item = itemFromCache(row);
      if (!item) return null;
      const out = await o.check(item);
      const live = out && out.stats ? out.stats.live || 0 : 0;
      lastError = '';
      log('seed-refresh live=' + live);
      return { live: live };
    })()
      .catch((e) => {
        // The code only: an error text could carry an address, and addresses are not logged.
        lastError = String((e && e.code) || 'down');
        log('seed-refresh error');
        return { error: lastError };
      })
      .finally(() => {
        busy = null;
      });
    return busy;
  }
  const first = setTimeout(() => void tick(), firstDelayMs);
  const every = setInterval(() => void tick(), everyMs);
  if (first.unref) first.unref();
  if (every.unref) every.unref();
  return {
    tick: tick,
    stop: () => {
      clearTimeout(first);
      clearInterval(every);
    },
    status: () => ({ lastError: lastError }),
  };
}

// Phase 3 of the real-seed monitoring: crowd counts from the devices themselves. While a torrent
// plays or preloads, TorrServer shows the device the live swarm (connected_seeders, active_peers);
// the app reports those counts along the existing watch-signals path (additive `swarm` field).
// This module is the pure policy: parse the reports, derive the irreversible device key, aggregate
// the fresh reports into a median estimate, and merge that estimate into a seed-check answer.
// The SQL storage lives in db/pg/seedCrowdSql.mjs (migration 016_seed_crowd).
//
// Privacy: a report carries only infohash + seeders + leechers. The device key is a sha256 of the
// registry device row id - the stable `dev` claim of the access token - never the token itself
// (it rotates: iat/exp), never a telegram id, never a device name. No tracker URL is accepted or
// stored here, and nothing in this module logs a hash or a key.
//
// Anti-abuse: whole counts capped at CROWD_COUNT_CAP, at most CROWD_BATCH_MAX reports per signal,
// one report per device+hash per CROWD_DEDUP_MS (enforced by the SQL upsert), and the endpoint's
// per-device rate limit. An estimate needs CROWD_MIN_DEVICES distinct devices inside CROWD_WINDOW_MS:
// a single report is not an estimate. The aggregate carries the OLDEST contributing report's
// timestamp, so one stale report cannot hide behind a fresh one (the same rule bitmagnetSource
// applies to mixed records). The median, the threshold and the oldest timestamp are computed in
// SQL over the FULL set of each hash's reports (db/pg/seedCrowdSql.mjs): no sampling cap can
// evict another hash's reports or change what the full set would answer.
//
// Merge policy (mergeCrowdCounts, the bitmagnetSource shape): a fresh aggregate (<= CROWD_FRESH_MS,
// >= CROWD_MIN_DEVICES) applies as source 'crowd', estimate, ageMs - never live, never verified.
// Stale or absent crowd data keeps the previous answer; saved crowd counts demote and keep their
// age advancing from measuredAt. runSeedCheck offers crowd only the hashes left without a tracker
// measurement (samples = 0), after bitmagnet: a fresh crowd estimate wins over bitmagnet, a stale
// one keeps it. Estimates live in the answer only - never in seed_probes, never in the refresh.
import { sha256 } from './crypto.mjs';

/** Reports older than this leave the aggregate (and the table, pruned on write). */
export const CROWD_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Trust window of the merge: a fresh crowd estimate beats bitmagnet, a stale one keeps it. */
export const CROWD_FRESH_MS = 6 * 60 * 60 * 1000;
/** Distinct devices needed before a crowd aggregate becomes an estimate. */
export const CROWD_MIN_DEVICES = 2;
/** One report per device+hash per window; a faster repeat is deduped by the SQL upsert. */
export const CROWD_DEDUP_MS = 10 * 60 * 1000;
/** Reports per signal body. */
export const CROWD_BATCH_MAX = 20;
/** Sanity cap, the same order as the tracker counts (seedProbe COUNT_CAP). */
export const CROWD_COUNT_CAP = 1000000;
/** The crowd read is a fast DB/cache lookup; it may wait only this long inside the request budget. */
export const CROWD_WAIT_MS = 2000;
/** Below this much budget left the crowd lookup is not started at all. */
export const CROWD_MIN_LEFT_MS = 100;
/** Answer cache over the crowd aggregate, the same window as bitmagnet. */
export const CROWD_CACHE_TTL_MS = 60 * 1000;
/** A small future clock skew is tolerated, by the SQL window and by the merge alike. */
export const CROWD_CLOCK_SKEW_MS = 60 * 1000;

/**
 * Irreversible per-device key: sha256 of the registry device row id (the access token's stable
 * `dev` claim). The raw token rotates on refresh, so hashing it would split one device into many
 * keys and break the distinct-device threshold. '' for an empty id.
 */
export function crowdDeviceKey(rowId) {
  const id = String(rowId || '');
  if (!id) return '';
  return sha256('seed-crowd\n' + id);
}

/** Whole count 0..CROWD_COUNT_CAP, or null for anything invalid. A too-big count is capped, not dropped. */
function count(v) {
  if (typeof v !== 'number' || !isFinite(v) || v < 0 || v !== Math.floor(v)) return null;
  return v > CROWD_COUNT_CAP ? CROWD_COUNT_CAP : v;
}

/**
 * The additive `swarm` field of a watch-signals body: an array (or its JSON string form) of
 * { infohash, seeders, leechers }. An absent field is an empty batch; a malformed one refuses the
 * whole signal, like a malformed payload. Bad rows are skipped, counts capped, duplicate hashes
 * keep the last report. Only the hash and the counts survive - every other field is dropped.
 */
export function parseSwarmReports(raw) {
  if (raw === undefined || raw === null) return { ok: true, items: [] };
  let list = raw;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (e) {
      return { ok: false, items: [] };
    }
  }
  if (!Array.isArray(list)) return { ok: false, items: [] };
  if (list.length > CROWD_BATCH_MAX) return { ok: false, items: [] };
  const out = [];
  const index = Object.create(null);
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (!it || typeof it !== 'object') continue;
    const hash = String(it.infohash || '').trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(hash)) continue;
    const seeders = count(it.seeders);
    const leechers = count(it.leechers);
    if (seeders === null || leechers === null) continue;
    const row = { infohash: hash, seeders, leechers };
    if (index[hash] === undefined) {
      index[hash] = out.length;
      out.push(row);
    } else {
      out[index[hash]] = row;
    }
  }
  return { ok: true, items: out };
}

/** Age-only freshness with the bitmagnet clock-skew tolerance. */
function isFresh(row, maxAgeMs, now) {
  if (!row || typeof row.updatedAt !== 'number' || !isFinite(row.updatedAt)) return false;
  const age = now - row.updatedAt;
  return age >= -CROWD_CLOCK_SKEW_MS && age < maxAgeMs;
}

/**
 * Pure merge of one existing counts row with one crowd aggregate (or null), the
 * mergeBitmagnetCounts shape. A fresh aggregate (<= CROWD_FRESH_MS, >= CROWD_MIN_DEVICES) applies
 * the counts (a null field keeps the existing number) marked source 'crowd', estimate, ageMs;
 * live/verified stay owned by the scrape path. Stale or absent crowd data never applies and never
 * keeps a crowd-sourced row live; its age keeps advancing from measuredAt. opts: { now, maxAgeMs }.
 */
export function mergeCrowdCounts(existing, crowd, opts) {
  const o = opts || {};
  const now = typeof o.now === 'function' ? o.now() : Date.now();
  const maxAgeMs = o.maxAgeMs === undefined ? CROWD_FRESH_MS : o.maxAgeMs;
  const base = existing && typeof existing === 'object' ? existing : {};
  const out = { ...base };
  const usable =
    crowd &&
    typeof crowd === 'object' &&
    (crowd.seeders != null || crowd.leechers != null) &&
    (crowd.devices || 0) >= CROWD_MIN_DEVICES &&
    isFresh(crowd, maxAgeMs, now);
  if (usable) {
    out.seeders = crowd.seeders != null ? crowd.seeders : base.seeders != null ? base.seeders : null;
    out.leechers = crowd.leechers != null ? crowd.leechers : base.leechers != null ? base.leechers : null;
    out.source = 'crowd';
    out.fresh = true;
    out.ageMs = Math.max(0, now - crowd.updatedAt);
    out.estimate = true;
    out.measuredAt = crowd.updatedAt;
    out.live = !!base.live;
    out.verified = !!base.verified;
    return out;
  }
  out.fresh = false;
  if (base.source === 'crowd') {
    if (typeof base.measuredAt === 'number' && isFinite(base.measuredAt)) {
      out.ageMs = Math.max(0, now - base.measuredAt);
    }
    out.live = false;
    out.verified = false;
  }
  return out;
}

// Batch seed/leech counts by infohash from the local bitmagnet GraphQL API.
// Complements the Torznab search in jackett.mjs (searchBitmagnet): that one finds torrents,
// this one refreshes counts for hashes the app already has. Not wired into server.mjs yet.
//
// Config: createBitmagnetSource({ baseUrl }) takes the bitmagnet origin - the same admin
// setting bitmagnetUrl the Torznab search uses (jackett.mjs indexerOf). The GraphQL endpoint
// is that origin plus /graphql. No new env var: an empty or unusable baseUrl disables the
// source, and fetchCounts then resolves to an empty Map without a network call.
//
// Counts policy: items[].torrent.seeders/leechers/updatedAt is the aggregate and wins;
// items[].seeders/leechers/updatedAt (torrent_contents) is the fallback. A null count means
// "unknown", never zero: a field null in both places stays null, and a row with both counts
// null is omitted. updatedAt belongs to the record that gave the counts - a fresh aggregate
// timestamp never labels stale fallback counts (mixed records take the older timestamp).
// Errors (network, timeout, non-200, GraphQL errors, bad JSON) resolve to an empty Map so the
// caller keeps its previous numbers; unread response bodies are cancelled.
//
// Freshness: isFresh(row, maxAgeMs) is age-only, with a one-minute clock-skew tolerance.
// mergeBitmagnetCounts never presents stale bitmagnet numbers as live: a fresh row applies
// counts (a null field keeps the existing number, or null when there is none) and marks
// source/age/estimate; a stale or absent row demotes live when the existing counts themselves
// came from bitmagnet and keeps their age advancing from measuredAt. Tracker verification
// (live/verified) stays owned by the scrape path; bitmagnet counts are DHT-derived estimates.
//
// Logging: this module never prints URLs or infohashes. lastStatus carries counts and status
// only ({ ok, status, error, ms, at, asked, rows }) for the caller's log line.

export const BITMAGNET_BATCH_MAX = 30;
export const BITMAGNET_TIMEOUT_MS = 8000;
/** Default freshness window for merge. The crawler refreshes popular hashes often, rare ones slowly. */
export const BITMAGNET_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;
const COUNT_CAP = 1000000;

/** GraphQL endpoint for a bitmagnet origin, or '' when the base is unusable. */
export function bitmagnetGraphqlUrl(baseUrl) {
  const text = String(baseUrl || '').trim();
  if (!text) return '';
  let u;
  try {
    u = new URL(text);
  } catch (e) {
    return '';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  if (u.username || u.password || u.search || u.hash) return '';
  return u.origin + '/graphql';
}

/** Whole count 0..COUNT_CAP, or null for anything unknown or invalid. Null is never zero. */
function count(v) {
  if (typeof v !== 'number' || !isFinite(v) || v < 0 || v !== Math.floor(v)) return null;
  return v > COUNT_CAP ? COUNT_CAP : v;
}

/** Epoch ms from an ISO timestamp, or null. */
function timeMs(v) {
  if (typeof v !== 'string' || !v) return null;
  const n = Date.parse(v);
  return isFinite(n) ? n : null;
}

/** Lowercased unique hex40 hashes, in the order given. Bad rows are skipped. */
function normalizeHashes(list) {
  const arr = Array.isArray(list) ? list : [];
  const seen = Object.create(null);
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const h = String(arr[i] || '').trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(h) || seen[h]) continue;
    seen[h] = 1;
    out.push(h);
  }
  return out;
}

/** The verified batch query: torrent aggregate plus contents fallback fields, limit 30. */
function batchQuery(hashes) {
  const list = hashes.map((h) => '"' + h + '"').join(',');
  return (
    '{torrentContent{search(input:{infoHashes:[' + list + '],limit:' + BITMAGNET_BATCH_MAX + '})' +
    '{items{infoHash seeders leechers updatedAt torrent{seeders leechers updatedAt}}}}}'
  );
}

/**
 * One answer item -> { seeders, leechers, updatedAt, source }, or null when both counts are unknown.
 * updatedAt belongs to the record that gave the counts: all-torrent counts carry the torrent
 * timestamp; when a count falls back to contents, the contents timestamp governs, and with
 * mixed records the older of the two wins so a fresh aggregate cannot hide a stale field.
 */
function rowOf(item) {
  if (!item || typeof item !== 'object') return null;
  const hash = String(item.infoHash || '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(hash)) return null;
  const t = item.torrent && typeof item.torrent === 'object' ? item.torrent : null;
  const tSeeders = t ? count(t.seeders) : null;
  const tLeechers = t ? count(t.leechers) : null;
  const seeders = tSeeders !== null ? tSeeders : count(item.seeders);
  const leechers = tLeechers !== null ? tLeechers : count(item.leechers);
  if (seeders === null && leechers === null) return null;
  const tsTorrent = timeMs(t && t.updatedAt);
  const tsItem = timeMs(item.updatedAt);
  const allFromTorrent = (seeders === null || tSeeders !== null) && (leechers === null || tLeechers !== null);
  let updatedAt;
  if (allFromTorrent) {
    updatedAt = tsTorrent;
  } else {
    updatedAt = tsItem === null ? null : tsTorrent === null ? tsItem : Math.min(tsTorrent, tsItem);
  }
  return { hash, row: { seeders, leechers, updatedAt, source: 'bitmagnet' } };
}

/** Age-only freshness. A small future skew (clock drift) is tolerated; null updatedAt is never fresh. */
export function isFreshRow(row, maxAgeMs, now) {
  if (!row || typeof row.updatedAt !== 'number' || !isFinite(row.updatedAt)) return false;
  const age = now - row.updatedAt;
  return age >= -CLOCK_SKEW_MS && age < maxAgeMs;
}

/**
 * Pure merge of one existing counts row with one bitmagnet row (or null).
 * Fresh bitmagnet counts apply (a null field keeps the existing number, or null when there
 * is none), marked with source 'bitmagnet', fresh, ageMs and estimate. Stale or absent
 * bitmagnet data never applies, never keeps a bitmagnet-sourced row live, and the age of
 * saved bitmagnet counts keeps advancing from measuredAt. opts: { now, maxAgeMs }.
 */
export function mergeBitmagnetCounts(existing, bitmagnet, opts) {
  const o = opts || {};
  const now = typeof o.now === 'function' ? o.now() : Date.now();
  const maxAgeMs = o.maxAgeMs === undefined ? BITMAGNET_MAX_AGE_MS : o.maxAgeMs;
  const base = existing && typeof existing === 'object' ? existing : {};
  const out = { ...base };
  const usable =
    bitmagnet &&
    typeof bitmagnet === 'object' &&
    (bitmagnet.seeders != null || bitmagnet.leechers != null) &&
    isFreshRow(bitmagnet, maxAgeMs, now);
  if (usable) {
    // Unknown stays unknown: a null field keeps the existing number, or null when there is none.
    out.seeders = bitmagnet.seeders != null ? bitmagnet.seeders : base.seeders != null ? base.seeders : null;
    out.leechers = bitmagnet.leechers != null ? bitmagnet.leechers : base.leechers != null ? base.leechers : null;
    out.source = 'bitmagnet';
    out.fresh = true;
    out.ageMs = Math.max(0, now - bitmagnet.updatedAt);
    out.estimate = true;
    out.measuredAt = bitmagnet.updatedAt;
    out.live = !!base.live;
    out.verified = !!base.verified;
    return out;
  }
  out.fresh = false;
  if (base.source === 'bitmagnet') {
    // The saved counts were not refreshed: their age keeps advancing from measuredAt,
    // and stale estimates are shown as numbers with an age, never as a live swarm.
    if (typeof base.measuredAt === 'number' && isFinite(base.measuredAt)) {
      out.ageMs = Math.max(0, now - base.measuredAt);
    }
    out.live = false;
    out.verified = false;
  }
  // A stale or absent incoming row was not applied, so its timestamp never labels these counts.
  return out;
}

/** Release a response body that will not be read, so a failed request does not hold the connection. */
async function dropBody(res) {
  try {
    if (res && res.body && typeof res.body.cancel === 'function') await res.body.cancel();
  } catch (e) {
    // already consumed or closed
  }
}

/**
 * The source. fetchCounts(infoHashes) resolves to Map<hash, { seeders, leechers, updatedAt, source }>.
 * Batches cap at 30 hashes per request; invalid hashes are skipped; errors never throw.
 * lastStatus is counts/status only - safe to log. isFresh(row, maxAgeMs) uses the injected now.
 */
export function createBitmagnetSource(opts) {
  const o = opts || {};
  const url = bitmagnetGraphqlUrl(o.baseUrl);
  const timeoutMs = typeof o.timeoutMs === 'number' && o.timeoutMs > 0 ? o.timeoutMs : BITMAGNET_TIMEOUT_MS;
  const fetchImpl = typeof o.fetchImpl === 'function' ? o.fetchImpl : fetch;
  const now = typeof o.now === 'function' ? o.now : () => Date.now();
  const source = {
    enabled: !!url,
    lastStatus: { ok: false, status: null, error: 'disabled', ms: 0, at: 0, asked: 0, rows: 0 },
    isFresh(row, maxAgeMs) {
      return isFreshRow(row, maxAgeMs === undefined ? BITMAGNET_MAX_AGE_MS : maxAgeMs, now());
    },
    async fetchCounts(infoHashes) {
      const started = now();
      const hashes = normalizeHashes(infoHashes);
      const map = new Map();
      const status = { ok: true, status: 200, error: null, ms: 0, at: started, asked: hashes.length, rows: 0 };
      if (!url) {
        source.lastStatus = { ...status, ok: false, status: null, error: 'disabled', ms: now() - started };
        return map;
      }
      if (!hashes.length) {
        source.lastStatus = { ...status, ms: now() - started };
        return map;
      }
      for (let i = 0; i < hashes.length; i += BITMAGNET_BATCH_MAX) {
        const chunk = hashes.slice(i, i + BITMAGNET_BATCH_MAX);
        const wanted = Object.create(null);
        for (let j = 0; j < chunk.length; j++) wanted[chunk[j]] = 1;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
          const res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ query: batchQuery(chunk) }),
            redirect: 'error',
            signal: ctrl.signal,
          });
          if (res.status !== 200) {
            await dropBody(res);
            status.ok = false;
            status.status = res.status;
            status.error = 'http';
            continue;
          }
          const body = await res.json();
          if (body && Array.isArray(body.errors) && body.errors.length) {
            await dropBody(res);
            status.ok = false;
            status.error = 'graphql';
            continue;
          }
          const items = body && body.data && body.data.torrentContent && body.data.torrentContent.search && body.data.torrentContent.search.items;
          if (!Array.isArray(items)) {
            await dropBody(res);
            status.ok = false;
            status.error = 'shape';
            continue;
          }
          for (let j = 0; j < items.length; j++) {
            const parsed = rowOf(items[j]);
            if (!parsed || !wanted[parsed.hash]) continue;
            map.set(parsed.hash, parsed.row);
          }
        } catch (e) {
          status.ok = false;
          status.error = e && e.name === 'AbortError' ? 'timeout' : 'network';
        } finally {
          clearTimeout(timer);
        }
      }
      status.rows = map.size;
      status.ms = now() - started;
      source.lastStatus = status;
      return map;
    },
  };
  return source;
}

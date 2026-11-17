// Crowd swarm reports (schema migration 016_seed_crowd). Outside the billing state snapshot and
// outside seed_probes: these are device estimates, never tracker-verified measurements, so the
// background refresh selection never sees them. One row per infohash and device key; the key is
// the irreversible sha256 from seedCrowd.mjs. No tracker address, no title, no raw device id is
// stored or logged here - the aggregate carries counts only.
//
// The aggregate (median counts, device threshold, oldest timestamp, 24h window) is computed in
// SQL over the FULL set of each hash's reports, GROUP BY infohash: no sampling cap can evict
// another hash's reports or hide an old report behind a thousand fresh ones. The result limit
// bounds the number of hashes (the request already caps at 30), never the reports behind them.
import { CROWD_CLOCK_SKEW_MS, CROWD_DEDUP_MS, CROWD_MIN_DEVICES, CROWD_WINDOW_MS } from '../../seedCrowd.mjs';

function num(v) {
  const n = Math.floor(Number(v) || 0);
  return n > 0 ? n : 0;
}

function hashesOf(list) {
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

/**
 * Store one device's reports. The upsert refreshes a device+hash row only outside CROWD_DEDUP_MS:
 * a faster repeat writes nothing (rowCount 0) and keeps the earlier counts. Returns the number of
 * rows actually written. Reports older than the window are pruned on the way, like seed_probes.
 */
export async function saveCrowdReports(query, deviceKey, items, now) {
  if (!deviceKey || !Array.isArray(items) || !items.length) return 0;
  let n = 0;
  for (let i = 0; i < items.length; i++) {
    const row = items[i];
    const res = await query(
      'INSERT INTO seed_crowd (infohash, device_key, seeders, leechers, reported_at) VALUES ($1, $2, $3, $4, $5)' +
        ' ON CONFLICT (infohash, device_key) DO UPDATE SET seeders = EXCLUDED.seeders, leechers = EXCLUDED.leechers, reported_at = EXCLUDED.reported_at' +
        ' WHERE seed_crowd.reported_at <= $5 - $6',
      [row.infohash, deviceKey, num(row.seeders), num(row.leechers), now, CROWD_DEDUP_MS],
    );
    n += res && res.rowCount ? res.rowCount : 0;
  }
  await query('DELETE FROM seed_crowd WHERE reported_at < $1', [now - CROWD_WINDOW_MS]);
  return n;
}

/**
 * Raw fresh reports for the hashes, newest first. An inspection/test helper - the production
 * answer path is crowdCounts, which aggregates in SQL over the full set (no row sampling here).
 */
export async function loadCrowdReports(query, hashes, now) {
  const list = hashesOf(hashes);
  if (!list.length) return [];
  const res = await query(
    'SELECT infohash, device_key, seeders, leechers, reported_at FROM seed_crowd' +
      ' WHERE infohash = ANY($1::text[]) AND reported_at >= $2' +
      ' ORDER BY reported_at DESC',
    [list, now - CROWD_WINDOW_MS],
  );
  return res.rows.map((r) => ({
    infohash: r.infohash,
    deviceKey: typeof r.device_key === 'string' ? r.device_key : '',
    seeders: num(r.seeders),
    leechers: num(r.leechers),
    reportedAt: num(r.reported_at),
  }));
}

/**
 * Map<hash, { seeders, leechers, devices, updatedAt, source: 'crowd' }> - the fetchCounts shape.
 * One grouped query: the median (percentile_cont, rounded like the seedProbe median), the device
 * count (the PK keeps one row per device) and the OLDEST report's timestamp are computed over
 * every report of the hash inside the window - a popular hash cannot evict another hash's rows,
 * and one stale report keeps the whole aggregate stale. HAVING enforces the >= 2 device trust
 * threshold; a small future clock skew is tolerated like the merge does. LIMIT bounds hashes.
 */
export async function crowdCounts(query, hashes, now) {
  const list = hashesOf(hashes);
  const out = new Map();
  if (!list.length) return out;
  const res = await query(
    'SELECT infohash,' +
      ' percentile_cont(0.5) WITHIN GROUP (ORDER BY seeders) AS seeders,' +
      ' percentile_cont(0.5) WITHIN GROUP (ORDER BY leechers) AS leechers,' +
      ' count(*) AS devices, min(reported_at) AS reported_at' +
      ' FROM seed_crowd' +
      ' WHERE infohash = ANY($1::text[]) AND reported_at >= $2 AND reported_at <= $3' +
      ' GROUP BY infohash HAVING count(*) >= $4' +
      ' LIMIT $5',
    [list, now - CROWD_WINDOW_MS, now + CROWD_CLOCK_SKEW_MS, CROWD_MIN_DEVICES, list.length],
  );
  for (let i = 0; i < res.rows.length; i++) {
    const r = res.rows[i];
    out.set(r.infohash, {
      seeders: Math.round(Number(r.seeders) || 0),
      leechers: Math.round(Number(r.leechers) || 0),
      devices: num(r.devices),
      updatedAt: num(r.reported_at),
      source: 'crowd',
    });
  }
  return out;
}

export function createCrowdRepo(store) {
  const query = (sql, params) => store.query(sql, params);
  return {
    enabled: true,
    save: (deviceKey, items, now) => saveCrowdReports(query, deviceKey, items, now),
    fetchCounts: (hashes) => crowdCounts(query, hashes, Date.now()),
  };
}

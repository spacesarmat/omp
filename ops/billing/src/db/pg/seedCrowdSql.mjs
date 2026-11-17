// Crowd swarm reports (schema migration 016_seed_crowd). Outside the billing state snapshot and
// outside seed_probes: these are device estimates, never tracker-verified measurements, so the
// background refresh selection never sees them. One row per infohash and device key; the key is
// the irreversible sha256 from seedCrowd.mjs. No tracker address, no title, no raw device id is
// stored or logged here - the aggregate carries counts only.
import { CROWD_DEDUP_MS, CROWD_WINDOW_MS, aggregateCrowdReports } from '../../seedCrowd.mjs';

// Safety cap on the raw read: newest reports first, so a truncation drops the oldest, not the
// freshest. The aggregate needs only the reports inside the window; a hash with more devices
// than this keeps the most recent ones.
const READ_LIMIT = 4096;

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

/** Raw fresh reports for the hashes, newest first, capped. The pure aggregate does the rest. */
export async function loadCrowdReports(query, hashes, now) {
  const list = hashesOf(hashes);
  if (!list.length) return [];
  const res = await query(
    'SELECT infohash, device_key, seeders, leechers, reported_at FROM seed_crowd' +
      ' WHERE infohash = ANY($1::text[]) AND reported_at >= $2' +
      ' ORDER BY reported_at DESC LIMIT $3',
    [list, now - CROWD_WINDOW_MS, READ_LIMIT],
  );
  return res.rows.map((r) => ({
    infohash: r.infohash,
    deviceKey: typeof r.device_key === 'string' ? r.device_key : '',
    seeders: num(r.seeders),
    leechers: num(r.leechers),
    reportedAt: num(r.reported_at),
  }));
}

/** Map<hash, { seeders, leechers, devices, updatedAt, source: 'crowd' }> - the fetchCounts shape. */
export async function crowdCounts(query, hashes, now) {
  const rows = await loadCrowdReports(query, hashes, now);
  return aggregateCrowdReports(rows, now);
}

export function createCrowdRepo(store) {
  const query = (sql, params) => store.query(sql, params);
  return {
    enabled: true,
    save: (deviceKey, items, now) => saveCrowdReports(query, deviceKey, items, now),
    fetchCounts: (hashes) => crowdCounts(query, hashes, Date.now()),
  };
}

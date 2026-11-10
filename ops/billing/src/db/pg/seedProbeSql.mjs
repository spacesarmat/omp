// Seed measurements (schema migration 005_seed_probes). Outside the billing state snapshot.
// One row per infohash and tracker-host set. tracker_key is hosts only: no URL, no passkey, no device id.

const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

function num(v) {
  const n = Math.floor(Number(v) || 0);
  return n > 0 ? n : 0;
}

function rowOf(r) {
  return {
    infohash: r.infohash,
    trackerKey: typeof r.tracker_key === 'string' ? r.tracker_key : '',
    seeders: num(r.seeders),
    leechers: num(r.leechers),
    seedersMax: num(r.seeders_max),
    seedersMedian: num(r.seeders_median),
    peers: num(r.peers),
    dhtSeeds: num(r.dht_seeds),
    peerEstimate: num(r.peer_estimate),
    estimate: r.dht_estimate === true,
    samples: num(r.samples),
    measuredAt: num(r.measured_at),
    hits: num(r.hits),
    lastHitAt: num(r.last_hit_at),
    live: r.live === true,
  };
}

function keysOf(keys) {
  const list = Array.isArray(keys) ? keys : [];
  return {
    hashes: list.map((k) => String(k.infohash || '')),
    trackers: list.map((k) => String(k.trackerKey || '')),
  };
}

export async function loadSeedProbes(query, keys) {
  const k = keysOf(keys);
  if (!k.hashes.length) return [];
  const res = await query(
    'SELECT s.infohash, s.tracker_key, s.seeders, s.leechers, s.seeders_max, s.seeders_median, s.peers, s.dht_seeds, s.peer_estimate, s.dht_estimate, s.samples, s.measured_at, s.hits, s.last_hit_at, s.live' +
      ' FROM seed_probes s' +
      ' JOIN unnest($1::text[], $2::text[]) AS k(infohash, tracker_key)' +
      ' ON s.infohash = k.infohash AND s.tracker_key = k.tracker_key',
    [k.hashes, k.trackers],
  );
  return res.rows.map(rowOf);
}

export async function touchSeedProbes(query, keys, now) {
  const k = keysOf(keys);
  if (!k.hashes.length) return;
  await query(
    'UPDATE seed_probes AS s SET hits = s.hits + 1, last_hit_at = $3' +
      ' FROM unnest($1::text[], $2::text[]) AS k(infohash, tracker_key)' +
      ' WHERE s.infohash = k.infohash AND s.tracker_key = k.tracker_key',
    [k.hashes, k.trackers, now],
  );
}

export async function saveSeedProbes(query, list, now) {
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    await query(
      'INSERT INTO seed_probes (infohash, tracker_key, seeders, leechers, seeders_max, seeders_median, peers, dht_seeds, peer_estimate, dht_estimate, samples, measured_at, hits, last_hit_at, live)' +
        ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, $12, $13)' +
        ' ON CONFLICT (infohash, tracker_key) DO UPDATE SET seeders = EXCLUDED.seeders, leechers = EXCLUDED.leechers,' +
        ' seeders_max = EXCLUDED.seeders_max, seeders_median = EXCLUDED.seeders_median, peers = EXCLUDED.peers,' +
        ' dht_seeds = EXCLUDED.dht_seeds, peer_estimate = EXCLUDED.peer_estimate, dht_estimate = EXCLUDED.dht_estimate,' +
        ' samples = EXCLUDED.samples, measured_at = EXCLUDED.measured_at, live = EXCLUDED.live,' +
        ' hits = seed_probes.hits + 1, last_hit_at = EXCLUDED.measured_at',
      [
        row.infohash,
        String(row.trackerKey || ''),
        num(row.seeders),
        num(row.leechers),
        num(row.seedersMax),
        num(row.seedersMedian),
        num(row.peers),
        num(row.dhtSeeds),
        num(row.peerEstimate),
        !!row.estimate,
        num(row.samples),
        num(row.measuredAt),
        !!row.live,
      ],
    );
  }
  if (list.length) await query('DELETE FROM seed_probes WHERE measured_at < $1', [now - KEEP_MS]);
}

export function createPgSeedCache(store) {
  const query = (sql, params) => store.query(sql, params);
  return {
    get: (hashes) => loadSeedProbes(query, hashes),
    touch: (hashes, now) => touchSeedProbes(query, hashes, now),
    save: (list) => saveSeedProbes(query, list, Date.now()),
  };
}

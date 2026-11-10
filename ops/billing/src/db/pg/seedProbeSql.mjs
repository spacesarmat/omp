// Seed measurements (schema migration 005_seed_probes). Outside the billing state snapshot.
// One row per infohash. No tracker URL, no passkey, no device id.

const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

function num(v) {
  const n = Math.floor(Number(v) || 0);
  return n > 0 ? n : 0;
}

function rowOf(r) {
  return {
    infohash: r.infohash,
    seeders: num(r.seeders),
    leechers: num(r.leechers),
    seedersMax: num(r.seeders_max),
    seedersMedian: num(r.seeders_median),
    peers: num(r.peers),
    samples: num(r.samples),
    measuredAt: num(r.measured_at),
    hits: num(r.hits),
    lastHitAt: num(r.last_hit_at),
    live: r.live === true,
  };
}

export async function loadSeedProbes(query, hashes) {
  if (!hashes.length) return [];
  const res = await query(
    'SELECT infohash, seeders, leechers, seeders_max, seeders_median, peers, samples, measured_at, hits, last_hit_at, live FROM seed_probes WHERE infohash = ANY($1::text[])',
    [hashes],
  );
  return res.rows.map(rowOf);
}

export async function touchSeedProbes(query, hashes, now) {
  if (!hashes.length) return;
  await query('UPDATE seed_probes SET hits = hits + 1, last_hit_at = $2 WHERE infohash = ANY($1::text[])', [hashes, now]);
}

export async function saveSeedProbes(query, list, now) {
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    await query(
      'INSERT INTO seed_probes (infohash, seeders, leechers, seeders_max, seeders_median, peers, samples, measured_at, hits, last_hit_at, live)' +
        ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $8, $9)' +
        ' ON CONFLICT (infohash) DO UPDATE SET seeders = EXCLUDED.seeders, leechers = EXCLUDED.leechers,' +
        ' seeders_max = EXCLUDED.seeders_max, seeders_median = EXCLUDED.seeders_median, peers = EXCLUDED.peers,' +
        ' samples = EXCLUDED.samples, measured_at = EXCLUDED.measured_at, live = EXCLUDED.live,' +
        ' hits = seed_probes.hits + 1, last_hit_at = EXCLUDED.measured_at',
      [
        row.infohash,
        num(row.seeders),
        num(row.leechers),
        num(row.seedersMax),
        num(row.seedersMedian),
        num(row.peers),
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

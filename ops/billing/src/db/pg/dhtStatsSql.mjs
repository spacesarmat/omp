/**
 * DHT admin counters (schema migration 004_dht_stats). Outside the billing state snapshot:
 * a minute bucket and the last few error labels. No token, device id, or infohash.
 * `reason` is a fixed short label. The check constraint rejects anything else.
 */

const REASON_OK = [
  'ошибка биллинга',
  'нет токена',
  'плохой запрос',
  'sidecar выключен',
  'лимит',
  'только чтение',
  'sidecar не ответил',
  'ошибка',
  'проверка',
];

function allowedReason(text) {
  return REASON_OK.indexOf(text) >= 0;
}

export async function loadDht(pool) {
  const minutes = await pool.query(
    'SELECT minute, count, with_peers, sum_ms, errors, errors_4xx, errors_5xx, hist FROM dht_minute ORDER BY minute',
  );
  const errs = await pool.query('SELECT pos, at, status, reason FROM dht_recent_error ORDER BY pos');
  return {
    minutes: minutes.rows.map((r) => ({
      minute: Number(r.minute),
      count: Number(r.count) || 0,
      withPeers: Number(r.with_peers) || 0,
      sumMs: Number(r.sum_ms) || 0,
      errors: Number(r.errors) || 0,
      errors4xx: Number(r.errors_4xx) || 0,
      errors5xx: Number(r.errors_5xx) || 0,
      hist: Array.isArray(r.hist) ? r.hist.map((n) => Number(n) || 0) : [],
    })),
    errors: errs.rows
      .filter((r) => allowedReason(r.reason))
      .map((r) => ({ at: Number(r.at) || 0, status: Number(r.status) || 0, reason: r.reason })),
  };
}

export async function saveDht(pool, snap) {
  const body = snap || {};
  const minutes = Array.isArray(body.minutes) ? body.minutes : [];
  const errs = Array.isArray(body.errors) ? body.errors : null;
  const pruneBefore = Math.floor(Number(body.pruneBefore));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (Number.isFinite(pruneBefore)) {
      await client.query('DELETE FROM dht_minute WHERE minute < $1', [pruneBefore]);
    }
    for (let i = 0; i < minutes.length; i++) {
      const row = minutes[i];
      const hist = Array.isArray(row.hist) ? row.hist.map((n) => Math.max(0, Math.floor(Number(n) || 0))) : [];
      await client.query(
        'INSERT INTO dht_minute (minute, count, with_peers, sum_ms, errors, errors_4xx, errors_5xx, hist)' +
          ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8)' +
          ' ON CONFLICT (minute) DO UPDATE SET count = EXCLUDED.count, with_peers = EXCLUDED.with_peers,' +
          ' sum_ms = EXCLUDED.sum_ms, errors = EXCLUDED.errors, errors_4xx = EXCLUDED.errors_4xx,' +
          ' errors_5xx = EXCLUDED.errors_5xx, hist = EXCLUDED.hist',
        [
          Math.floor(Number(row.minute)),
          Math.floor(Number(row.count) || 0),
          Math.floor(Number(row.withPeers) || 0),
          Math.floor(Number(row.sumMs) || 0),
          Math.floor(Number(row.errors) || 0),
          Math.floor(Number(row.errors4xx) || 0),
          Math.floor(Number(row.errors5xx) || 0),
          hist,
        ],
      );
    }
    if (errs) {
      await client.query('DELETE FROM dht_recent_error');
      let pos = 0;
      for (let i = 0; i < errs.length && pos < 10; i++) {
        const e = errs[i];
        if (!allowedReason(e.reason)) continue;
        await client.query('INSERT INTO dht_recent_error (pos, at, status, reason) VALUES ($1, $2, $3, $4)', [
          pos,
          Math.floor(Number(e.at) || 0),
          Math.floor(Number(e.status) || 0),
          e.reason,
        ]);
        pos++;
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (ignore) {
      /* the original error is the one that matters */
    }
    throw e;
  } finally {
    client.release();
  }
}

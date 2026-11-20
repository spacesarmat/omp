// Cross-device remembered data. Last write wins. A delete is a tombstone.
// Access: subscribers only, unless an admin set syncAudience to all.

export function syncAudience(settings) {
  return settings && settings.syncAudience === 'all' ? 'all' : 'subscribers';
}

/** A lapsed subscription is not active. A TV on that account follows the same flag. */
export function maySync(settings, active) {
  if (syncAudience(settings) === 'all') return true;
  return active === true;
}

function cleanRecord(row) {
  if (!row || typeof row !== 'object') return null;
  const id = String(row.id || '').trim().slice(0, 180);
  const kind = String(row.kind || '').trim().slice(0, 32);
  if (!id || !kind) return null;
  const updatedAt = Math.floor(Number(row.updatedAt) || 0);
  if (updatedAt <= 0) return null;
  const body = row.body && typeof row.body === 'object' && !Array.isArray(row.body) ? row.body : {};
  const text = JSON.stringify(body);
  if (text.length > 8000) return null;
  return {
    id,
    kind,
    key: String(row.key || '').slice(0, 180),
    body,
    updatedAt,
    deviceId: String(row.deviceId || '').slice(0, 80),
    deleted: row.deleted === true,
  };
}

export function parseSyncBody(raw) {
  const body = raw && typeof raw === 'object' ? raw : {};
  const since = Math.max(0, Math.floor(Number(body.since) || 0));
  const list = Array.isArray(body.records) ? body.records : [];
  if (list.length > 200) return { error: 'too_many' };
  const records = [];
  for (let i = 0; i < list.length; i++) {
    const row = cleanRecord(list[i]);
    if (row) records.push(row);
  }
  return { since, records };
}

function wins(prev, next) {
  if (!prev) return true;
  if (next.updatedAt !== prev.updatedAt) return next.updatedAt > prev.updatedAt;
  return String(next.deviceId || '') >= String(prev.deviceId || '');
}

/** Apply incoming rows onto the account map. Returns the rows changed. */
export function applySync(current, incoming) {
  const map = {};
  const list = current || [];
  for (let i = 0; i < list.length; i++) map[list[i].id] = list[i];
  const changed = [];
  for (let i = 0; i < incoming.length; i++) {
    const row = incoming[i];
    if (!wins(map[row.id], row)) continue;
    map[row.id] = row;
    changed.push(row);
  }
  return { rows: Object.keys(map).map((id) => map[id]), changed };
}

export function createSyncStore(query) {
  return {
    async pull(accountId, sinceSeq) {
      const res = await query(
        'SELECT record_id, kind, rec_key, body, updated_at, device_id, deleted, seq FROM device_sync WHERE account_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT 500',
        [accountId, sinceSeq],
      );
      return res.rows.map((r) => ({
        id: r.record_id,
        kind: r.kind,
        key: r.rec_key || '',
        body: r.body && typeof r.body === 'object' ? r.body : {},
        updatedAt: Number(r.updated_at) || 0,
        deviceId: r.device_id || '',
        deleted: r.deleted === true,
        seq: Number(r.seq) || 0,
      }));
    },
    async push(accountId, records) {
      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        await query(
          'INSERT INTO device_sync (account_id, record_id, kind, rec_key, body, updated_at, device_id, deleted)' +
            ' VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)' +
            ' ON CONFLICT (account_id, record_id) DO UPDATE SET' +
            ' kind = EXCLUDED.kind, rec_key = EXCLUDED.rec_key, body = EXCLUDED.body,' +
            ' updated_at = EXCLUDED.updated_at, device_id = EXCLUDED.device_id, deleted = EXCLUDED.deleted,' +
            ' seq = nextval(pg_get_serial_sequence(\'device_sync\', \'seq\'))' +
            ' WHERE device_sync.updated_at < EXCLUDED.updated_at' +
            ' OR (device_sync.updated_at = EXCLUDED.updated_at AND device_sync.device_id < EXCLUDED.device_id)',
          [accountId, row.id, row.kind, row.key, JSON.stringify(row.body || {}), row.updatedAt, row.deviceId, row.deleted === true],
        );
      }
    },
    async devices(accountId) {
      const res = await query(
        'SELECT device_id, MAX(updated_at) AS last_at FROM device_sync WHERE account_id = $1 GROUP BY device_id ORDER BY last_at DESC LIMIT 40',
        [accountId],
      );
      return res.rows.map((r) => ({ id: r.device_id || '', lastAt: Number(r.last_at) || 0 }));
    },
  };
}

import { parseSyncBody } from './deviceSync.mjs';

const MUTATION_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export function parseSyncV2Body(raw) {
  const list = raw && Array.isArray(raw.records) ? raw.records : [];
  for (let i = 0; i < list.length; i++) {
    const mutationId = String(list[i] && list[i].mutationId || '').trim();
    if (!mutationId || mutationId.length > 100) return { error: 'bad_mutation_id' };
  }
  return parseSyncBody(raw);
}

function expiredMutation() {
  const error = new Error('mutation_expired');
  error.code = 'mutation_expired';
  return error;
}

function changeRecord(row) {
  return {
    id: row.record_id,
    kind: row.kind,
    key: row.rec_key || '',
    body: row.body && typeof row.body === 'object' ? row.body : {},
    updatedAt: Number(row.updated_at) || 0,
    deviceId: row.device_id || '',
    deleted: row.deleted === true,
    mutationId: row.mutation_id,
    revision: Number(row.revision) || 0,
  };
}

export function createSyncV2Store(store) {
  return {
    async mutate(accountId, deviceId, records, now) {
      return store.withClient(async (query) => {
        const locked = await query(
          'INSERT INTO device_sync_counters (account_id, next_revision) VALUES ($1, 1)' +
            ' ON CONFLICT (account_id) DO UPDATE SET next_revision = device_sync_counters.next_revision' +
            ' RETURNING next_revision',
          [accountId],
        );
        let nextRevision = Number(locked.rows[0].next_revision);
        const initialRevision = nextRevision;
        const ack = [];
        for (let i = 0; i < records.length; i++) {
          const row = { ...records[i], deviceId: deviceId || records[i].deviceId };
          const existing = await query(
            'SELECT result, expires_at FROM device_sync_mutations WHERE account_id = $1 AND mutation_id = $2',
            [accountId, row.mutationId],
          );
          if (existing.rows.length) {
            if (Number(existing.rows[0].expires_at) <= now) throw expiredMutation();
            ack.push(existing.rows[0].result);
            continue;
          }
          const revision = nextRevision++;
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
          await query(
            'INSERT INTO device_sync_changes' +
              ' (account_id, revision, record_id, kind, rec_key, body, updated_at, device_id, deleted, mutation_id, created_at)' +
              ' VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)',
            [accountId, revision, row.id, row.kind, row.key, JSON.stringify(row.body || {}), row.updatedAt, row.deviceId, row.deleted === true, row.mutationId, now],
          );
          const result = { recordId: row.id, mutationId: row.mutationId, revision };
          ack.push(result);
          await query(
            'INSERT INTO device_sync_mutations (account_id, mutation_id, revision, result, created_at, expires_at)' +
              ' VALUES ($1, $2, $3, $4::jsonb, $5, $6)',
            [accountId, row.mutationId, revision, JSON.stringify(result), now, now + MUTATION_TTL_MS],
          );
        }
        if (nextRevision !== initialRevision) {
          await query('UPDATE device_sync_counters SET next_revision = $2 WHERE account_id = $1', [accountId, nextRevision]);
        }
        return ack;
      });
    },
    async pull(accountId, since, limit = 500) {
      const res = await store.query(
        'SELECT record_id, kind, rec_key, body, updated_at, device_id, deleted, mutation_id, revision' +
          ' FROM device_sync_changes WHERE account_id = $1 AND revision > $2 ORDER BY revision ASC LIMIT $3',
        [accountId, since, limit],
      );
      return res.rows.map(changeRecord);
    },
  };
}

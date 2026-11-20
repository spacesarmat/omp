import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../src/db/pg/schema.mjs';
import { createSyncV2Store, parseSyncV2Body } from '../src/deviceSyncV2.mjs';
import { createSubscription, deviceCode } from '../src/logic.mjs';
import { createApp } from '../src/server.mjs';
import { readState, testStore, writeState } from './pg';

const DEVICE = 'a'.repeat(32);
const row = {
  id: 'progress:abc:1',
  kind: 'progress',
  key: 'abc:1',
  body: { time: 40 },
  updatedAt: 100,
  deviceId: 'device-a',
  deleted: false,
  mutationId: 'mutation-1',
};

function mockRes() {
  return {
    status: 0,
    headers: {} as Record<string, string>,
    body: '',
    writeHead(status: number, headers?: Record<string, string>) {
      this.status = status;
      if (headers) Object.assign(this.headers, headers);
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    end(buf?: Buffer | string) {
      this.body = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '');
    },
  };
}

async function call(
  app: (req: unknown, res: unknown) => Promise<void>,
  path: string,
  opts: { json?: unknown; headers?: Record<string, string> } = {},
) {
  const payload = JSON.stringify(opts.json);
  const req = {
    method: 'POST',
    url: path,
    headers: {
      'x-forwarded-proto': 'https',
      'content-type': 'application/json',
      ...(opts.headers || {}),
    },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload);
    },
  };
  const res = mockRes();
  await app(req, res);
  return { status: res.status, data: JSON.parse(res.body) as Record<string, unknown> };
}

async function tokenFor(app: (req: unknown, res: unknown) => Promise<void>, file: Awaited<ReturnType<typeof testStore>>, accountId = 'acc-v2-http') {
  const now = Date.now();
  const created = createSubscription(await readState(file), { accountId, now, days: 30 });
  await writeState(file, created.state);
  const slot = deviceCode(await readState(file), created.result.subscriptionId, now);
  await writeState(file, slot.state);
  const activated = await call(app, '/v1/activate', { json: { code: slot.code, deviceId: DEVICE, tokens: 'pair' } });
  expect(activated.status).toBe(200);
  return activated.data.accessToken as string;
}

async function httpApp() {
  const file = await testStore();
  const app = createApp(file, async () => ({ status: 200, headers: { get: () => null }, text: async () => '{}' }), {
    env: {},
    monitor: { health: () => null },
  });
  const token = await tokenFor(app, file);
  return { file, app, headers: { authorization: 'Bearer ' + token, 'x-device-id': DEVICE } };
}

describe('sync v2 parser', () => {
  it('requires a bounded mutation id for every incoming record', () => {
    expect(parseSyncV2Body({ records: [{ ...row, mutationId: '' }] })).toEqual({ error: 'bad_mutation_id' });
    expect(parseSyncV2Body({ records: [{ ...row, mutationId: 'x'.repeat(101) }] })).toEqual({ error: 'bad_mutation_id' });
    expect(parseSyncV2Body({ since: 0, records: [row] }).records[0].mutationId).toBe('mutation-1');
  });
});

describe('sync v2 mutations', () => {
  it('returns the original ack for a repeat and pulls one change', async () => {
    const file = await testStore();
    const db = createSyncV2Store(file);
    const first = await db.mutate('acc-v2', 'device-a', [row], 1000);
    expect(first).toEqual([{ recordId: row.id, mutationId: row.mutationId, revision: 1 }]);
    const repeated = await db.mutate('acc-v2', 'device-a', [{ ...row, body: { time: 999 } }], 1100);
    expect(repeated).toEqual(first);
    const changes = await db.pull('acc-v2', 0);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ id: row.id, revision: 1, body: { time: 40 } });
    expect((await db.pull('acc-v2', 1)).length).toBe(0);
  });

  it('serves the combined HTTP mutation and pull contract', async () => {
    const { file, app, headers } = await httpApp();
    const saved = await call(app, '/v2/sync', { headers, json: { since: 0, records: [row] } });
    expect(saved.status).toBe(200);
    expect(saved.data.ack).toEqual([{ recordId: row.id, mutationId: row.mutationId, revision: 1 }]);
    expect(saved.data.records).toHaveLength(1);
    expect(saved.data.nextRevision).toBe(1);
    const repeated = await call(app, '/v2/sync', {
      headers,
      json: { since: 1, records: [{ ...row, body: { time: 999 } }] },
    });
    expect(repeated.status).toBe(200);
    expect(repeated.data.ack).toEqual(saved.data.ack);
    expect(repeated.data.records).toEqual([]);
    expect(repeated.data.nextRevision).toBe(1);
  });

  it('assigns gapless revisions to concurrent account writers', async () => {
    const file = await testStore();
    const db = createSyncV2Store(file);
    const first = { ...row, id: 'progress:abc:1', mutationId: 'concurrent-1' };
    const second = { ...row, id: 'progress:abc:2', mutationId: 'concurrent-2' };
    const acks = await Promise.all([
      db.mutate('acc-concurrent', 'device-a', [first], 1000),
      db.mutate('acc-concurrent', 'device-b', [second], 1000),
    ]);
    expect(acks.flat().map((ack) => ack.revision).sort()).toEqual([1, 2]);
    const changes = await db.pull('acc-concurrent', 0);
    expect(changes.map((change) => change.revision)).toEqual([1, 2]);
  });

  it('migrates an existing snapshot into the revision zero pull', async () => {
    const file = await testStore();
    await file.query('DROP TABLE device_sync_changes, device_sync_counters, device_sync_mutations');
    await file.query(
      'INSERT INTO device_sync (account_id, record_id, kind, rec_key, body, updated_at, device_id, deleted)' +
        ' VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)',
      ['acc-migrated', row.id, row.kind, row.key, JSON.stringify(row.body), row.updatedAt, row.deviceId, false],
    );
    const migration = MIGRATIONS.find((item) => item.version === '022_device_sync_v2');
    await file.query(migration.sql);
    const db = createSyncV2Store(file);
    const changes = await db.pull('acc-migrated', 0);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ id: row.id, revision: 1, body: { time: 40 } });
    const next = await db.mutate('acc-migrated', 'device-b', [{ ...row, id: 'progress:abc:2', mutationId: 'after-migration' }], 2000);
    expect(next[0].revision).toBe(2);
  });

  it('projects legacy writes into v2 without changing the v1 response', async () => {
    const { app, headers } = await httpApp();
    const legacy = { ...row, mutationId: undefined };
    const saved = await call(app, '/v1/sync', { headers, json: { since: 0, records: [legacy] } });
    expect(saved.status).toBe(200);
    expect(saved.data.nextSeq).toBeGreaterThan(0);
    expect(saved.data.records).toHaveLength(1);
    expect(saved.data.records[0].mutationId).toBeUndefined();
    expect(saved.data.ack).toBeUndefined();
    const pulled = await call(app, '/v2/sync', { headers, json: { since: 0, records: [] } });
    expect(pulled.status).toBe(200);
    expect(pulled.data.records).toHaveLength(1);
    expect(pulled.data.records[0]).toMatchObject({
      id: row.id,
      revision: 1,
      mutationId: `v1:${DEVICE}:${row.id}:${row.updatedAt}`,
    });
  });

  it('rejects an expired retry without applying its late body', async () => {
    const { file, app, headers } = await httpApp();
    const saved = await call(app, '/v2/sync', { headers, json: { since: 0, records: [row] } });
    expect(saved.status).toBe(200);
    await file.query("UPDATE device_sync_mutations SET expires_at = 0 WHERE account_id = 'acc-v2-http' AND mutation_id = $1", [row.mutationId]);
    const expired = await call(app, '/v2/sync', {
      headers,
      json: { since: 1, records: [{ ...row, body: { time: 999 } }] },
    });
    expect(expired.status).toBe(409);
    expect(expired.data).toEqual({ error: 'mutation_expired' });
    const snapshot = await file.query("SELECT body FROM device_sync WHERE account_id = 'acc-v2-http' AND record_id = $1", [row.id]);
    expect(snapshot.rows[0].body).toEqual({ time: 40 });
    const pulled = await call(app, '/v2/sync', { headers, json: { since: 0, records: [] } });
    expect(pulled.data.records).toHaveLength(1);
    expect(pulled.data.nextRevision).toBe(1);
  });

  it('logs the winning snapshot when an older mutation loses LWW', async () => {
    const file = await testStore();
    const db = createSyncV2Store(file);
    await db.mutate('acc-lww', 'device-a', [{ ...row, body: { time: 200 }, updatedAt: 200, mutationId: 'newer' }], 1000);
    const olderAck = await db.mutate('acc-lww', 'device-b', [{ ...row, body: { time: 100 }, updatedAt: 100, mutationId: 'older' }], 1100);
    expect(olderAck).toEqual([{ recordId: row.id, mutationId: 'older', revision: 2 }]);
    const changes = await db.pull('acc-lww', 0);
    expect(changes).toHaveLength(2);
    expect(changes[1]).toMatchObject({
      id: row.id,
      revision: 2,
      mutationId: 'older',
      body: { time: 200 },
      updatedAt: 200,
      deviceId: 'device-a',
    });
  });

  it('acks an expired legacy retry and continues with newer records', async () => {
    const { file, app, headers } = await httpApp();
    const legacy = { ...row, mutationId: undefined };
    const saved = await call(app, '/v1/sync', { headers, json: { since: 0, records: [legacy] } });
    expect(saved.status).toBe(200);
    await file.query("UPDATE device_sync_mutations SET expires_at = 0 WHERE account_id = 'acc-v2-http'");
    const newer = { ...row, id: 'progress:abc:2', key: 'abc:2', body: { time: 80 }, updatedAt: 200, mutationId: undefined };
    const retried = await call(app, '/v1/sync', {
      headers,
      json: { since: 1, records: [{ ...legacy, body: { time: 999 } }, newer] },
    });
    expect(retried.status).toBe(200);
    const snapshot = await file.query("SELECT record_id, body FROM device_sync WHERE account_id = 'acc-v2-http' ORDER BY record_id");
    expect(snapshot.rows).toEqual([
      { record_id: row.id, body: { time: 40 } },
      { record_id: newer.id, body: { time: 80 } },
    ]);
    const pulled = await call(app, '/v2/sync', { headers, json: { since: 0, records: [] } });
    expect(pulled.data.records).toHaveLength(2);
    expect(pulled.data.records[1]).toMatchObject({ id: newer.id, revision: 2, body: { time: 80 } });
  });

  it('publishes committed winning changes once and supports unsubscribe', async () => {
    const file = await testStore();
    const db = createSyncV2Store(file);
    const events: unknown[] = [];
    db.onChanges(() => {
      throw new Error('listener failed');
    });
    const unsubscribe = db.onChanges((accountId: string, changes: unknown) => events.push([accountId, changes]));
    const first = await db.mutate('acc-events', 'device-a', [row], 1000);
    expect(first).toEqual([{ recordId: row.id, mutationId: row.mutationId, revision: 1 }]);
    expect(events).toEqual([['acc-events', [{ ...row, revision: 1 }]]]);
    expect(await db.mutate('acc-events', 'device-a', [{ ...row, body: { time: 999 } }], 1100)).toEqual(first);
    expect(events).toHaveLength(1);
    unsubscribe();
    await db.mutate('acc-events', 'device-a', [{ ...row, id: 'progress:abc:2', mutationId: 'after-unsubscribe' }], 1200);
    expect(events).toHaveLength(1);
  });

  it('does not publish changes when an expired retry rolls back the batch', async () => {
    const file = await testStore();
    const db = createSyncV2Store(file);
    const events: unknown[] = [];
    db.onChanges((accountId: string, changes: unknown) => events.push([accountId, changes]));
    await db.mutate('acc-event-rollback', 'device-a', [row], 1000);
    await file.query("UPDATE device_sync_mutations SET expires_at = 0 WHERE account_id = 'acc-event-rollback' AND mutation_id = $1", [row.mutationId]);
    const fresh = { ...row, id: 'progress:abc:2', mutationId: 'rolled-back' };
    await expect(db.mutate('acc-event-rollback', 'device-a', [fresh, row], 2000)).rejects.toMatchObject({ code: 'mutation_expired' });
    expect(events).toHaveLength(1);
    expect(await db.pull('acc-event-rollback', 0)).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
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

async function tokenFor(app: (req: unknown, res: unknown) => Promise<void>, file: Awaited<ReturnType<typeof testStore>>) {
  const now = Date.now();
  const created = createSubscription(await readState(file), { accountId: 'acc-v2-http', now, days: 30 });
  await writeState(file, created.state);
  const slot = deviceCode(await readState(file), created.result.subscriptionId, now);
  await writeState(file, slot.state);
  const activated = await call(app, '/v1/activate', { json: { code: slot.code, deviceId: DEVICE, tokens: 'pair' } });
  expect(activated.status).toBe(200);
  return activated.data.accessToken as string;
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
    const file = await testStore();
    const app = createApp(file, async () => ({ status: 200, headers: { get: () => null }, text: async () => '{}' }), {
      env: {},
      monitor: { health: () => null },
    });
    const token = await tokenFor(app, file);
    const headers = { authorization: 'Bearer ' + token, 'x-device-id': DEVICE };
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
});

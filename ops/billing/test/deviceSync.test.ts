import { describe, expect, it } from 'vitest';
import { applySync, maySync, parseSyncBody, syncAudience } from '../src/deviceSync.mjs';
import { createSubscription, deviceCode } from '../src/logic.mjs';
import { createApp } from '../src/server.mjs';
import { readState, testStore, writeState } from './pg';

const DEV_A = 'a'.repeat(32);
const DEV_B = 'b'.repeat(32);

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
  method: string,
  path: string,
  opts: { json?: unknown; headers?: Record<string, string> } = {},
) {
  const payload = opts.json === undefined ? '' : JSON.stringify(opts.json);
  const req = {
    method,
    url: path,
    headers: {
      'x-forwarded-proto': 'https',
      'content-type': opts.json === undefined ? '' : 'application/json',
      ...(opts.headers || {}),
    },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  };
  const res = mockRes();
  await app(req, res);
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(res.body) as Record<string, unknown>;
  } catch (e) {
    data = {};
  }
  return { status: res.status, data };
}

async function tokenFor(app: (req: unknown, res: unknown) => Promise<void>, file: Awaited<ReturnType<typeof testStore>>, accountId: string, deviceId: string) {
  const now = Date.now();
  const created = createSubscription(await readState(file), { accountId, now, days: 30 });
  await writeState(file, created.state);
  const slot = deviceCode(await readState(file), created.result.subscriptionId, now);
  await writeState(file, slot.state);
  const activated = await call(app, 'POST', '/v1/activate', { json: { code: slot.code, deviceId, tokens: 'pair' } });
  expect(activated.status).toBe(200);
  return activated.data.accessToken as string;
}

describe('sync access', () => {
  it('defaults to subscribers and lets an admin open it to everyone', () => {
    expect(syncAudience({})).toBe('subscribers');
    expect(maySync({}, false)).toBe(false);
    expect(maySync({}, true)).toBe(true);
    expect(maySync({ syncAudience: 'all' }, false)).toBe(true);
    expect(syncAudience({ syncAudience: 'all' })).toBe('all');
  });

  it('a newer tombstone replaces a row and an older write does not', () => {
    const first = applySync([], [{ id: 'progress:h:1', kind: 'progress', key: 'h:1', body: { time: 10 }, updatedAt: 10, deviceId: 'a', deleted: false }]);
    const older = applySync(first.rows, [{ id: 'progress:h:1', kind: 'progress', key: 'h:1', body: { time: 1 }, updatedAt: 5, deviceId: 'b', deleted: false }]);
    expect(older.changed).toHaveLength(0);
    expect(older.rows[0].body.time).toBe(10);
    const gone = applySync(older.rows, [{ id: 'progress:h:1', kind: 'progress', key: 'h:1', body: {}, updatedAt: 11, deviceId: 'b', deleted: true }]);
    expect(gone.rows[0].deleted).toBe(true);
  });

  it('rejects a huge batch', () => {
    const records = [];
    for (let i = 0; i < 201; i++) records.push({ id: 'p:' + i, kind: 'progress', updatedAt: 1 });
    expect(parseSyncBody({ records }).error).toBe('too_many');
  });
});

describe('POST /v1/sync', () => {
  it('syncs a subscriber, ignores an older write, and stops when the subscription lapses', async () => {
    const file = await testStore();
    const app = createApp(file, async () => ({ status: 200, headers: { get: () => null }, text: async () => '{}' }), {
      env: {},
      monitor: { health: () => null },
    });
    const denied = await call(app, 'POST', '/v1/sync', { json: { since: 0, records: [] } });
    expect(denied.status).toBe(401);

    const tokenA = await tokenFor(app, file, 'acc-sync', DEV_A);
    const headersA = { authorization: 'Bearer ' + tokenA, 'x-device-id': DEV_A };
    const saved = await call(app, 'POST', '/v1/sync', {
      headers: headersA,
      json: {
        since: 0,
        records: [{ id: 'progress:abc:1', kind: 'progress', key: 'abc:1', body: { time: 40 }, updatedAt: 100, deleted: false }],
      },
    });
    expect(saved.status).toBe(200);
    const rows = saved.data.records as { id: string; body: { time: number } }[];
    expect(rows.some((r) => r.id === 'progress:abc:1' && r.body.time === 40)).toBe(true);

    const older = await call(app, 'POST', '/v1/sync', {
      headers: headersA,
      json: {
        since: 0,
        records: [{ id: 'progress:abc:1', kind: 'progress', key: 'abc:1', body: { time: 1 }, updatedAt: 50, deleted: false }],
      },
    });
    const kept = (older.data.records as { body: { time: number } }[]).filter((r) => r.body && r.body.time)[0];
    expect(kept.body.time).toBe(40);

    const tokenB = await tokenFor(app, file, 'acc-sync', DEV_B);
    const other = await call(app, 'POST', '/v1/sync', {
      headers: { authorization: 'Bearer ' + tokenB, 'x-device-id': DEV_B },
      json: { since: 0, records: [] },
    });
    expect(other.status).toBe(200);
    expect((other.data.records as { id: string }[]).some((r) => r.id === 'progress:abc:1')).toBe(true);

    const state = await readState(file);
    state.subscriptions.forEach((s: { paidUntil: number }) => {
      s.paidUntil = 1;
    });
    state.settings = { ...state.settings, syncAudience: 'subscribers' };
    await writeState(file, state);
    const lapsed = await call(app, 'POST', '/v1/sync', { headers: headersA, json: { since: 0, records: [] } });
    expect(lapsed.status).toBe(403);
    expect(lapsed.data.error).toBe('subscribers_only');

    const open = await readState(file);
    open.settings = { ...open.settings, syncAudience: 'all' };
    await writeState(file, open);
    const everyone = await call(app, 'POST', '/v1/sync', { headers: headersA, json: { since: 0, records: [] } });
    expect(everyone.status).toBe(200);
  });
});

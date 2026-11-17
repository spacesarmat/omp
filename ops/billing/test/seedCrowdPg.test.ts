// Phase 3 crowd storage on Postgres: migration 016 round-trip, dedup, prune, privacy, and the
// watch-signals / seed-check routes. Runs in CI (BILLING_TEST_DATABASE_URL); the pure policy is
// covered without a database in seedCrowd.test.ts.
import { activate, createSubscription, deviceCode } from '../src/logic.mjs';
import { createApp } from '../src/server.mjs';
import { createCrowdRepo, loadCrowdReports, saveCrowdReports } from '../src/db/pg/seedCrowdSql.mjs';
import { CROWD_DEDUP_MS, CROWD_WINDOW_MS, crowdDeviceKey } from '../src/seedCrowd.mjs';
import { emptyState } from '../src/state.mjs';
import { readState, testStore, writeState } from './pg';

const HASH = 'ab'.repeat(20);
const HASH_B = 'cd'.repeat(20);
const DEV = 'b'.repeat(32);
const DEV2 = 'c'.repeat(32);

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
  opts: { body?: string; json?: unknown; headers?: Record<string, string> } = {},
) {
  const payload = opts.body !== undefined ? opts.body : opts.json === undefined ? '' : JSON.stringify(opts.json);
  const type = opts.body !== undefined ? 'application/x-www-form-urlencoded' : opts.json === undefined ? '' : 'application/json';
  const req = {
    method,
    url: path,
    headers: { 'x-forwarded-proto': 'https', 'content-type': type, ...(opts.headers || {}) },
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
  return { status: res.status, data, headers: res.headers, body: res.body };
}

/** An activated device on a fresh subscription: the bearer headers the routes expect. */
async function activatedDevice(file: Awaited<ReturnType<typeof testStore>>, deviceId: string, accountId: string) {
  const now = Date.now();
  const created = createSubscription(emptyState(), { accountId, now, days: 30 });
  const act = activate(created.state, { code: created.result.code, deviceId, now });
  await writeState(file, act.state);
  const app = createApp(file, async () => ({ status: 200, headers: { get: () => null }, text: async () => '{}' }), {
    env: {},
    monitor: { health: () => null },
    seedTransport: { http: async () => null, udp: async () => null },
  });
  const slot = deviceCode(await readState(file), created.result.subscriptionId, Date.now());
  await writeState(file, slot.state);
  const activated = await call(app, 'POST', '/v1/activate', { json: { code: slot.code, deviceId, tokens: 'pair' } });
  expect(activated.status).toBe(200);
  return { app, headers: { authorization: 'Bearer ' + (activated.data.accessToken as string), 'x-device-id': deviceId } };
}

describe('seed_crowd storage', () => {
  it('round-trips reports into a median aggregate of distinct devices', async () => {
    const store = await testStore();
    const repo = createCrowdRepo(store);
    const now = Date.now();
    const k1 = crowdDeviceKey('row-1');
    const k2 = crowdDeviceKey('row-2');
    expect(await repo.save(k1, [{ infohash: HASH, seeders: 2, leechers: 0 }], now - 3_600_000)).toBe(1);
    expect(await repo.save(k2, [{ infohash: HASH, seeders: 10, leechers: 4 }], now - 60_000)).toBe(1);
    const out = await repo.fetchCounts([HASH]);
    expect(out.get(HASH)).toMatchObject({ seeders: 6, leechers: 2, devices: 2, source: 'crowd' });
    expect(out.get(HASH).updatedAt).toBe(now - 3_600_000);
    // a single device is not an estimate
    const solo = await repo.fetchCounts([HASH_B]);
    expect(solo.size).toBe(0);
    await repo.save(k1, [{ infohash: HASH_B, seeders: 5, leechers: 1 }], now);
    expect((await repo.fetchCounts([HASH_B])).size).toBe(0);
  });

  it('dedups a device+hash inside the window and accepts the next report after it', async () => {
    const store = await testStore();
    const query = (sql: string, params: unknown[]) => store.query(sql, params);
    const key = crowdDeviceKey('row-d');
    const now = Date.now();
    expect(await saveCrowdReports(query, key, [{ infohash: HASH, seeders: 3, leechers: 1 }], now)).toBe(1);
    expect(await saveCrowdReports(query, key, [{ infohash: HASH, seeders: 99, leechers: 9 }], now + 1000)).toBe(0);
    const rows = await loadCrowdReports(query, [HASH], now + 1000);
    expect(rows[0].seeders).toBe(3);
    expect(await saveCrowdReports(query, key, [{ infohash: HASH, seeders: 7, leechers: 2 }], now + CROWD_DEDUP_MS + 1)).toBe(1);
    const after = await loadCrowdReports(query, [HASH], now + CROWD_DEDUP_MS + 1);
    expect(after[0].seeders).toBe(7);
  });

  it('prunes reports older than the window on write', async () => {
    const store = await testStore();
    const query = (sql: string, params: unknown[]) => store.query(sql, params);
    const key = crowdDeviceKey('row-p');
    const now = Date.now();
    await saveCrowdReports(query, key, [{ infohash: HASH, seeders: 3, leechers: 1 }], now - CROWD_WINDOW_MS - 10_000);
    await saveCrowdReports(query, crowdDeviceKey('row-p2'), [{ infohash: HASH_B, seeders: 4, leechers: 0 }], now);
    const left = await query('SELECT infohash FROM seed_crowd', []);
    expect(left.rows.map((r: { infohash: string }) => r.infohash)).toEqual([HASH_B]);
  });

  it('stores only the hash, the irreversible key, the counts and the timestamp', async () => {
    const store = await testStore();
    const query = (sql: string, params: unknown[]) => store.query(sql, params);
    const key = crowdDeviceKey('row-priv');
    const now = Date.now();
    await saveCrowdReports(query, key, [{ infohash: HASH, seeders: 3, leechers: 1 }], now);
    const cols = await query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'seed_crowd' ORDER BY ordinal_position",
      [],
    );
    expect(cols.rows.map((r: { column_name: string }) => r.column_name)).toEqual([
      'infohash',
      'device_key',
      'seeders',
      'leechers',
      'reported_at',
    ]);
    const row = await query('SELECT device_key FROM seed_crowd WHERE infohash = $1', [HASH]);
    expect(row.rows[0].device_key).toBe(key);
    expect(row.rows[0].device_key).not.toContain('row-priv');
  });
});

describe('watch-signals swarm field and seed-check crowd', () => {
  it('accepts swarm reports along the signal path and keeps the device key irreversible', async () => {
    const file = await testStore();
    const { app, headers } = await activatedDevice(file, DEV, 'acc-crowd');
    const swarm = [{ infohash: HASH, seeders: 6, leechers: 2, title: 'dropped', trackers: ['http://t/announce'] }];
    const body = 'help=1&deviceId=' + DEV + '&swarm=' + encodeURIComponent(JSON.stringify(swarm));
    const out = await call(app, 'POST', '/v1/watch-signals', { body, headers });
    expect(out.status).toBe(200);
    expect(out.data.accepted).toBe(0);
    expect(out.data.crowd).toBe(1);
    const rows = await file.query('SELECT device_key, seeders, leechers FROM seed_crowd WHERE infohash = $1', [HASH]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].seeders).toBe(6);
    expect(rows.rows[0].device_key).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.rows[0].device_key).not.toContain(DEV);
    expect(out.body).not.toContain('http://t/announce');
    // a repeat inside the dedup window is accepted by the route but writes nothing
    const again = await call(app, 'POST', '/v1/watch-signals', { body, headers });
    expect(again.data.crowd).toBe(0);
    // help off stores nothing
    const off = await call(app, 'POST', '/v1/watch-signals', { body: 'help=0&swarm=' + encodeURIComponent(JSON.stringify([{ infohash: HASH_B, seeders: 1, leechers: 0 }])), headers });
    expect(off.data.crowd).toBe(0);
    expect((await file.query('SELECT 1 FROM seed_crowd WHERE infohash = $1', [HASH_B])).rows).toHaveLength(0);
    // a malformed swarm field refuses the signal
    const bad = await call(app, 'POST', '/v1/watch-signals', { body: 'swarm=nope', headers });
    expect(bad.status).toBe(400);
  });

  it('feeds the seed-check answer as a crowd estimate, never live and never in seed_probes', async () => {
    const file = await testStore();
    const a = await activatedDevice(file, DEV, 'acc-c1');
    const b = await activatedDevice(file, DEV2, 'acc-c2');
    const report = (seeders: number) => 'help=1&swarm=' + encodeURIComponent(JSON.stringify([{ infohash: HASH, seeders, leechers: 1 }]));
    expect((await call(a.app, 'POST', '/v1/watch-signals', { body: report(4), headers: a.headers })).data.crowd).toBe(1);
    expect((await call(b.app, 'POST', '/v1/watch-signals', { body: report(10), headers: b.headers })).data.crowd).toBe(1);
    const check = await call(a.app, 'POST', '/v1/seed-check', {
      body: 'items=' + encodeURIComponent(JSON.stringify([{ infohash: HASH, trackers: [] }])),
      headers: a.headers,
    });
    expect(check.status).toBe(200);
    const items = check.data.items as { source?: string; seeders: number; estimate: boolean; live: boolean; verified: boolean; ageMs?: number }[];
    expect(items[0]).toMatchObject({ source: 'crowd', seeders: 7, estimate: true, live: false, verified: false });
    expect(typeof items[0].ageMs).toBe('number');
    expect(check.body).not.toContain(DEV);
    // the estimate stays out of seed_probes: the stored miss row is not live and carries no crowd counts
    const probes = await file.query('SELECT live, seeders FROM seed_probes WHERE infohash = $1', [HASH]);
    expect(probes.rows[0].live).toBe(false);
    expect(probes.rows[0].seeders).toBe(0);
  });
});

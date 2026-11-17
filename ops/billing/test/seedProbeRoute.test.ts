import { describe, expect, it } from 'vitest';
import { activate, createSubscription, deviceCode } from '../src/logic.mjs';
import { createApp, formatSeedLog } from '../src/server.mjs';
import { createPgSeedCache, listPopularSeedProbes } from '../src/db/pg/seedProbeSql.mjs';
import { TTL_POPULAR_MS, runSeedCheck } from '../src/seedProbe.mjs';
import { emptyState } from '../src/state.mjs';
import { readState, testStore, writeState } from './pg';

const HASH = 'ab'.repeat(20);
const HASH_B = 'cd'.repeat(20);
const DEV = 'b'.repeat(32);

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
    headers: {
      'x-forwarded-proto': 'https',
      'content-type': type,
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
  return { status: res.status, data, headers: res.headers, body: res.body };
}

describe('POST /v1/seed-check', () => {
  it('checks the top hash, caches it, and refuses a bad token', async () => {
    const file = await testStore();
    const now = Date.now();
    const created = createSubscription(emptyState(), { accountId: 'acc', now, days: 30 });
    const act = activate(created.state, { code: created.result.code, deviceId: DEV, now });
    await writeState(file, act.state);
    let calls = 0;
    const app = createApp(file, async () => ({ status: 200, headers: { get: () => null }, text: async () => '{}' }), {
      env: {},
      monitor: { health: () => null },
      seedTransport: {
        http: async () => {
          calls += 1;
          return { seeders: 8, leechers: 2 };
        },
        udp: async () => null,
      },
    });
    const slot = deviceCode(await readState(file), created.result.subscriptionId, Date.now());
    await writeState(file, slot.state);
    const activated = await call(app, 'POST', '/v1/activate', { json: { code: slot.code, deviceId: DEV, tokens: 'pair' } });
    expect(activated.status).toBe(200);
    const token = activated.data.accessToken as string;
    const headers = { authorization: 'Bearer ' + token, 'x-device-id': DEV };
    const denied = await call(app, 'POST', '/v1/seed-check', { json: { items: [] }, headers: {} });
    expect(denied.status).toBe(401);
    const bad = await call(app, 'POST', '/v1/seed-check', { json: { items: 'nope' }, headers });
    expect(bad.status).toBe(400);
    const body = 'items=' + encodeURIComponent(JSON.stringify([
      { infohash: HASH, trackers: ['http://tracker.example/announce', 'http://127.0.0.1/announce'] },
    ]));
    const first = await call(app, 'POST', '/v1/seed-check', { body, headers });
    expect(first.status).toBe(200);
    const items = first.data.items as { seeders: number; live: boolean; cached: boolean; peers: number }[];
    expect(items[0]).toMatchObject({ seeders: 8, live: true, cached: false, peers: 0 });
    expect(calls).toBe(1);
    expect(first.body).not.toContain('tracker.example');
    const again = await call(app, 'POST', '/v1/seed-check', { body, headers });
    expect(again.status).toBe(200);
    expect((again.data.items as { cached: boolean }[])[0].cached).toBe(true);
    expect(calls).toBe(1);
    const line = formatSeedLog(200, 12, DEV, { asked: 1, cache: 1, live: 1, dht: 0 });
    expect(line).toContain('seed-check status=200');
    expect(line).not.toContain(HASH);
    expect(line).not.toContain(DEV);
  });

  it('stores a row in seed_probes and reads it back', async () => {
    const store = await testStore();
    const cache = createPgSeedCache(store);
    const at = Date.now();
    await cache.save([
      {
        infohash: HASH,
        trackerKey: 'tracker.example',
        seeders: 3,
        leechers: 1,
        seedersMax: 3,
        seedersMedian: 3,
        peers: 0,
        samples: 1,
        measuredAt: at,
        live: true,
      },
    ]);
    const key = [{ infohash: HASH, trackerKey: 'tracker.example' }];
    await cache.touch(key, at + 5);
    const rows = await cache.get(key);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ infohash: HASH, seeders: 3, leechers: 1, hits: 2, live: true, measuredAt: at });
  });

  it('round-trips completed and public trackers, and selects one popular stale row', async () => {
    const store = await testStore();
    const cache = createPgSeedCache(store);
    const query = (sql: string, params: unknown[]) => store.query(sql, params);
    const at = Date.now();
    await cache.save([
      {
        infohash: HASH,
        trackerKey: 'tracker.example',
        seeders: 20,
        leechers: 1,
        completed: 1234,
        seedersMax: 20,
        seedersMedian: 20,
        peers: 0,
        samples: 1,
        measuredAt: at,
        live: true,
        trackers: ['http://tracker.example/announce'],
      },
    ]);
    const key = [{ infohash: HASH, trackerKey: 'tracker.example' }];
    const rows = await cache.get(key);
    expect(rows[0]).toMatchObject({ completed: 1234, trackers: ['http://tracker.example/announce'] });
    // popular by seeds and past half the popular TTL: due
    const due = await listPopularSeedProbes(query, at + TTL_POPULAR_MS / 2 + 1000, 1);
    expect(due.map((r: { infohash: string }) => r.infohash)).toEqual([HASH]);
    // still fresh: not due
    expect(await listPopularSeedProbes(query, at + 1000, 1)).toEqual([]);
    // an old row without stored trackers (pre-015) is skipped, not refreshed
    await cache.save([
      {
        infohash: HASH_B,
        trackerKey: 'old.example',
        seeders: 40,
        leechers: 0,
        seedersMax: 40,
        seedersMedian: 40,
        peers: 0,
        samples: 1,
        measuredAt: at - TTL_POPULAR_MS,
        live: true,
      },
    ]);
    const only = await listPopularSeedProbes(query, at + TTL_POPULAR_MS, 5);
    expect(only.map((r: { infohash: string }) => r.infohash)).toEqual([HASH]);
    // a re-save updates completed and trackers in place, hits grow
    await cache.save([
      {
        infohash: HASH,
        trackerKey: 'tracker.example',
        seeders: 25,
        leechers: 2,
        completed: 2000,
        seedersMax: 25,
        seedersMedian: 25,
        peers: 0,
        samples: 1,
        measuredAt: at + TTL_POPULAR_MS,
        live: true,
        trackers: ['http://tracker.example/announce', 'udp://udp.example:6969/announce'],
      },
    ]);
    const again = await cache.get(key);
    expect(again[0]).toMatchObject({ seeders: 25, completed: 2000, hits: 2, trackers: ['http://tracker.example/announce', 'udp://udp.example:6969/announce'] });
  });

  it('answers completed from the scrape and stores trackers without the passkey', async () => {
    const file = await testStore();
    const now = Date.now();
    const created = createSubscription(emptyState(), { accountId: 'acc', now, days: 30 });
    const act = activate(created.state, { code: created.result.code, deviceId: DEV, now });
    await writeState(file, act.state);
    const app = createApp(file, async () => ({ status: 200, headers: { get: () => null }, text: async () => '{}' }), {
      env: {},
      monitor: { health: () => null },
      seedTransport: {
        http: async () => ({ seeders: 8, leechers: 2, completed: 500 }),
        udp: async () => null,
      },
    });
    const slot = deviceCode(await readState(file), created.result.subscriptionId, Date.now());
    await writeState(file, slot.state);
    const activated = await call(app, 'POST', '/v1/activate', { json: { code: slot.code, deviceId: DEV, tokens: 'pair' } });
    expect(activated.status).toBe(200);
    const headers = { authorization: 'Bearer ' + (activated.data.accessToken as string), 'x-device-id': DEV };
    const body = 'items=' + encodeURIComponent(JSON.stringify([
      { infohash: HASH, trackers: ['http://tracker.example/announce?passkey=secret'] },
    ]));
    const out = await call(app, 'POST', '/v1/seed-check', { body, headers });
    expect(out.status).toBe(200);
    expect((out.data.items as { completed: number }[])[0]).toMatchObject({ seeders: 8, completed: 500 });
    expect(out.body).not.toContain('passkey');
    expect(out.body).not.toContain('tracker.example');
    const cache = createPgSeedCache(file);
    const rows = await cache.get([{ infohash: HASH, trackerKey: 'tracker.example' }]);
    expect(rows[0]).toMatchObject({ completed: 500, trackers: ['http://tracker.example/announce'] });
  });

  it('a passkey in the announce path is scraped with the full URL but never stored', async () => {
    const file = await testStore();
    const now = Date.now();
    const created = createSubscription(emptyState(), { accountId: 'acc', now, days: 30 });
    const act = activate(created.state, { code: created.result.code, deviceId: DEV, now });
    await writeState(file, act.state);
    const seen: string[] = [];
    const app = createApp(file, async () => ({ status: 200, headers: { get: () => null }, text: async () => '{}' }), {
      env: {},
      monitor: { health: () => null },
      seedTransport: {
        http: async (url: string) => {
          seen.push(url);
          return { seeders: 8, leechers: 2, completed: 500 };
        },
        udp: async () => null,
      },
    });
    const slot = deviceCode(await readState(file), created.result.subscriptionId, Date.now());
    await writeState(file, slot.state);
    const activated = await call(app, 'POST', '/v1/activate', { json: { code: slot.code, deviceId: DEV, tokens: 'pair' } });
    expect(activated.status).toBe(200);
    const headers = { authorization: 'Bearer ' + (activated.data.accessToken as string), 'x-device-id': DEV };
    const body = 'items=' + encodeURIComponent(JSON.stringify([
      { infohash: HASH, trackers: ['https://tracker.example/secret/announce?passkey=abc'] },
    ]));
    const out = await call(app, 'POST', '/v1/seed-check', { body, headers });
    expect(out.status).toBe(200);
    expect((out.data.items as { live: boolean }[])[0].live).toBe(true);
    // the foreground scrape used the original credential-bearing address
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('tracker.example/secret/scrape?passkey=abc');
    expect(out.body).not.toContain('passkey');
    expect(out.body).not.toContain('secret');
    // nothing credential-bearing is stored; the row cannot be refreshed and is not selected
    const cache = createPgSeedCache(file);
    const rows = await cache.get([{ infohash: HASH, trackerKey: 'tracker.example' }]);
    expect(rows[0].trackers).toEqual([]);
    expect(JSON.stringify(rows[0])).not.toContain('secret');
    expect(JSON.stringify(rows[0])).not.toContain('passkey');
    const due = await listPopularSeedProbes((sql: string, params: unknown[]) => file.query(sql, params), Date.now() + TTL_POPULAR_MS, 5);
    expect(due).toEqual([]);
  });

  it('a failed forced refresh preserves the stored row in Postgres', async () => {
    const store = await testStore();
    const cache = createPgSeedCache(store);
    const at = Date.now();
    await cache.save([
      {
        infohash: HASH,
        trackerKey: 'tracker.example',
        seeders: 20,
        leechers: 2,
        completed: 500,
        seedersMax: 20,
        seedersMedian: 20,
        peers: 0,
        samples: 1,
        measuredAt: at,
        live: true,
        trackers: ['http://tracker.example/announce'],
      },
    ]);
    const key = [{ infohash: HASH, trackerKey: 'tracker.example' }];
    const before = (await cache.get(key))[0];
    // the refresh scrape fails (e.g. the tracker wants the passkey that storage dropped)
    const out = await runSeedCheck({
      items: [{ infohash: HASH, trackers: ['http://tracker.example/announce'] }],
      cache,
      now: () => at + TTL_POPULAR_MS / 2 + 1000,
      transport: { http: async () => null, udp: async () => null },
      force: true,
      deadlineMs: 1000,
      timeoutMs: 500,
    });
    expect(out.stats.live).toBe(0);
    const after = (await cache.get(key))[0];
    expect(after).toEqual(before);
    expect(after).toMatchObject({ seeders: 20, completed: 500, live: true, measuredAt: at, hits: 1 });
  });
});

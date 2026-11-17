import { describe, expect, it } from 'vitest';
import { activate, createSubscription, deviceCode } from '../src/logic.mjs';
import { createApp, formatSeedLog } from '../src/server.mjs';
import { createPgSeedCache, listPopularSeedProbes } from '../src/db/pg/seedProbeSql.mjs';
import { REFRESH_BACKOFF_MS, TTL_POPULAR_MS, runSeedCheck } from '../src/seedProbe.mjs';
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
    const attempt = at + TTL_POPULAR_MS / 2 + 1000;
    const out = await runSeedCheck({
      items: [{ infohash: HASH, trackers: ['http://tracker.example/announce'] }],
      cache,
      now: () => attempt,
      transport: { http: async () => null, udp: async () => null },
      force: true,
      deadlineMs: 1000,
      timeoutMs: 500,
    });
    expect(out.stats.live).toBe(0);
    const after = (await cache.get(key))[0];
    // the measurement survives; only the attempt stamp is added
    expect(after).toMatchObject({ seeders: 20, leechers: 2, completed: 500, live: true, measuredAt: at, hits: 1, samples: 1 });
    expect(after.trackers).toEqual(before.trackers);
    expect(after.refreshedAt).toBe(attempt);
    expect(before.refreshedAt).toBe(0);
  });

  it('selection backs off a tried row and takes the next due hash; success stamps and updates', async () => {
    const store = await testStore();
    const cache = createPgSeedCache(store);
    const query = (sql: string, params: unknown[]) => store.query(sql, params);
    const at = Date.now();
    const stale = at - TTL_POPULAR_MS;
    const row = (infohash: string, host: string, hits: number) => ({
      infohash,
      trackerKey: host,
      seeders: 30,
      leechers: 1,
      completed: 10,
      seedersMax: 30,
      seedersMedian: 30,
      peers: 0,
      samples: 1,
      measuredAt: stale,
      live: true,
      trackers: ['http://' + host + '/announce'],
      hits,
    });
    // save() sets hits=1 on insert and +1 on conflict: reach the wanted counts with re-saves
    await cache.save([row(HASH, 'dead.example', 0)]);
    await cache.save([row(HASH, 'dead.example', 0)]);
    await cache.save([row(HASH, 'dead.example', 0)]);
    await cache.save([row(HASH_B, 'live.example', 0)]);
    await cache.save([row(HASH_B, 'live.example', 0)]);
    const top = await listPopularSeedProbes(query, at, 1);
    expect(top.map((r: { infohash: string }) => r.infohash)).toEqual([HASH]);
    expect(top[0].hits).toBe(3);
    // the top row's trackers are down: the attempt fails, counts stay, the stamp backs it off
    await runSeedCheck({
      items: [{ infohash: HASH, trackers: ['http://dead.example/announce'] }],
      cache,
      now: () => at,
      transport: { http: async () => null, udp: async () => null },
      force: true,
      deadlineMs: 1000,
      timeoutMs: 500,
    });
    const next = await listPopularSeedProbes(query, at + 1000, 1);
    expect(next.map((r: { infohash: string }) => r.infohash)).toEqual([HASH_B]);
    const kept = (await cache.get([{ infohash: HASH, trackerKey: 'dead.example' }]))[0];
    expect(kept).toMatchObject({ seeders: 30, live: true, measuredAt: stale, hits: 3, refreshedAt: at });
    // a successful refresh of the next row updates counts and stamps the attempt
    const good = await runSeedCheck({
      items: [{ infohash: HASH_B, trackers: ['http://live.example/announce'] }],
      cache,
      now: () => at + 2000,
      transport: { http: async () => ({ seeders: 40, leechers: 2, completed: 99 }), udp: async () => null },
      force: true,
      deadlineMs: 1000,
      timeoutMs: 500,
    });
    expect(good.items[0]).toMatchObject({ live: true, seeders: 40, completed: 99 });
    const updated = (await cache.get([{ infohash: HASH_B, trackerKey: 'live.example' }]))[0];
    expect(updated).toMatchObject({ seeders: 40, completed: 99, measuredAt: at + 2000, refreshedAt: at + 2000 });
    // both rows are inside the backoff now: nothing is due
    expect(await listPopularSeedProbes(query, at + 3000, 5)).toEqual([]);
    // once the backoff passes, the most asked row is selectable again
    const later = await listPopularSeedProbes(query, at + REFRESH_BACKOFF_MS + 1000, 1);
    expect(later.map((r: { infohash: string }) => r.infohash)).toEqual([HASH]);
  });

  it('mixed credential and clean trackers store nothing, so selection skips the row', async () => {
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
          return { seeders: 30, leechers: 1 };
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
      { infohash: HASH, trackers: ['https://private.example/secret/announce?passkey=abc', 'http://clean.example/announce'] },
    ]));
    const out = await call(app, 'POST', '/v1/seed-check', { body, headers });
    expect(out.status).toBe(200);
    // the foreground scrape used both original addresses
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain('private.example/secret/scrape?passkey=abc');
    expect(out.body).not.toContain('passkey');
    expect(out.body).not.toContain('secret');
    // the mixed list cannot rebuild the tracker key: nothing is stored, the row is never selected
    const cache = createPgSeedCache(file);
    const rows = await cache.get([{ infohash: HASH, trackerKey: 'clean.example,private.example' }]);
    expect(rows[0]).toMatchObject({ seeders: 30, live: true, trackers: [] });
    const due = await listPopularSeedProbes((sql: string, params: unknown[]) => file.query(sql, params), Date.now() + TTL_POPULAR_MS, 5);
    expect(due).toEqual([]);
  });

  it('bitmagnet estimates reach tracker-less hashes over the admin URL and stay out of seed_probes', async () => {
    const file = await testStore();
    const now = Date.now();
    const created = createSubscription(emptyState(), { accountId: 'acc', now, days: 30 });
    const act = activate(created.state, { code: created.result.code, deviceId: DEV, now });
    await writeState(file, act.state);
    let graphqlCalls = 0;
    const iso = new Date(Date.now() - 60_000).toISOString();
    const app = createApp(
      file,
      async (url: string) => {
        if (String(url).indexOf('/graphql') >= 0) {
          graphqlCalls += 1;
          return {
            status: 200,
            headers: { get: () => null },
            json: async () => ({
              data: {
                torrentContent: {
                  search: {
                    items: [
                      { infoHash: HASH_B, seeders: 30, leechers: 5, updatedAt: iso, torrent: { seeders: 30, leechers: 5, updatedAt: iso } },
                    ],
                  },
                },
              },
            }),
            text: async () => '{}',
          };
        }
        return { status: 200, headers: { get: () => null }, text: async () => '{}' };
      },
      {
        env: {},
        monitor: { health: () => null },
        seedTransport: {
          http: async () => ({ seeders: 8, leechers: 2 }),
          udp: async () => null,
        },
      },
    );
    const slot = deviceCode(await readState(file), created.result.subscriptionId, Date.now());
    await writeState(file, slot.state);
    const activated = await call(app, 'POST', '/v1/activate', { json: { code: slot.code, deviceId: DEV, tokens: 'pair' } });
    expect(activated.status).toBe(200);
    const st = await readState(file);
    await writeState(file, { ...st, settings: { ...st.settings, bitmagnetEnabled: true, bitmagnetUrl: 'http://192.0.2.10:3333' } });
    const headers = { authorization: 'Bearer ' + (activated.data.accessToken as string), 'x-device-id': DEV };
    const body = 'items=' + encodeURIComponent(JSON.stringify([
      { infohash: HASH, trackers: ['http://tracker.example/announce'] },
      { infohash: HASH_B, trackers: [] },
    ]));
    const first = await call(app, 'POST', '/v1/seed-check', { body, headers });
    expect(first.status).toBe(200);
    const items = first.data.items as Record<string, unknown>[];
    expect(items[0]).toMatchObject({ seeders: 8, live: true, verified: true, estimate: false });
    expect(items[0].source).toBeUndefined();
    expect(items[1]).toMatchObject({ seeders: 30, leechers: 5, live: false, verified: false, estimate: true, source: 'bitmagnet', noTracker: true, samples: 0 });
    expect(items[1].ageMs as number).toBeGreaterThanOrEqual(59_000);
    expect(graphqlCalls).toBe(1);
    expect(first.body).not.toContain('192.0.2.10');
    // the second answer comes from the caches: no scrape, no second GraphQL batch inside the TTL
    const again = await call(app, 'POST', '/v1/seed-check', { body, headers });
    expect(again.status).toBe(200);
    const items2 = again.data.items as Record<string, unknown>[];
    expect(items2[0]).toMatchObject({ seeders: 8, cached: true });
    expect(items2[1]).toMatchObject({ seeders: 30, source: 'bitmagnet', estimate: true, live: false, cached: true });
    expect(graphqlCalls).toBe(1);
    // the estimate is response-time only: seed_probes keeps the tracker-less miss, never popular
    const cache = createPgSeedCache(file);
    const rows = await cache.get([{ infohash: HASH_B, trackerKey: '' }]);
    expect(rows[0]).toMatchObject({ seeders: 0, leechers: 0, live: false, samples: 0 });
    const due = await listPopularSeedProbes((sql: string, params: unknown[]) => file.query(sql, params), Date.now() + TTL_POPULAR_MS, 5);
    expect(due.map((r: { infohash: string }) => r.infohash)).not.toContain(HASH_B);
    // the log line carries the estimate counter, never a hash or an address
    const line = formatSeedLog(200, 12, DEV, { asked: 2, cache: 0, live: 1, dht: 0, bitmagnet: 1 });
    expect(line).toContain('bitmagnet=1');
    expect(line).not.toContain(HASH_B);
    expect(line).not.toContain('192.0.2.10');
  });

  it('the bitmagnet switch off keeps seed-check away from GraphQL', async () => {
    const file = await testStore();
    const now = Date.now();
    const created = createSubscription(emptyState(), { accountId: 'acc', now, days: 30 });
    const act = activate(created.state, { code: created.result.code, deviceId: DEV, now });
    await writeState(file, act.state);
    let graphqlCalls = 0;
    const app = createApp(
      file,
      async (url: string) => {
        if (String(url).indexOf('/graphql') >= 0) graphqlCalls += 1;
        return { status: 200, headers: { get: () => null }, text: async () => '{}' };
      },
      {
        env: {},
        monitor: { health: () => null },
        seedTransport: { http: async () => null, udp: async () => null },
      },
    );
    const slot = deviceCode(await readState(file), created.result.subscriptionId, Date.now());
    await writeState(file, slot.state);
    const activated = await call(app, 'POST', '/v1/activate', { json: { code: slot.code, deviceId: DEV, tokens: 'pair' } });
    expect(activated.status).toBe(200);
    const st = await readState(file);
    // the URL is saved but the switch stays off, as before the Torznab search is enabled
    await writeState(file, { ...st, settings: { ...st.settings, bitmagnetUrl: 'http://192.0.2.10:3333' } });
    const headers = { authorization: 'Bearer ' + (activated.data.accessToken as string), 'x-device-id': DEV };
    const body = 'items=' + encodeURIComponent(JSON.stringify([{ infohash: HASH_B, trackers: [] }]));
    const out = await call(app, 'POST', '/v1/seed-check', { body, headers });
    expect(out.status).toBe(200);
    expect((out.data.items as Record<string, unknown>[])[0]).toMatchObject({ seeders: 0, live: false, estimate: false });
    expect((out.data.items as Record<string, unknown>[])[0].source).toBeUndefined();
    expect(graphqlCalls).toBe(0);
  });
});

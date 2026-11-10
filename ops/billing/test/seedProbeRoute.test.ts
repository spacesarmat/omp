import { describe, expect, it } from 'vitest';
import { activate, createSubscription, deviceCode } from '../src/logic.mjs';
import { createApp, formatSeedLog } from '../src/server.mjs';
import { createPgSeedCache } from '../src/db/pg/seedProbeSql.mjs';
import { emptyState } from '../src/state.mjs';
import { readState, testStore, writeState } from './pg';

const HASH = 'ab'.repeat(20);
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
});

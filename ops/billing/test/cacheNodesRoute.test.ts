import { describe, expect, it } from 'vitest';
import { activate, createSubscription, deviceCode, issueCliAdminLogin } from '../src/logic.mjs';
import { createApp } from '../src/server.mjs';
import { resetPopularityClock } from '../src/cacheNodes.mjs';
import { upsertAssignment } from '../src/db/pg/cacheNodesSql.mjs';
import { emptyState } from '../src/state.mjs';
import { readState, testStore, writeState } from './pg';

const HASH = 'ab'.repeat(20);
const OTHER = 'cd'.repeat(20);
const DEAD = 'ef'.repeat(20);
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
  opts: { json?: unknown; headers?: Record<string, string> } = {},
) {
  const payload = opts.json === undefined ? '' : JSON.stringify(opts.json);
  const req = {
    method,
    url: path,
    headers: {
      'x-forwarded-proto': 'https',
      accept: 'application/json',
      ...(payload ? { 'content-type': 'application/json' } : {}),
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

describe('cache node routes', () => {
  it('migrates, authenticates a hashed token, and stays idle until the flag is on', async () => {
    resetPopularityClock();
    const store = await testStore();
    const tables = await store.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('cache_nodes', 'cache_assignments', 'cache_interest') ORDER BY 1",
    );
    expect(tables.rows.map((r: { table_name: string }) => r.table_name)).toEqual(['cache_assignments', 'cache_interest', 'cache_nodes']);

    const now = Date.now();
    const created = createSubscription(emptyState(), { accountId: 'acc', now, days: 30 });
    const act = activate(created.state, { code: created.result.code, deviceId: DEV, now });
    await writeState(store, act.state);
    const slot = deviceCode(await readState(store), created.result.subscriptionId, Date.now());
    await writeState(store, slot.state);
    const app = createApp(store, async () => ({ status: 200, headers: { get: () => null }, text: async () => '{}' }), {
      env: {},
      monitor: { health: () => null },
    });
    const activated = await call(app, 'POST', '/v1/activate', { json: { code: slot.code, deviceId: DEV, tokens: 'pair' } });
    expect(activated.status).toBe(200);
    const deviceHeaders = { authorization: 'Bearer ' + activated.data.accessToken, 'x-device-id': DEV };

    const issued = await store.update((cur: unknown) => issueCliAdminLogin(cur as never, { now: Date.now() }));
    const once = await call(app, 'GET', '/admin/login/once?token=' + encodeURIComponent((issued as { token: string }).token));
    expect(once.status).toBe(302);
    const cookie = /__Host-omp_admin=([^;]+)/.exec(String(once.headers['set-cookie'] || ''));
    expect(cookie).toBeTruthy();
    const adminHeaders = { cookie: '__Host-omp_admin=' + cookie![1] };
    const home = await call(app, 'GET', '/admin/api/cache', { headers: adminHeaders });
    expect(home.status).toBe(200);
    const csrf = home.data.csrf as string;
    expect(home.data.enabled).toBe(false);

    const denied = await call(app, 'GET', '/admin/api/cache');
    expect(denied.status).toBe(401);
    const noToken = await call(app, 'GET', '/v1/cache/source?infohash=' + HASH, { headers: { 'x-device-id': DEV } });
    expect(noToken.status).toBe(401);

    const made = await call(app, 'POST', '/admin/cache/node', {
      headers: adminHeaders,
      json: { csrf, name: 'Москва', url: 'http://cache.example:8090', region: 'ru', capacityGb: 2, prefixMb: 0, prefixPercent: 0 },
    });
    expect(made.status).toBe(200);
    expect(made.data.ok).toBe(true);
    const token = made.data.token as string;
    expect(token).toMatch(/^cn_[a-f0-9]{64}$/);
    const nodeId = (made.data.node as { id: string }).id;
    const stored = await store.query('SELECT token_hash FROM cache_nodes WHERE id = $1', [nodeId]);
    expect(stored.rows[0].token_hash).toHaveLength(64);
    expect(stored.rows[0].token_hash).not.toBe(token);
    expect(JSON.stringify(stored.rows)).not.toContain(token);

    const listed = await call(app, 'GET', '/admin/api/cache', { headers: adminHeaders });
    expect(listed.body).not.toContain(token);
    expect(listed.body).not.toContain(stored.rows[0].token_hash);
    expect((listed.data.nodes as { hasToken: boolean }[])[0].hasToken).toBe(true);

    const nodeHeaders = { authorization: 'Bearer ' + token };
    const bad = await call(app, 'POST', '/v1/cache/heartbeat', { headers: { authorization: 'Bearer cn_' + '0'.repeat(64) }, json: {} });
    expect(bad.status).toBe(401);
    const beat = await call(app, 'POST', '/v1/cache/heartbeat', {
      headers: nodeHeaders,
      json: { diskUsedBytes: 10, diskTotalBytes: 100, ok: true },
    });
    expect(beat.status).toBe(200);
    expect(beat.data.enabled).toBe(false);
    expect(beat.body).not.toContain(token);

    const off = await call(app, 'GET', '/v1/cache/source?infohash=' + HASH, { headers: deviceHeaders });
    expect(off.status).toBe(200);
    expect(off.data).toEqual({ enabled: false });
    const interestOff = await call(app, 'POST', '/v1/cache/interest', { headers: deviceHeaders, json: { infohash: HASH, event: 'play' } });
    expect(interestOff.data).toEqual({ enabled: false });
    expect((await store.query('SELECT count(*)::int AS n FROM cache_interest')).rows[0].n).toBe(0);

    const secretMagnet = 'magnet:?xt=urn:btih:' + HASH + '&tr=http://tracker.example/announce?passkey=supersecret';
    const rejected = await call(app, 'POST', '/admin/cache/pin', {
      headers: adminHeaders,
      json: { csrf, infohash: HASH, title: 'Film', nodeId, magnet: secretMagnet },
    });
    expect(rejected.data.ok).toBe(false);
    expect((await store.query('SELECT count(*)::int AS n FROM cache_assignments')).rows[0].n).toBe(0);
    expect(rejected.body).not.toContain('supersecret');

    const pinned = await call(app, 'POST', '/admin/cache/pin', {
      headers: adminHeaders,
      json: { csrf, infohash: HASH, title: 'Film', nodeId, magnet: '' },
    });
    expect(pinned.data.ok).toBe(true);
    const idle = await call(app, 'GET', '/v1/cache/assignments', { headers: nodeHeaders });
    expect(idle.data.enabled).toBe(false);
    expect(idle.data.assignments).toEqual([]);

    const turned = await call(app, 'POST', '/admin/cache/settings', { headers: adminHeaders, json: { csrf, enabled: true } });
    expect(turned.data.enabled).toBe(true);
    const pulled = await call(app, 'GET', '/v1/cache/assignments', { headers: nodeHeaders });
    expect(pulled.data.enabled).toBe(true);
    const assignment = (pulled.data.assignments as { id: string; magnet: string }[])[0];
    expect(assignment.magnet).toBe('magnet:?xt=urn:btih:' + HASH);
    const reported = await call(app, 'POST', '/v1/cache/report', {
      headers: nodeHeaders,
      json: { id: assignment.id, status: 'cached', error: 'passkey=nope' },
    });
    expect(reported.status).toBe(200);
    const source = await call(app, 'GET', '/v1/cache/source?infohash=' + HASH, { headers: deviceHeaders });
    expect(source.data).toEqual({
      enabled: true,
      source: { url: 'http://cache.example:8090', infohash: HASH, title: 'Film', prefixBytes: 512 * 1024 * 1024 },
    });
    expect(source.body).not.toContain(token);

    const played = await call(app, 'POST', '/v1/cache/interest', {
      headers: deviceHeaders,
      json: { infohash: OTHER, event: 'play', seeders: 4, title: 'Other' },
    });
    expect(played.data.enabled).toBe(true);
    await store.query('INSERT INTO cache_interest (infohash, title, searches, plays, seeders, size_bytes, updated_at) VALUES ($1, $2, 20, 0, 0, 0, $3)', [DEAD, 'dead', Date.now()]);
    resetPopularityClock();
    const recalc = await call(app, 'POST', '/admin/cache/recalc', { headers: adminHeaders, json: { csrf } });
    expect(recalc.data.skipped).toBe(false);
    const hashes = (await store.query("SELECT infohash FROM cache_assignments WHERE status <> 'removed' ORDER BY infohash")).rows.map((r: { infohash: string }) => r.infohash);
    expect(hashes).toContain(HASH);
    expect(hashes).toContain(OTHER);
    expect(hashes).not.toContain(DEAD);
    const kept = await store.query('SELECT pinned, source FROM cache_assignments WHERE infohash = $1', [HASH]);
    expect(kept.rows[0]).toEqual({ pinned: true, source: 'manual' });
    await upsertAssignment(
      (sql: string, params?: unknown[]) => store.query(sql, params),
      {
        id: 'f'.repeat(16),
        nodeId,
        infohash: HASH,
        title: 'Film',
        magnet: 'magnet:?xt=urn:btih:' + HASH,
        prefixBytes: 1,
        pinned: false,
        source: 'auto',
        protectManual: true,
      },
      Date.now(),
    );
    const still = await store.query('SELECT pinned, source FROM cache_assignments WHERE infohash = $1', [HASH]);
    expect(still.rows[0]).toEqual({ pinned: true, source: 'manual' });
    const fresh = '12'.repeat(20);
    await call(app, 'POST', '/v1/cache/interest', { headers: deviceHeaders, json: { infohash: fresh, event: 'search', seeders: 8 } });
    await call(app, 'POST', '/v1/cache/interest', { headers: deviceHeaders, json: { infohash: fresh, event: 'search', seeders: 0 } });
    const seeds = await store.query('SELECT seeders FROM cache_interest WHERE infohash = $1', [fresh]);
    expect(seeds.rows[0].seeders).toBe(0);

    const revoked = await call(app, 'POST', '/admin/cache/token/revoke', { headers: adminHeaders, json: { csrf, id: nodeId } });
    expect(revoked.data.ok).toBe(true);
    const after = await call(app, 'POST', '/v1/cache/heartbeat', { headers: nodeHeaders, json: {} });
    expect(after.status).toBe(401);
    const hidden = await call(app, 'GET', '/v1/cache/source?infohash=' + HASH, { headers: deviceHeaders });
    expect(hidden.data.source).toBeNull();
  });
});

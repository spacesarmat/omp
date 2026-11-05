import { describe, expect, it, beforeEach } from 'vitest';
import { issueCliAdminLogin } from '../src/logic.mjs';
import { DHT_PROBE_INFOHASH } from '../src/dhtPeers.mjs';
import { createApp } from '../src/server.mjs';
import { emptyState } from '../src/state.mjs';
import { dhtStatsView, noteDhtRequest, resetDhtStats } from '../src/dhtStats.mjs';

const TOKEN = 'cd'.repeat(16);
const HASH = 'ab'.repeat(20);

function memStore() {
  let cur = emptyState();
  return {
    engine: 'postgres',
    async read() {
      return cur;
    },
    async update(fn: (state: unknown) => Promise<{ state?: unknown; result?: unknown } | unknown> | { state?: unknown; result?: unknown } | unknown) {
      const out = await fn(cur);
      if (out && typeof out === 'object' && 'state' in out) {
        const boxed = out as { state?: unknown; result?: unknown };
        cur = boxed.state as typeof cur;
        return boxed.result !== undefined ? boxed.result : out;
      }
      cur = out as typeof cur;
      return out;
    },
    registry: {
      async tokenSecret() {
        return 'k'.repeat(40);
      },
      async verifyAccess() {
        return { error: 'bad_token' };
      },
    },
    async info() {
      return { engine: 'memory' };
    },
    async close() {},
  };
}

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

async function call(app: (req: unknown, res: unknown) => Promise<void>, path: string, headers: Record<string, string> = {}) {
  const req = {
    method: 'GET',
    url: path,
    headers: { accept: 'application/json', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {},
  };
  const res = mockRes();
  await app(req, res);
  return { status: res.status, body: res.body, headers: res.headers };
}

describe('GET /admin/api/dht', () => {
  beforeEach(() => resetDhtStats());

  it('is admin-only and returns sidecar health plus counters, with no secrets', async () => {
    const now = Date.now();
    noteDhtRequest({ status: 200, ms: 80, peers: 3 }, now - 1000);
    noteDhtRequest({ status: 401, ms: 5, reason: 'bad_token' }, now - 500);
    const store = memStore();
    const issued = await store.update((cur) => issueCliAdminLogin(cur as never, { now }));
    const token = (issued as { token: string }).token;
    let healthCalls = 0;
    const net = async (url: string, init?: { headers?: { authorization?: string } }) => {
      healthCalls++;
      expect(String(url)).toBe('http://dht-peers:8788/health');
      expect(init && init.headers ? init.headers.authorization || '' : '').toBe('');
      return { status: 200, text: async () => JSON.stringify({ ok: true, dht: 'up', rss: 50 * 1024 * 1024 }) };
    };
    const app = createApp(store, net, {
      env: { BILLING_DHT_URL: 'http://dht-peers:8788', BILLING_DHT_TOKEN: TOKEN },
      monitor: { health: () => null },
    });
    const denied = await call(app, '/admin/api/dht');
    expect(denied.status).toBe(401);
    expect(JSON.parse(denied.body)).toEqual({ auth: false });
    expect(healthCalls).toBe(0);

    const once = await call(app, '/admin/login/once?token=' + encodeURIComponent(token));
    expect(once.status).toBe(302);
    const cookie = String(once.headers['set-cookie'] || '');
    const m = /omp_admin=([^;]+)/.exec(cookie);
    expect(m).toBeTruthy();
    const res = await call(app, '/admin/api/dht', { cookie: 'omp_admin=' + m![1] });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.configured).toBe(true);
    expect(body.sidecar).toMatchObject({ configured: true, ok: true, dht: 'up', rss: 50 * 1024 * 1024 });
    expect(body.stats.requests24h).toBe(2);
    expect(body.stats.withPeers24h).toBe(1);
    expect(body.stats.errors4xx24h).toBe(1);
    expect(body.stats.errors5xx24h).toBe(0);
    expect(body.limit).toEqual({ perMinute: 30, windowSec: 60 });
    expect(Array.isArray(body.stats.series)).toBe(true);
    expect(body.stats.series.reduce((sum: number, p: { requests: number }) => sum + p.requests, 0)).toBe(2);
    expect(body.stats.errors).toHaveLength(1);
    expect(body.stats.errors[0].reason).toBe('нет токена');
    const raw = res.body;
    expect(raw).not.toContain(TOKEN);
    expect(raw).not.toContain(HASH);
    expect(healthCalls).toBe(1);
  });
});

async function post(app: (req: unknown, res: unknown) => Promise<void>, path: string, headers: Record<string, string>, body: unknown) {
  const payload = JSON.stringify(body || {});
  const req = {
    method: 'POST',
    url: path,
    headers: { accept: 'application/json', 'content-type': 'application/json', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload);
    },
  };
  const res = mockRes();
  await app(req, res);
  return { status: res.status, body: res.body };
}

describe('POST /admin/api/dht/probe', () => {
  beforeEach(() => resetDhtStats());

  it('requires an admin session, calls the zero infohash, and never stores that hash', async () => {
    const lines: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    let peersCalls = 0;
    const net = async (url: string) => {
      const u = String(url);
      if (u.indexOf('/v1/peers') >= 0) {
        peersCalls++;
        expect(u).toContain('infohash=' + DHT_PROBE_INFOHASH);
        return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ peers: 3, source: 'dht', approx: true, infohash: DHT_PROBE_INFOHASH }) };
      }
      return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ ok: true, dht: 'idle', rss: 1024 }) };
    };
    const store = memStore();
    const app = createApp(store, net, {
      env: { BILLING_DHT_URL: 'http://dht-peers:8788', BILLING_DHT_TOKEN: TOKEN },
      monitor: { health: () => null },
    });
    try {
      const denied = await post(app, '/admin/api/dht/probe', {}, { csrf: 'x' });
      expect(denied.status).toBe(401);
      expect(peersCalls).toBe(0);

      const now = Date.now();
      const issued = await store.update((cur) => issueCliAdminLogin(cur as never, { now }));
      const token = (issued as { token: string }).token;
      const once = await call(app, '/admin/login/once?token=' + encodeURIComponent(token));
      const cookie = String(once.headers['set-cookie'] || '');
      const m = /omp_admin=([^;]+)/.exec(cookie);
      expect(m).toBeTruthy();
      const home = await call(app, '/admin/api/home', { cookie: 'omp_admin=' + m![1] });
      const csrf = JSON.parse(home.body).csrf as string;
      expect(csrf).toBeTruthy();

      const bad = await post(app, '/admin/api/dht/probe', { cookie: 'omp_admin=' + m![1] }, { csrf: 'nope' });
      expect(bad.status).toBe(403);
      expect(peersCalls).toBe(0);

      const ok = await post(app, '/admin/api/dht/probe', { cookie: 'omp_admin=' + m![1] }, { csrf });
      expect(ok.status).toBe(200);
      const body = JSON.parse(ok.body);
      expect(body).toMatchObject({ ok: true, status: 200, peers: 3 });
      expect(typeof body.ms).toBe('number');
      expect(ok.body).not.toContain(DHT_PROBE_INFOHASH);
      expect(ok.body).not.toContain(TOKEN);
      expect(peersCalls).toBe(1);
      const logged = lines.filter((l) => l.indexOf('dht status=') === 0).join('');
      expect(logged).toMatch(/dht status=200 ms=\d+ device=-\n/);
      expect(logged).not.toContain(DHT_PROBE_INFOHASH);
      expect(JSON.stringify(dhtStatsView(Date.now()))).not.toContain(DHT_PROBE_INFOHASH);

      lines.length = 0;
      const boom = createApp(store, async (url: string) => {
        if (String(url).indexOf('/v1/peers') >= 0) throw new Error('infohash=' + DHT_PROBE_INFOHASH + ' token=' + TOKEN);
        return { status: 200, headers: { get: () => null }, text: async () => '{}' };
      }, {
        env: { BILLING_DHT_URL: 'http://dht-peers:8788', BILLING_DHT_TOKEN: TOKEN },
        monitor: { health: () => null },
      });
      const fail = await post(boom, '/admin/api/dht/probe', { cookie: 'omp_admin=' + m![1] }, { csrf });
      expect(fail.status).toBe(200);
      const failed = JSON.parse(fail.body);
      expect(failed.ok).toBe(false);
      expect(failed.error).toBe('проверка');
      expect(failed.reason).toBe('down');
      expect(fail.body).not.toContain(DHT_PROBE_INFOHASH);
      expect(fail.body).not.toContain(TOKEN);
      const errLine = lines.filter((l) => l.indexOf('dht status=') === 0).join('');
      expect(errLine).toMatch(/dht status=502 ms=\d+ device=-\n/);
      expect(errLine).not.toContain(DHT_PROBE_INFOHASH);
      const view = dhtStatsView(Date.now());
      expect(view.errors[0].reason).toBe('проверка');
      expect(JSON.stringify(view)).not.toContain(DHT_PROBE_INFOHASH);
      expect(JSON.stringify(view)).not.toContain(TOKEN);
    } finally {
      process.stderr.write = orig;
    }
  });

  it('rate-limits the probe and does not call the sidecar past the cap', async () => {
    let peersCalls = 0;
    const net = async (url: string) => {
      if (String(url).indexOf('/v1/peers') >= 0) {
        peersCalls++;
        return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ peers: 1, source: 'dht', approx: true }) };
      }
      return { status: 200, headers: { get: () => null }, text: async () => '{}' };
    };
    const store = memStore();
    const app = createApp(store, net, {
      env: { BILLING_DHT_URL: 'http://dht-peers:8788', BILLING_DHT_TOKEN: TOKEN },
      monitor: { health: () => null },
    });
    const now = Date.now();
    const issued = await store.update((cur) => issueCliAdminLogin(cur as never, { now }));
    const token = (issued as { token: string }).token;
    const once = await call(app, '/admin/login/once?token=' + encodeURIComponent(token));
    const m = /omp_admin=([^;]+)/.exec(String(once.headers['set-cookie'] || ''));
    const home = await call(app, '/admin/api/home', { cookie: 'omp_admin=' + m![1] });
    const csrf = JSON.parse(home.body).csrf as string;
    const cookie = { cookie: 'omp_admin=' + m![1] };
    for (let i = 0; i < 6; i++) {
      const res = await post(app, '/admin/api/dht/probe', cookie, { csrf });
      expect(res.status).toBe(200);
    }
    const limited = await post(app, '/admin/api/dht/probe', cookie, { csrf });
    expect(limited.status).toBe(429);
    expect(JSON.parse(limited.body).error).toBe('rate');
    expect(JSON.parse(limited.body).reason).toBe('probe_rate');
    expect(limited.body).not.toContain(DHT_PROBE_INFOHASH);
    expect(peersCalls).toBe(6);
  });

  it('separates a busy sidecar, a disabled sidecar, and a DHT that is not up yet', async () => {
    const queue = [
      { status: 429, body: { error: 'rate', retryAfter: 2 } },
      { status: 503, body: { error: 'disabled' } },
      { status: 503, body: { error: 'down' } },
    ];
    const net = async (url: string) => {
      if (String(url).indexOf('/v1/peers') >= 0) {
        const next = queue.shift();
        return {
          status: next ? next.status : 500,
          headers: { get: () => null },
          text: async () => JSON.stringify(next ? next.body : {}),
        };
      }
      return { status: 200, headers: { get: () => null }, text: async () => '{}' };
    };
    const store = memStore();
    const app = createApp(store, net, {
      env: { BILLING_DHT_URL: 'http://dht-peers:8788', BILLING_DHT_TOKEN: TOKEN },
      monitor: { health: () => null },
    });
    const now = Date.now();
    const issued = await store.update((cur) => issueCliAdminLogin(cur as never, { now }));
    const token = (issued as { token: string }).token;
    const once = await call(app, '/admin/login/once?token=' + encodeURIComponent(token));
    const m = /omp_admin=([^;]+)/.exec(String(once.headers['set-cookie'] || ''));
    const cookie = { cookie: 'omp_admin=' + m![1] };
    const home = await call(app, '/admin/api/home', cookie);
    const csrf = JSON.parse(home.body).csrf as string;
    const busy = JSON.parse((await post(app, '/admin/api/dht/probe', cookie, { csrf })).body);
    const off = JSON.parse((await post(app, '/admin/api/dht/probe', cookie, { csrf })).body);
    const cold = JSON.parse((await post(app, '/admin/api/dht/probe', cookie, { csrf })).body);
    expect(busy).toMatchObject({ ok: false, status: 429, reason: 'sidecar_rate', error: 'проверка' });
    expect(off).toMatchObject({ ok: false, status: 503, reason: 'disabled' });
    expect(cold).toMatchObject({ ok: false, status: 503, reason: 'not_ready' });
    expect(JSON.stringify(busy) + JSON.stringify(off) + JSON.stringify(cold)).not.toContain(DHT_PROBE_INFOHASH);

    const bare = createApp(store, async () => {
      throw new Error('should not fetch');
    }, { env: {}, monitor: { health: () => null } });
    const denied = JSON.parse((await post(bare, '/admin/api/dht/probe', cookie, { csrf })).body);
    expect(denied).toMatchObject({ ok: false, status: 503, reason: 'disabled' });
  });
});

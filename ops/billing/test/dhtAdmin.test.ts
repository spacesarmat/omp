import { describe, expect, it, beforeEach } from 'vitest';
import { issueCliAdminLogin } from '../src/logic.mjs';
import { createApp } from '../src/server.mjs';
import { emptyState } from '../src/state.mjs';
import { noteDhtRequest, resetDhtStats } from '../src/dhtStats.mjs';

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
    expect(body.stats.errors).toHaveLength(1);
    expect(body.stats.errors[0].reason).toBe('нет токена');
    const raw = res.body;
    expect(raw).not.toContain(TOKEN);
    expect(raw).not.toContain(HASH);
    expect(healthCalls).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server.mjs';
import { emptyState } from '../src/state.mjs';
import { confirmAdminPanelLogin, issueCliAdminLogin, startAdminPanelLogin } from '../src/logic.mjs';

/** Memory store that counts writes: a public login poll must not cause one. */
function memoryStore() {
  let state = emptyState();
  state.settings.adminTelegramIds = '42';
  state.settings.adminReaders = '55';
  const store = {
    engine: 'memory',
    updates: 0,
    async read() {
      return state;
    },
    async update(fn: (s: typeof state) => { state?: typeof state; result?: unknown } | typeof state) {
      store.updates++;
      const out = await fn(state);
      if (out && typeof out === 'object' && 'state' in out && out.state) state = out.state;
      return out && typeof out === 'object' && 'result' in out ? out.result : out;
    },
    registry: {
      async tokenSecret() {
        return 'k'.repeat(40);
      },
      async verifyAccess() {
        return { error: 'bad_token' };
      },
      async activeRowsByCode() {
        return new Map();
      },
      async listDevices() {
        return [];
      },
      async touchRow() {},
      async activeRowForCode() {
        return null;
      },
      async authStats() {
        return { total: 0, refresh: 0, legacy: 0 };
      },
    },
    async info() {
      return { engine: 'memory' };
    },
    async close() {},
  };
  return store;
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
    write(buf?: Buffer | string) {
      this.body += Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '');
      return true;
    },
    on() {
      return this;
    },
    flushHeaders() {},
  };
}

async function call(app: (req: unknown, res: unknown) => Promise<void>, method: string, path: string, opts: { body?: unknown; ip?: string } = {}) {
  const payload = opts.body === undefined ? '' : JSON.stringify(opts.body);
  const req = {
    method,
    url: path,
    headers: {
      'x-forwarded-proto': 'https',
      cookie: '',
      accept: 'application/json',
      'content-type': opts.body === undefined ? '' : 'application/json',
      ...(opts.ip ? { 'cf-connecting-ip': opts.ip } : {}),
    },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
    on() {},
  };
  const res = mockRes();
  await app(req, res);
  let data: Record<string, unknown> | null = null;
  try {
    data = JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    data = null;
  }
  return { status: res.status, headers: res.headers, data, body: res.body };
}

const noFetch = async () => ({ ok: false, status: 0, text: async () => '', json: async () => ({}) });

describe('public login endpoints do not write on every poll', () => {
  it('an unknown panel token is expired without a store write', async () => {
    const store = memoryStore();
    const app = createApp(store, noFetch, { env: {} });
    const r = await call(app, 'GET', '/admin/login/telegram/status?token=deadbeef');
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ ok: false, status: 'expired' });
    expect(store.updates).toBe(0);
  });

  it('a pending panel token is polled without writes, then consumed exactly once', async () => {
    const store = memoryStore();
    const app = createApp(store, noFetch, { env: {} });
    const started = (await store.update((s) => startAdminPanelLogin(s, { now: Date.now() }))) as { token: string };
    const afterStart = store.updates;
    const pending = await call(app, 'GET', '/admin/login/telegram/status?token=' + started.token);
    expect(pending.data).toEqual({ ok: false, status: 'pending' });
    expect(store.updates).toBe(afterStart);
    await store.update((s) => confirmAdminPanelLogin(s, { token: started.token, telegramId: '42', now: Date.now() }));
    const ok = await call(app, 'GET', '/admin/login/telegram/status?token=' + started.token);
    expect(ok.data).toEqual({ ok: true, status: 'ok' });
    expect(String(ok.headers['set-cookie'] || '')).toContain('omp_admin=');
    const afterOk = store.updates;
    const again = await call(app, 'GET', '/admin/login/telegram/status?token=' + started.token);
    expect(again.data).toEqual({ ok: false, status: 'expired' });
    expect(store.updates).toBe(afterOk);
  });

  it('an unknown CLI token is refused without a store write, a valid one is consumed once', async () => {
    const store = memoryStore();
    const app = createApp(store, noFetch, { env: {} });
    const junk = await call(app, 'GET', '/admin/login/once?token=junk');
    expect(junk.status).toBe(403);
    expect(store.updates).toBe(0);
    const issued = (await store.update((s) => issueCliAdminLogin(s, { now: Date.now() }))) as { token: string };
    const ok = await call(app, 'GET', '/admin/login/once?token=' + encodeURIComponent(issued.token));
    expect(ok.status).toBe(302);
    const afterOk = store.updates;
    const again = await call(app, 'GET', '/admin/login/once?token=' + encodeURIComponent(issued.token));
    expect(again.status).toBe(403);
    expect(store.updates).toBe(afterOk);
  });

  it('the disabled password login writes no audit row', async () => {
    const store = memoryStore();
    const app = createApp(store, noFetch, { env: {} });
    const r = await call(app, 'POST', '/admin/login', { body: { password: 'x' } });
    expect(r.status).toBe(403);
    expect(store.updates).toBe(0);
  });

  it('a status flood is rate limited per IP', async () => {
    const store = memoryStore();
    const app = createApp(store, noFetch, { env: {} });
    let last = 0;
    let retryAfter = '';
    for (let i = 0; i < 121; i++) {
      const r = await call(app, 'GET', '/admin/login/telegram/status?token=deadbeef', { ip: '203.0.113.1' });
      last = r.status;
      retryAfter = String(r.headers['retry-after'] || '');
    }
    expect(last).toBe(429);
    expect(Number(retryAfter)).toBeGreaterThan(0);
    const other = await call(app, 'GET', '/admin/login/telegram/status?token=deadbeef', { ip: '203.0.113.2' });
    expect(other.status).toBe(200);
  });

  it('a CLI once flood is rate limited per IP', async () => {
    const store = memoryStore();
    const app = createApp(store, noFetch, { env: {} });
    let last = 0;
    let retryAfter = '';
    for (let i = 0; i < 11; i++) {
      const r = await call(app, 'GET', '/admin/login/once?token=junk', { ip: '203.0.113.1' });
      last = r.status;
      retryAfter = String(r.headers['retry-after'] || '');
    }
    expect(last).toBe(429);
    expect(Number(retryAfter)).toBeGreaterThan(0);
    const other = await call(app, 'GET', '/admin/login/once?token=junk', { ip: '203.0.113.2' });
    expect(other.status).toBe(403);
  });

  it('a password login flood is rate limited per IP', async () => {
    const store = memoryStore();
    const app = createApp(store, noFetch, { env: {} });
    let last = 0;
    let retryAfter = '';
    for (let i = 0; i < 7; i++) {
      const r = await call(app, 'POST', '/admin/login', { body: { password: 'x' }, ip: '203.0.113.1' });
      last = r.status;
      retryAfter = String(r.headers['retry-after'] || '');
    }
    expect(last).toBe(429);
    expect(Number(retryAfter)).toBeGreaterThan(0);
    const other = await call(app, 'POST', '/admin/login', { body: { password: 'x' }, ip: '203.0.113.2' });
    expect(other.status).toBe(403);
  });
});

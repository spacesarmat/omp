import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server.mjs';
import { emptyState } from '../src/state.mjs';
import { confirmAdminPanelLogin, issueCliAdminLogin, startAdminPanelLogin } from '../src/logic.mjs';

/** Memory store: query exists so the cache repo is created, but the role gate must answer before any repo call. */
function memoryStore() {
  let state = emptyState();
  state.settings.adminTelegramIds = '42';
  state.settings.adminReaders = '55';
  return {
    engine: 'memory',
    async read() {
      return state;
    },
    async update(fn: (s: typeof state) => { state?: typeof state; result?: unknown } | typeof state) {
      const out = await fn(state);
      if (out && typeof out === 'object' && 'state' in out && out.state) state = out.state;
      return out && typeof out === 'object' && 'result' in out ? out.result : out;
    },
    async query() {
      return { rows: [] };
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

async function call(app: (req: unknown, res: unknown) => Promise<void>, method: string, path: string, opts: { cookie?: string; json?: unknown } = {}) {
  const payload = opts.json === undefined ? '' : JSON.stringify(opts.json);
  const req = {
    method,
    url: path,
    headers: {
      'x-forwarded-proto': 'https',
      accept: 'application/json',
      cookie: opts.cookie || '',
      ...(payload ? { 'content-type': 'application/json' } : {}),
    },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
    on() {},
  };
  const res = mockRes();
  await app(req, res);
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    data = {};
  }
  return { status: res.status, data, headers: res.headers, body: res.body };
}

const noFetch = async () => ({ ok: false, status: 0, text: async () => '', json: async () => ({}) });

function cookieOf(headers: Record<string, string>) {
  const m = /__Host-omp_admin=([^;]+)/.exec(String(headers['set-cookie'] || ''));
  return m ? '__Host-omp_admin=' + m[1] : '';
}

describe('cache admin mutations require the full role', () => {
  it('a read-role admin sees the tab but cannot change settings', async () => {
    const store = memoryStore();
    const app = createApp(store, noFetch, { env: {}, monitor: { health: () => null } });
    const started = (await store.update((s) => startAdminPanelLogin(s, { now: Date.now() }))) as { token: string };
    await store.update((s) => confirmAdminPanelLogin(s, { token: started.token, telegramId: '55', now: Date.now() }));
    const ok = await call(app, 'GET', '/admin/login/telegram/status?token=' + started.token);
    const cookie = cookieOf(ok.headers);
    expect(cookie).toBeTruthy();
    const view = await call(app, 'GET', '/admin/api/cache', { cookie });
    expect(view.status).toBe(200);
    const csrf = view.data.csrf as string;
    const saved = await call(app, 'POST', '/admin/cache/settings', { cookie, json: { csrf, enabled: true } });
    expect(saved.status).toBe(403);
    expect(saved.data.error).toBe('Режим только просмотра');
  });

  it('a read-role admin cannot create a node or reissue a node token', async () => {
    const store = memoryStore();
    const app = createApp(store, noFetch, { env: {}, monitor: { health: () => null } });
    const started = (await store.update((s) => startAdminPanelLogin(s, { now: Date.now() }))) as { token: string };
    await store.update((s) => confirmAdminPanelLogin(s, { token: started.token, telegramId: '55', now: Date.now() }));
    const ok = await call(app, 'GET', '/admin/login/telegram/status?token=' + started.token);
    const cookie = cookieOf(ok.headers);
    const view = await call(app, 'GET', '/admin/api/cache', { cookie });
    const csrf = view.data.csrf as string;
    const node = await call(app, 'POST', '/admin/cache/node', {
      cookie,
      json: { csrf, name: 'Узел', url: 'http://cache.example:8090', region: 'ru', capacityGb: 1 },
    });
    expect(node.status).toBe(403);
    const token = await call(app, 'POST', '/admin/cache/token', { cookie, json: { csrf, id: '0'.repeat(16) } });
    expect(token.status).toBe(403);
  });

  it('a full-role admin still changes settings', async () => {
    const store = memoryStore();
    const app = createApp(store, noFetch, { env: {}, monitor: { health: () => null } });
    const issued = (await store.update((s) => issueCliAdminLogin(s, { now: Date.now() }))) as { token: string };
    const once = await call(app, 'GET', '/admin/login/once?token=' + encodeURIComponent(issued.token));
    const cookie = cookieOf(once.headers);
    expect(cookie).toBeTruthy();
    const view = await call(app, 'GET', '/admin/api/cache', { cookie });
    const csrf = view.data.csrf as string;
    const saved = await call(app, 'POST', '/admin/cache/settings', { cookie, json: { csrf, enabled: true } });
    expect(saved.status).toBe(200);
    expect(saved.data.ok).toBe(true);
    expect(saved.data.enabled).toBe(true);
  });
});

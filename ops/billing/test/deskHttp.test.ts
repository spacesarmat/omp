import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server.mjs';
import { emptyState } from '../src/state.mjs';
import { issueCliAdminLogin } from '../src/logic.mjs';
import { rememberPreview, resetDeskHttp } from '../src/deskHttp.mjs';

function memoryStore() {
  let state = emptyState();
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

async function call(app: (req: unknown, res: unknown) => Promise<void>, method: string, path: string, opts: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const payload = opts.body === undefined ? '' : JSON.stringify(opts.body);
  const req = {
    method,
    url: path,
    headers: {
      'x-forwarded-proto': 'https',
      cookie: opts.cookie || '',
      accept: 'application/json',
      'content-type': opts.body === undefined ? '' : 'application/json',
      ...(opts.headers || {}),
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

describe('broadcast previews', () => {
  it('drops expired drafts and keeps only the newest ones', () => {
    const map = new Map();
    rememberPreview(map, { id: 'old', text: 'one', ids: ['1'], at: 0 }, 0);
    rememberPreview(map, { id: 'fresh', text: 'two', ids: ['1'], at: 11 * 60 * 1000 }, 11 * 60 * 1000);
    expect(map.has('old')).toBe(false);
    expect(map.has('fresh')).toBe(true);
    for (let i = 0; i < 25; i++) {
      rememberPreview(map, { id: 'n' + i, text: 'x', ids: ['1'], at: 11 * 60 * 1000 + i }, 11 * 60 * 1000 + i);
    }
    expect(map.size).toBeLessThanOrEqual(20);
    expect(map.has('fresh')).toBe(false);
    expect(map.has('n24')).toBe(true);
  });
});

describe('desk http', () => {
  it('requires a session, then returns the desk and a live stream', async () => {
    const store = memoryStore();
    const issued = await store.update((s) => issueCliAdminLogin(s, { now: Date.now() }));
    const app = createApp(store, async () => ({ ok: false, status: 0, text: async () => '', json: async () => ({}) }));
    const denied = await call(app, 'GET', '/admin/api/desk');
    expect(denied.status).toBe(401);
    const once = await call(app, 'GET', '/admin/login/once?token=' + encodeURIComponent(String((issued as { token: string }).token)));
    expect(once.status).toBe(302);
    const cookie = String(once.headers['set-cookie'] || '');
    const desk = await call(app, 'GET', '/admin/api/desk', { cookie });
    expect(desk.status).toBe(200);
    expect(desk.data?.role).toBe('full');
    expect(Array.isArray(desk.data?.health)).toBe(true);
    const anon = await call(app, 'POST', '/v1/presence', {
      headers: { 'x-device-id': 'dev-1' },
      body: { diagnostics: '1', events: 'install', version: '1.0.0', platform: 'phone' },
    });
    expect(anon.status).toBe(200);
    const junk = await call(app, 'POST', '/v1/presence', {
      headers: { 'x-device-id': 'dev-1' },
      body: { diagnostics: '1', events: 'login', version: '1.0.0', platform: 'phone' },
    });
    expect(junk.status).toBe(401);
  });

  it('GET /v1/rollout allows a browser preflight for X-Device-Id and no other route does', async () => {
    const app = createApp(memoryStore(), async () => ({ ok: false, status: 0, text: async () => '', json: async () => ({}) }));
    const opt = await call(app, 'OPTIONS', '/v1/rollout');
    expect(opt.status).toBe(204);
    expect(opt.headers['access-control-allow-origin']).toBe('*');
    expect(String(opt.headers['access-control-allow-headers'])).toContain('X-Device-Id');
    expect(opt.headers['access-control-allow-credentials']).toBeUndefined();
    const got = await call(app, 'GET', '/v1/rollout', { headers: { 'x-device-id': 'tv-1' } });
    expect(got.status).toBe(200);
    expect(got.headers['access-control-allow-origin']).toBe('*');
    expect(got.data?.ok).toBe(true);
    expect(typeof got.data?.beta).toBe('boolean');
    const missing = await call(app, 'GET', '/v1/rollout');
    expect(missing.status).toBe(400);
    expect(missing.headers['access-control-allow-origin']).toBe('*');
    const closed = await call(app, 'OPTIONS', '/v1/search');
    expect(closed.status).toBe(204);
    expect(closed.headers['access-control-allow-origin']).toBeUndefined();
    const crashOpt = await call(app, 'OPTIONS', '/v1/crash');
    expect(crashOpt.status).toBe(204);
    expect(crashOpt.headers['access-control-allow-origin']).toBe('*');
    expect(String(crashOpt.headers['access-control-allow-headers'])).toContain('X-Device-Id');
    expect(String(crashOpt.headers['access-control-allow-headers'])).toContain('Content-Type');
    expect(crashOpt.headers['access-control-allow-credentials']).toBeUndefined();
    const posted = await call(app, 'POST', '/v1/crash', {
      headers: { 'x-device-id': 'tv-1' },
      body: { diagnostics: '1', payload: JSON.stringify({ message: 'boom', stack: 'at a', version: '1', platform: 'webos' }) },
    });
    expect(posted.status).toBe(200);
    expect(posted.headers['access-control-allow-origin']).toBe('*');
  });

  it('stores a crash with no account and still caps one IP when the device id changes', async () => {
    resetDeskHttp();
    const store = memoryStore();
    const app = createApp(store, async () => ({ ok: false, status: 0, text: async () => '', json: async () => ({}) }));
    const body = {
      diagnostics: '1',
      payload: JSON.stringify({ message: 'boom', stack: 'at a\nat b', version: '1.2.3', platform: 'phone' }),
    };
    const bad = await call(app, 'POST', '/v1/crash', { headers: { 'x-device-id': 'dev-1', authorization: 'Bearer nope' }, body });
    expect(bad.status).toBe(401);
    for (let i = 1; i <= 5; i++) {
      const next = await call(app, 'POST', '/v1/crash', { headers: { 'x-device-id': 'dev-' + i }, body });
      expect(next.status).toBe(200);
      expect(next.data?.stored).toBe(true);
    }
    const saved = await store.read();
    expect(saved.crashGroups).toHaveLength(1);
    const blocked = await call(app, 'POST', '/v1/crash', { headers: { 'x-device-id': 'dev-99' }, body });
    expect(blocked.status).toBe(429);
  });

  it('records the signed-in admin on a credit', async () => {
    const store = memoryStore();
    const now = Date.now();
    await store.update((s) => {
      s.accounts = [{ id: 'a1' }];
      s.subscriptions = [{ id: 's1', accountId: 'a1', product: 'jackett', paidUntil: now + 86400000, creditRub: 0 }];
      return { state: s };
    });
    const issued = await store.update((s) => issueCliAdminLogin(s, { now }));
    const app = createApp(store, async () => ({ ok: false, status: 0, text: async () => '', json: async () => ({}) }));
    const once = await call(app, 'GET', '/admin/login/once?token=' + encodeURIComponent(String((issued as { token: string }).token)));
    const cookie = String(once.headers['set-cookie'] || '');
    const desk = await call(app, 'GET', '/admin/api/desk', { cookie });
    const saved = await call(app, 'POST', '/admin/api/credit', {
      cookie,
      body: { csrf: desk.data?.csrf, accountId: 'a1', rub: 15, confirm: 'yes' },
    });
    expect(saved.status).toBe(200);
    expect(saved.data?.creditRub).toBe(15);
    const state = await store.read();
    const row = (state.audit || []).find((a: { action?: string }) => a.action === 'credit');
    expect(row && row.actor).toEqual({ kind: 'admin', id: 'cli', label: 'cli' });
  });
});

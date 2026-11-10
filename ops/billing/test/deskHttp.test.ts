import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server.mjs';
import { emptyState } from '../src/state.mjs';
import { issueCliAdminLogin } from '../src/logic.mjs';

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
});

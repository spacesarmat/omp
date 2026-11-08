import { describe, expect, it } from 'vitest';
import { createAdminAuthMemory } from '../src/adminAuthMemory.mjs';
import { createApp } from '../src/server.mjs';
import { createActivateLimiter, createRateLimit } from '../src/services.mjs';
import { searchJacRed } from '../src/jackett.mjs';
import { emptyState } from '../src/state.mjs';
import { readState, testStore, writeState } from './pg';

type Response = {
  status: number;
  headers: Record<string, unknown>;
  body: string;
  setHeader(name: string, value: unknown): void;
  writeHead(status: number, headers?: Record<string, unknown>): void;
  end(body?: Buffer | string): void;
};

function mockRes(): Response {
  return {
    status: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.status = status;
      if (headers) Object.assign(this.headers, headers);
    },
    end(body) {
      this.body = String(body || '');
    },
  };
}

async function call(
  app: (req: unknown, res: unknown) => Promise<void>,
  method: string,
  url: string,
  opts: { body?: unknown; cookie?: string; secure?: boolean } = {},
) {
  const payload = opts.body === undefined ? '' : JSON.stringify(opts.body);
  const req = {
    method,
    url,
    headers: {
      'content-type': 'application/json',
      cookie: opts.cookie || '',
      'x-forwarded-proto': opts.secure === false ? 'http' : 'https',
    },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  };
  const res = mockRes();
  await app(req, res);
  let data: any = null;
  try {
    data = res.body ? JSON.parse(res.body) : null;
  } catch {
    data = null;
  }
  return { ...res, data };
}

describe('security hardening', () => {
  it('uses a host-prefixed admin cookie, strict CSP and no-store', async () => {
    const file = await testStore();
    const state = emptyState();
    Object.assign(state.settings, { adminTelegramIds: '42', botToken: 'token', botUsername: 'omp_bot' });
    await writeState(file, state);
    const adminAuthMem = createAdminAuthMemory();
    const app = createApp(file, undefined, { adminAuthMem });
    const started = await call(app, 'POST', '/admin/login/telegram');
    expect(started.data.ok).toBe(true);
    adminAuthMem.confirmPanel((await readState(file)).settings, { token: started.data.token, telegramId: '42', now: Date.now() });
    const status = await call(app, 'GET', '/admin/login/telegram/status?token=' + encodeURIComponent(started.data.token));
    const setCookie = String(status.headers['set-cookie'] || '');
    expect(setCookie).toContain('__Host-omp_admin=');
    expect(setCookie).toContain('Secure');
    const id = /__Host-omp_admin=([^;]+)/.exec(setCookie)![1];
    const home = await call(app, 'GET', '/admin/api/home', { cookie: '__Host-omp_admin=' + id });
    expect(home.status).toBe(200);
    expect(home.headers['cache-control']).toBe('no-store');
    const csp = String(home.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    const old = await call(app, 'GET', '/admin/api/home', { cookie: 'omp_admin=' + id });
    expect(old.status).toBe(401);
  });

  it('keeps the compatible admin cookie on documented HTTP LAN access', async () => {
    const file = await testStore();
    const state = emptyState();
    Object.assign(state.settings, { adminTelegramIds: '42', botToken: 'token', botUsername: 'omp_bot' });
    await writeState(file, state);
    const adminAuthMem = createAdminAuthMemory();
    const app = createApp(file, undefined, { adminAuthMem });
    const started = await call(app, 'POST', '/admin/login/telegram', { secure: false });
    adminAuthMem.confirmPanel((await readState(file)).settings, { token: started.data.token, telegramId: '42', now: Date.now() });
    const status = await call(app, 'GET', '/admin/login/telegram/status?token=' + encodeURIComponent(started.data.token), { secure: false });
    const setCookie = String(status.headers['set-cookie'] || '');
    expect(setCookie).toMatch(/^omp_admin=/);
    expect(setCookie).not.toContain('__Host-omp_admin=');
    expect(setCookie).not.toContain('Secure');
    const id = /omp_admin=([^;]+)/.exec(setCookie)![1];
    const home = await call(app, 'GET', '/admin/api/home', { cookie: 'omp_admin=' + id, secure: false });
    expect(home.status).toBe(200);
    const prefixed = await call(app, 'GET', '/admin/api/home', { cookie: '__Host-omp_admin=' + id, secure: false });
    expect(prefixed.status).toBe(401);
  });

  it('fails closed when the activation limiter reaches key capacity', () => {
    let now = 0;
    const limit = createActivateLimiter({ ipMax: 1, codeMax: 0, windowMs: 60_000 }, { maxKeys: 1, now: () => now });
    expect(limit.check('192.0.2.1', '')).toBe(0);
    expect(limit.check('192.0.2.2', '')).toBe(60);
    expect(limit.check('192.0.2.3', '')).toBe(60);
    now = 60_001;
    expect(limit.check('192.0.2.3', '')).toBe(0);
  });

  it('rejects a small JSON body above 256 KiB', async () => {
    const file = await testStore();
    const app = createApp(file);
    const res = await call(app, 'POST', '/v1/activate', { body: { code: 'x'.repeat(256 * 1024 + 1), deviceId: 'a'.repeat(32), tokens: 'pair' } });
    expect(res.status).toBe(413);
    expect(res.data).toEqual({ error: 'too_large' });
  });

  it('caps active rate-limit keys', () => {
    const limit = createRateLimit(1, 60_000, { maxKeys: 2 });
    expect(limit.allow('a')).toBe(true);
    expect(limit.allow('b')).toBe(true);
    expect(limit.allow('c')).toBe(false);
    expect(limit.size()).toBeLessThanOrEqual(2);
  });

  it('evicts expired rate-limit keys at the cap', () => {
    let now = 0;
    const limit = createRateLimit(1, 60_000, { maxKeys: 2, now: () => now });
    expect(limit.allow('a')).toBe(true);
    expect(limit.allow('b')).toBe(true);
    now = 60_001;
    expect(limit.allow('c')).toBe(true);
    expect(limit.size()).toBe(1);
  });

  it('cancels an indexer XML stream above 2 MiB', async () => {
    let cancelled = false;
    const chunks = [Buffer.alloc(1024 * 1024), Buffer.alloc(1024 * 1024), Buffer.alloc(1)];
    const body = {
      getReader: () => ({
        read: async () => {
          const value = chunks.shift();
          return value ? { done: false, value } : { done: true };
        },
        cancel: async () => {
          cancelled = true;
        },
        releaseLock: () => {},
      }),
    };
    const out = await searchJacRed({
      origin: 'http://jacred.test',
      apiKey: 'key',
      query: 'film',
      fetchImpl: async () => ({ status: 200, headers: {}, body, text: async () => 'x'.repeat(3 * 1024 * 1024) }),
    });
    expect(out.ok).toBe(false);
    expect(cancelled).toBe(true);
  });

  it('cancels an indexer body whose declared length exceeds the cap', async () => {
    let cancelled = false;
    let read = false;
    const body = {
      getReader: () => ({
        read: async () => {
          read = true;
          return { done: true };
        },
        cancel: async () => {
          cancelled = true;
        },
        releaseLock: () => {},
      }),
    };
    const out = await searchJacRed({
      origin: 'http://jacred.test',
      apiKey: 'key',
      query: 'film',
      fetchImpl: async () => ({ status: 200, headers: { 'content-length': '2000001' }, body, text: async () => '' }),
    });
    expect(out.ok).toBe(false);
    expect(cancelled).toBe(true);
    expect(read).toBe(false);
  });
});

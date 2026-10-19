import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activate, createSubscription, ensureTelegramAccount } from '../src/logic.mjs';
import { createApp, healthPayload } from '../src/server.mjs';
import { emptyState, readState, writeState } from '../src/store.mjs';
import { readOnlyMode, readOnlyStore } from '../src/readOnly.mjs';
import { toStore } from '../src/db/index.mjs';

type App = (req: unknown, res: unknown) => Promise<void>;

function mockRes() {
  return {
    status: 0,
    headers: {} as Record<string, string | number>,
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

async function call(app: App, method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) {
  const payload = opts.body === undefined ? '' : JSON.stringify(opts.body);
  const req = {
    method,
    url: path,
    headers: { accept: 'application/json', 'content-type': opts.body === undefined ? '' : 'application/json', ...(opts.headers || {}) },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  };
  const res = mockRes();
  await app(req, res);
  return { status: res.status, body: res.body, headers: res.headers };
}

const DEV = 'a'.repeat(32);

function seeded() {
  const file = join(mkdtempSync(join(tmpdir(), 'omp-ro-')), 'billing.db');
  const now = Date.now();
  let state = emptyState();
  state.settings.botToken = 'token';
  state.settings.yoomoneySecret = 'ym-secret';
  const opened = ensureTelegramAccount(state, '42', now);
  const created = createSubscription(opened.state, { accountId: opened.account.id, now, days: 30 });
  const act = activate(created.state, { code: created.result.code, deviceId: DEV, now });
  state = act.state;
  writeState(file, state);
  return { file, token: act.result.token as string, code: created.result.code as string };
}

describe('BILLING_READONLY (cutover window)', () => {
  it('reads the flag', () => {
    expect(readOnlyMode({ BILLING_READONLY: '1' })).toBe(true);
    expect(readOnlyMode({ BILLING_READONLY: 'on' })).toBe(true);
    expect(readOnlyMode({ BILLING_READONLY: '0' })).toBe(false);
    expect(readOnlyMode({})).toBe(false);
  });

  it('refuses every write with 503 and keeps reads working; billing.db is untouched', async () => {
    const s = seeded();
    const before = JSON.stringify(readState(s.file));
    const app = createApp(s.file, async () => ({ ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' }), {
      env: {},
      readOnly: true,
    });

    const health = await call(app, 'GET', '/health');
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toMatchObject({ ok: true, readOnly: true });

    // YooMoney gets 503 and retries later; nothing is logged, not even a bad signature.
    const ym = await call(app, 'POST', '/v1/yoomoney', { body: { operation_id: 'op-1', label: 'x', amount: '150.00', sha1_hash: 'bad' } });
    expect(ym.status).toBe(503);
    expect(ym.body).toBe('read only');
    expect(ym.headers['retry-after']).toBe('600');

    for (const [path, body] of [
      ['/v1/activate', { code: s.code, deviceId: 'b'.repeat(32) }],
      ['/v1/token/refresh', { refreshToken: 'x' }],
      ['/v1/token/upgrade', {}],
      ['/v1/link/start', {}],
      ['/v1/link/clear', {}],
      ['/admin/login', { password: 'x' }],
      ['/admin/settings', { csrf: 'x' }],
    ] as const) {
      const r = await call(app, 'POST', path, { body, headers: { 'x-device-id': DEV } });
      expect(r.status, path).toBe(503);
      expect(JSON.parse(r.body), path).toEqual({ error: 'read_only' });
    }

    // A phone with its token still reads its subscription.
    const me = await call(app, 'GET', '/v1/me', { headers: { authorization: 'Bearer ' + s.token, 'x-device-id': DEV } });
    expect(me.status).toBe(200);

    expect(JSON.stringify(readState(s.file))).toBe(before);
  });

  it('the read-only store refuses update() and registry writes, lastSeen touches are skipped', async () => {
    const s = seeded();
    const ro = readOnlyStore(toStore(s.file));
    expect(ro.readOnly).toBe(true);
    expect((await ro.read()).accounts.length).toBe(1);
    await expect(ro.update((st: unknown) => ({ state: st }))).rejects.toMatchObject({ code: 'READ_ONLY' });
    await expect(ro.registry.revokeRow('x', 'r', Date.now())).rejects.toMatchObject({ code: 'READ_ONLY' });
    await expect(ro.registry.refreshPair('secret', {})).rejects.toMatchObject({ code: 'READ_ONLY' });
    await expect(ro.registry.touchRow('x', {})).resolves.toBeNull();
  });

  it('health shows the read-only flag only when it is on', () => {
    expect(healthPayload(Date.now())).not.toHaveProperty('readOnly');
    expect(healthPayload(Date.now(), { readOnly: true })).toMatchObject({ readOnly: true });
  });
});

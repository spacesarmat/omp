import { describe, expect, it } from 'vitest';
import { activate, createSubscription, ensureTelegramAccount } from '../src/logic.mjs';
import { createApp, healthPayload } from '../src/server.mjs';
import { emptyState } from '../src/state.mjs';
import { readState, writeState, testStore } from './pg';
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

async function seeded() {
  const file = await testStore();
  const now = Date.now();
  let state = emptyState();
  state.settings.botToken = 'token';
  state.settings.yoomoneySecret = 'ym-secret';
  const opened = ensureTelegramAccount(state, '42', now);
  const created = createSubscription(opened.state, { accountId: opened.account.id, now, days: 30 });
  const act = activate(created.state, { code: created.result.code, deviceId: DEV, now });
  state = act.state;
  await writeState(file, state);
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
    const s = await seeded();
    const before = JSON.stringify((await readState(s.file)));
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

    expect(JSON.stringify((await readState(s.file)))).toBe(before);
  });

  it('the read-only store refuses update() and registry writes, lastSeen touches are skipped', async () => {
    const s = await seeded();
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

  it('admin Telegram login and CLI once-link work without writing user data', async () => {
    const s = await seeded();
    const before = JSON.stringify(await readState(s.file));
    // Mint a CLI once-link on the real store (break-glass from the shell), then redeem under read-only.
    const { issueCliAdminLogin, confirmAdminPanelLogin } = await import('../src/logic.mjs');
    const { createAdminAuthMemory } = await import('../src/adminAuthMemory.mjs');
    const issued = await toStore(s.file).update((cur: any) => issueCliAdminLogin(cur, { now: Date.now() }));
    const afterIssue = JSON.stringify(await readState(s.file));
    expect(afterIssue).not.toBe(before); // minting writes adminCliLogins only

    const authMem = createAdminAuthMemory();
    const app = createApp(s.file, async () => ({ ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' }), {
      env: {},
      readOnly: true,
      adminAuthMem: authMem,
    });

    const once = await call(app, 'GET', '/admin/login/once?token=' + encodeURIComponent(issued.token));
    expect(once.status).toBe(302);
    expect(String(once.headers['set-cookie'] || '')).toContain('omp_admin=');
    // Redeeming must not write again (consumption is in memory).
    expect(JSON.stringify(await readState(s.file))).toBe(afterIssue);

    // Telegram start is allowed and stays in memory.
    await writeState(s.file, {
      ...(await readState(s.file)),
      settings: {
        ...(await readState(s.file)).settings,
        botToken: 'token',
        botUsername: 'omp_bot',
        adminTelegramIds: '42',
      },
    });
    const frozen = JSON.stringify(await readState(s.file));
    const start = await call(app, 'POST', '/admin/login/telegram', { body: {} });
    expect(start.status).toBe(200);
    const started = JSON.parse(start.body);
    expect(started.ok).toBe(true);
    expect(started.token).toBeTruthy();
    expect(started.deepLink).toContain('admin_');
    expect(JSON.stringify(await readState(s.file))).toBe(frozen);

    authMem.confirmPanel((await readState(s.file)).settings, {
      token: started.token,
      telegramId: '42',
      now: Date.now(),
    });
    const status = await call(app, 'GET', '/admin/login/telegram/status?token=' + encodeURIComponent(started.token));
    expect(status.status).toBe(200);
    expect(JSON.parse(status.body)).toMatchObject({ ok: true, status: 'ok' });
    expect(String(status.headers['set-cookie'] || '')).toContain('omp_admin=');
    expect(JSON.stringify(await readState(s.file))).toBe(frozen);
    // confirmAdminPanelLogin is only used above via memory; keep the import referenced for tree-shaking tools.
    expect(typeof confirmAdminPanelLogin).toBe('function');
  });

  it('/health uses backupEveryHours from settings', async () => {
    const s = await seeded();
    const { startPgBackups, dumpName } = await import('../src/pgBackup.mjs');
    const { mkdtempSync, writeFileSync: wfs, utimesSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'omp-ro-'));
    const now = Date.now();
    const name = dumpName(now - 40 * 3600 * 1000);
    const path = join(dir, name);
    wfs(path, 'x');
    utimesSync(path, new Date(now - 40 * 3600 * 1000), new Date(now - 40 * 3600 * 1000));
    await writeState(s.file, {
      ...(await readState(s.file)),
      settings: { ...(await readState(s.file)).settings, backupEveryHours: 168 },
    });
    const backups = startPgBackups({ dir, url: 'postgres://u:p@127.0.0.1:1/db' }, async () => (await readState(s.file)).settings, {
      firstDelayMs: 1e9,
      everyMs: 1e9,
      log: () => {},
      spawn: () => {
        throw new Error('no dump');
      },
    });
    const app = createApp(s.file, async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' }), {
      env: {},
      readOnly: true,
      pgBackups: backups,
    });
    const health = await call(app, 'GET', '/health');
    expect(health.status).toBe(200);
    const body = JSON.parse(health.body);
    expect(body.pgBackupOk).toBe(true);
    backups.stop();
  });
});

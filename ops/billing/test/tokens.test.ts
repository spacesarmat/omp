import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { revokeDevice, selfUnbind } from '../src/deviceAdmin.mjs';
import {
  activate,
  adminDashboard,
  createSubscription,
  deviceCode,
  ensureTelegramAccount,
  revokeCode,
} from '../src/logic.mjs';
import {
  ACCESS_TTL_MS,
  activeRowForCode,
  CLONE_LOG_EVERY_MS,
  issuePair,
  listDevices,
  refreshPair,
  revokeRow,
  ROTATE_GRACE_MS,
  signAccess,
  tokenSecret,
} from '../src/registry.mjs';
import { userPayload } from '../src/adminApi.mjs';
import { createApp } from '../src/server.mjs';
import { emptyState, readState, registryDb, updateState, writeState } from '../src/store.mjs';

const DAY = 24 * 60 * 60 * 1000;
const DEV_A = 'a'.repeat(32);
const DEV_B = 'b'.repeat(32);
const DEV_C = 'c'.repeat(32);
const DEV_D = 'd'.repeat(32);
const ADMIN = { kind: 'admin', id: '99', label: '99' };
const RSS = '<?xml version="1.0"?><rss><channel><item><title>x</title></item></channel></rss>';

type State = ReturnType<typeof emptyState>;
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
    headers: {
      accept: 'application/json',
      'content-type': opts.body === undefined ? '' : 'application/json',
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
  return { status: res.status, data, body: res.body };
}

function tmpDb(tag: string) {
  return join(mkdtempSync(join(tmpdir(), 'omp-tok-' + tag + '-')), 'billing.db');
}

/** Telegram account 42, a 30-day subscription, phone A bound with the legacy token. JacRed is configured. */
function base(now: number) {
  let state: State = emptyState();
  state.settings.botToken = 'token';
  state.settings.jacredUrl = 'http://jacred.test';
  state.settings.jacredApiKey = 'k';
  state.settings.jacredEnabled = true;
  const opened = ensureTelegramAccount(state, '42', now);
  const created = createSubscription(opened.state, { accountId: opened.account.id, now, days: 30 });
  const act = activate(created.state, { code: created.result.code, deviceId: DEV_A, now });
  state = act.state;
  return { state, accountId: opened.account.id, subscriptionId: created.result.subscriptionId, legacy: act.result.token, codeId: act.result.codeId };
}

async function setup(opts: { env?: Record<string, string> } = {}) {
  const file = tmpDb('http');
  const s = base(Date.now());
  writeState(file, s.state);
  const sent: { chat_id: string; text: string }[] = [];
  const fetchImpl = async (url: string, init?: { body?: string }) => {
    const u = String(url);
    if (u.indexOf('sendMessage') >= 0) sent.push(JSON.parse(String((init && init.body) || '{}')));
    if (u.indexOf('jacred.test') >= 0) return { ok: true, status: 200, text: async () => RSS, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }), text: async () => '' };
  };
  const app = createApp(file, fetchImpl, { env: opts.env || {} });
  return { file, app, sent, db: registryDb(file), ...s };
}

function search(app: App, token: string, deviceId: string) {
  return call(app, 'POST', '/v1/search', {
    headers: { authorization: 'Bearer ' + token, 'x-device-id': deviceId },
    body: { q: 'x', source: 'jacred' },
  });
}

async function pairFor(t: Awaited<ReturnType<typeof setup>>, deviceId: string) {
  // A second slot on the same subscription, activated by a new app that asks for the pair.
  const slot = deviceCode(readState(t.file), t.subscriptionId, Date.now());
  writeState(t.file, slot.state);
  const out = await call(t.app, 'POST', '/v1/activate', { body: { code: slot.code, deviceId, tokens: 'pair' } });
  expect(out.status).toBe(200);
  return { ...(out.data as { refreshToken: string; accessToken: string; accessExpiresAt: number; paidUntil: number }), codeId: slot.codeId };
}

function b64(obj: unknown) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

describe('migration: every bound code becomes a registry row', () => {
  it('builds the registry from a snapshot written before PR-4, keeps days and bindings, and is idempotent', () => {
    const now = Date.UTC(2026, 9, 19, 9, 0, 0);
    // Prod-like: three accounts, one subscription «2 из 1», a free slot, an expired subscription, a revoked code.
    const a = base(now);
    let st = a.state;
    const second = deviceCode(st, a.subscriptionId, now + 1);
    st = activate(second.state, { code: second.code, deviceId: DEV_B, now: now + 1 }).state;
    st = { ...st, subscriptions: st.subscriptions.map((x: { id: string }) => (x.id === a.subscriptionId ? { ...x, limitOverride: 1 } : x)) };
    const acc2 = ensureTelegramAccount(st, '43', now);
    const sub2 = createSubscription(acc2.state, { accountId: acc2.account.id, now, days: 30 });
    st = activate(sub2.state, { code: sub2.result.code, deviceId: DEV_C, now: now + 2 }).state;
    const free = deviceCode(st, sub2.result.subscriptionId, now);
    st = free.state;
    const acc3 = ensureTelegramAccount(st, '44', now - 90 * DAY);
    const sub3 = createSubscription(acc3.state, { accountId: acc3.account.id, now: now - 90 * DAY, days: 30 });
    const act3 = activate(sub3.state, { code: sub3.result.code, deviceId: DEV_D, now: now - 80 * DAY });
    st = act3.state;
    const gone = deviceCode(st, sub2.result.subscriptionId, now);
    st = revokeCode(gone.state, gone.codeId);
    st = { ...st, codes: st.codes.map((c: { id: string }) => (c.id === a.codeId ? { ...c, lastSeenAt: now - 5000, lastIp: '95.24.113.7' } : c)) };

    // Written the old way: only the snapshot table exists.
    const file = tmpDb('mig');
    const raw = new DatabaseSync(file);
    raw.exec('CREATE TABLE snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at INTEGER NOT NULL)');
    raw.prepare('INSERT INTO snapshot (id, data, updated_at) VALUES (1, ?, ?)').run(JSON.stringify(st), now);
    raw.close();

    const read = readState(file);
    const db = registryDb(file);
    const rows = db.prepare("SELECT * FROM devices WHERE status = 'active' ORDER BY device_id").all() as Record<string, unknown>[];
    expect(rows.map((r) => r.device_id)).toEqual([DEV_A, DEV_B, DEV_C, DEV_D]);
    const rowA = rows[0];
    expect(rowA).toMatchObject({ code_id: a.codeId, subscription_id: a.subscriptionId, account_id: a.accountId, last_seen_at: now - 5000, last_ip_net: '95.24.113.*' });
    expect(activeRowForCode(db, free.codeId)).toBeNull();
    expect(activeRowForCode(db, gone.codeId)).toBeNull();
    // Days, limits and bindings are untouched.
    expect(read.subscriptions.map((x: { paidUntil: number }) => x.paidUntil)).toEqual(st.subscriptions.map((x: { paidUntil: number }) => x.paidUntil));
    expect(read.subscriptions.find((x: { id: string }) => x.id === a.subscriptionId).limitOverride).toBe(1);
    expect(read.codes.filter((c: { deviceId: string }) => c.deviceId).length).toBe(4);
    // Writing again changes nothing in the registry.
    const ids = rows.map((r) => r.id);
    writeState(file, readState(file));
    writeState(file, readState(file));
    const after = db.prepare("SELECT id FROM devices WHERE status = 'active' ORDER BY device_id").all() as { id: string }[];
    expect(after.map((r) => r.id)).toEqual(ids);
    expect((db.prepare('SELECT COUNT(*) AS n FROM devices').get() as { n: number }).n).toBe(4);
  });

  it('keeps the old token working after the migration and exchanges it once for a pair', async () => {
    const t = await setup();
    const legacy = await search(t.app, t.legacy, DEV_A);
    expect(legacy.status).toBe(200);
    const up = await call(t.app, 'POST', '/v1/token/upgrade', { headers: { authorization: 'Bearer ' + t.legacy, 'x-device-id': DEV_A } });
    expect(up.status).toBe(200);
    const pair = up.data as { refreshToken: string; accessToken: string; accessExpiresAt: number; paidUntil: number };
    expect(pair.refreshToken.indexOf('r1.')).toBe(0);
    expect(pair.accessToken.indexOf('a1.')).toBe(0);
    expect(pair.accessExpiresAt - Date.now()).toBeGreaterThan(ACCESS_TTL_MS - 60 * 1000);
    expect(pair.paidUntil).toBe(readState(t.file).subscriptions[0].paidUntil);
    expect((await search(t.app, pair.accessToken, DEV_A)).status).toBe(200);
    // The legacy token still works for in-flight requests…
    expect((await search(t.app, t.legacy, DEV_A)).status).toBe(200);
    // …a second upgrade inside the minute (lost response) gives a new pair and drops the unused first one.
    const again = await call(t.app, 'POST', '/v1/token/upgrade', { headers: { authorization: 'Bearer ' + t.legacy, 'x-device-id': DEV_A } });
    expect(again.status).toBe(200);
    const second = again.data as { refreshToken: string };
    expect(second.refreshToken).not.toBe(pair.refreshToken);
    const firstRefresh = await call(t.app, 'POST', '/v1/token/refresh', { headers: { 'x-device-id': DEV_A }, body: { refreshToken: pair.refreshToken } });
    expect(firstRefresh).toMatchObject({ status: 401, data: { error: 'revoked' } });
    // Dropping a never-used token is not a clone: the device stays.
    expect(activeRowForCode(t.db, t.codeId)).not.toBeNull();
    // After the minute the legacy token is dead and cannot be upgraded again.
    await updateState(t.file, (st: State) => ({ state: { ...st, sessions: st.sessions.map((x: object) => ({ ...x, upgradedAt: Date.now() - 61 * 1000 })) } }));
    expect((await search(t.app, t.legacy, DEV_A)).status).toBe(403);
    const late = await call(t.app, 'POST', '/v1/token/upgrade', { headers: { authorization: 'Bearer ' + t.legacy, 'x-device-id': DEV_A } });
    expect(late).toMatchObject({ status: 401, data: { error: 'upgraded' } });
    const ok = await call(t.app, 'POST', '/v1/token/refresh', { headers: { 'x-device-id': DEV_A }, body: { refreshToken: second.refreshToken } });
    expect(ok.status).toBe(200);
  });

  it('refuses an upgrade with a wrong device, an unknown token or an access token', async () => {
    const t = await setup();
    for (const [token, device] of [
      [t.legacy, DEV_B],
      ['nope', DEV_A],
      ['', DEV_A],
    ]) {
      const out = await call(t.app, 'POST', '/v1/token/upgrade', { headers: { authorization: 'Bearer ' + token, 'x-device-id': device } });
      expect(out).toMatchObject({ status: 401, data: { error: 'bad_token' } });
    }
    const pair = await pairFor(t, DEV_B);
    const viaAccess = await call(t.app, 'POST', '/v1/token/upgrade', { headers: { authorization: 'Bearer ' + pair.accessToken, 'x-device-id': DEV_B } });
    expect(viaAccess.status).toBe(401);
  });
});

describe('old apps (no client change)', () => {
  it('activate without tokens answers exactly as before and the opaque token keeps working', async () => {
    const t = await setup();
    const slot = deviceCode(readState(t.file), t.subscriptionId, Date.now());
    writeState(t.file, slot.state);
    const out = await call(t.app, 'POST', '/v1/activate', { body: { code: slot.code, deviceId: DEV_B } });
    expect(out.status).toBe(200);
    expect(Object.keys(out.data).sort()).toEqual(['paidUntil', 'token']);
    const token = String(out.data.token);
    expect(token).toMatch(/^[a-f0-9]{32}$/);
    expect((await search(t.app, token, DEV_B)).status).toBe(200);
    const me = await call(t.app, 'GET', '/v1/me', { headers: { authorization: 'Bearer ' + token, 'x-device-id': DEV_B } });
    expect(me.status).toBe(200);
    expect(me.data.active).toBe(true);
    // An unknown legacy token is still 403 «expired» (what the old app understands), not 401.
    expect(await search(t.app, 'f'.repeat(32), DEV_B)).toMatchObject({ status: 403, data: { error: 'expired' } });
    // The registry has the new phone.
    expect(activeRowForCode(t.db, slot.codeId)).toMatchObject({ device_id: DEV_B });
  });

  it('a binding revoked in the registry stops the old token too, and a snapshot write does not bring it back', async () => {
    const t = await setup();
    const row = activeRowForCode(t.db, t.codeId);
    revokeRow(t.db, row.id, 'admin', Date.now());
    expect((await search(t.app, t.legacy, DEV_A)).status).toBe(403);
    writeState(t.file, readState(t.file));
    expect(activeRowForCode(t.db, t.codeId)).toBeNull();
    expect((await search(t.app, t.legacy, DEV_A)).status).toBe(403);
  });
});

describe('BILLING_LEGACY_TOKENS', () => {
  it('is on by default and when set to 1', async () => {
    for (const env of [{}, { BILLING_LEGACY_TOKENS: '1' }, { BILLING_LEGACY_TOKENS: '' }]) {
      const t = await setup({ env });
      expect((await search(t.app, t.legacy, DEV_A)).status).toBe(200);
    }
  });

  it('0 rejects old tokens with 401 and old-style activation, but still lets a phone upgrade', async () => {
    const t = await setup({ env: { BILLING_LEGACY_TOKENS: '0' } });
    expect(await search(t.app, t.legacy, DEV_A)).toMatchObject({ status: 401, data: { error: 'legacy_disabled' } });
    const me = await call(t.app, 'GET', '/v1/me', { headers: { authorization: 'Bearer ' + t.legacy, 'x-device-id': DEV_A } });
    expect(me).toMatchObject({ status: 401, data: { error: 'legacy_disabled' } });
    const slot = deviceCode(readState(t.file), t.subscriptionId, Date.now());
    writeState(t.file, slot.state);
    const old = await call(t.app, 'POST', '/v1/activate', { body: { code: slot.code, deviceId: DEV_B } });
    expect(old).toMatchObject({ status: 403, data: { error: 'app_update_required' } });
    expect(readState(t.file).codes.find((c: { id: string }) => c.id === slot.codeId).deviceId).toBeFalsy();
    const pair = await call(t.app, 'POST', '/v1/activate', { body: { code: slot.code, deviceId: DEV_B, tokens: 'pair' } });
    expect(pair.status).toBe(200);
    const up = await call(t.app, 'POST', '/v1/token/upgrade', { headers: { authorization: 'Bearer ' + t.legacy, 'x-device-id': DEV_A } });
    expect(up.status).toBe(200);
    expect((await search(t.app, String(up.data.accessToken), DEV_A)).status).toBe(200);
  });
});

describe('access tokens', () => {
  it('a new app activates with tokens: "pair", gets no opaque token and searches with the access token', async () => {
    const t = await setup();
    const pair = await pairFor(t, DEV_B);
    expect(pair).not.toHaveProperty('token');
    expect(readState(t.file).sessions.some((x: { codeId: string }) => x.codeId === pair.codeId)).toBe(false);
    expect((await search(t.app, pair.accessToken, DEV_B)).status).toBe(200);
    const me = await call(t.app, 'GET', '/v1/me', { headers: { authorization: 'Bearer ' + pair.accessToken, 'x-device-id': DEV_B } });
    expect(me.status).toBe(200);
    expect(me.data).toMatchObject({ active: true, linked: true });
    expect((me.data.devices as unknown[]).length).toBe(2);
    expect(activeRowForCode(t.db, pair.codeId).last_seen_at).toBeGreaterThan(0);
  });

  it('rejects forged, expired, foreign and other-device tokens with 401', async () => {
    const t = await setup();
    const pair = await pairFor(t, DEV_B);
    const [, payload, sig] = pair.accessToken.split('.');
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const secret = tokenSecret(t.db, {});
    const sign = (key: string, body: string) => createHmac('sha256', key).update(body).digest('base64url');
    const rowB = activeRowForCode(t.db, pair.codeId);
    const rowA = activeRowForCode(t.db, t.codeId);
    const cases: [string, string, string][] = [
      // payload changed (longer exp), old signature
      ['a1.' + b64({ ...p, exp: p.exp + 30 * DAY }) + '.' + sig, DEV_B, 'bad_token'],
      // right payload, signed with another key
      ['a1.' + payload + '.' + sign('x'.repeat(64), 'a1.' + payload), DEV_B, 'bad_token'],
      // no signature, «alg none» style
      ['a1.' + payload + '.', DEV_B, 'bad_token'],
      ['a1.' + payload, DEV_B, 'bad_token'],
      // another version prefix with a valid HMAC over it
      ['a2.' + payload + '.' + sign(secret, 'a2.' + payload), DEV_B, 'expired'],
      // the token of phone B presented by phone A
      [pair.accessToken, DEV_A, 'bad_token'],
      // properly signed, but dev points at A's row while did is B's
      ['a1.' + b64({ ...p, dev: rowA.id }) + '.' + sign(secret, 'a1.' + b64({ ...p, dev: rowA.id })), DEV_B, 'bad_token'],
      // properly signed for B, but exp passed
      [signAccess(secret, rowB, Date.now() - ACCESS_TTL_MS - 1000).token, DEV_B, 'token_expired'],
      // a JWT with alg none is not an access token at all: the legacy path says expired (403)
      [b64({ alg: 'none', typ: 'JWT' }) + '.' + payload + '.', DEV_B, 'expired'],
    ];
    for (const [token, device, error] of cases) {
      const out = await search(t.app, token, device);
      expect({ token: token.slice(0, 12), status: out.status, error: out.data.error }).toEqual({
        token: token.slice(0, 12),
        status: error === 'expired' ? 403 : 401,
        error,
      });
    }
    // The genuine token still works.
    expect((await search(t.app, pair.accessToken, DEV_B)).status).toBe(200);
    // /v1/me and /v1/torrent answer 401 the same way for a bad access token.
    const me = await call(t.app, 'GET', '/v1/me', { headers: { authorization: 'Bearer a1.' + payload + '.', 'x-device-id': DEV_B } });
    expect(me).toMatchObject({ status: 401, data: { error: 'bad_token' } });
    const torrent = await call(t.app, 'POST', '/v1/torrent', {
      headers: { authorization: 'Bearer ' + signAccess(secret, rowB, Date.now() - 2 * ACCESS_TTL_MS).token, 'x-device-id': DEV_B },
      body: { link: 'x' },
    });
    expect(torrent).toMatchObject({ status: 401, data: { error: 'token_expired' } });
  });

  it('BILLING_TOKEN_SECRET signs when set; tokens from the stored key then fail', async () => {
    const t = await setup({ env: { BILLING_TOKEN_SECRET: 's'.repeat(40) } });
    const pair = await pairFor(t, DEV_B);
    expect((await search(t.app, pair.accessToken, DEV_B)).status).toBe(200);
    const rowB = activeRowForCode(t.db, pair.codeId);
    const stored = signAccess(tokenSecret(t.db, {}), rowB, Date.now()).token;
    expect(await search(t.app, stored, DEV_B)).toMatchObject({ status: 401, data: { error: 'bad_token' } });
  });

  it('a new BILLING_TOKEN_SECRET over an existing DB key: old access tokens fail, refresh gives working ones, nothing is unbound', async () => {
    const t = await setup();
    const pair = await pairFor(t, DEV_B);
    expect((await search(t.app, pair.accessToken, DEV_B)).status).toBe(200);
    // Same database, restarted with the key in .env.
    const app = createApp(t.file, async () => ({ ok: true, status: 200, text: async () => RSS, json: async () => ({}) }), {
      env: { BILLING_TOKEN_SECRET: 'e'.repeat(64) },
    });
    expect(await search(app, pair.accessToken, DEV_B)).toMatchObject({ status: 401, data: { error: 'bad_token' } });
    const r = await call(app, 'POST', '/v1/token/refresh', { headers: { 'x-device-id': DEV_B }, body: { refreshToken: pair.refreshToken } });
    expect(r.status).toBe(200);
    expect((await search(app, String(r.data.accessToken), DEV_B)).status).toBe(200);
    expect(activeRowForCode(t.db, pair.codeId)).toMatchObject({ status: 'active', clone_count: 0 });
    // The legacy token of phone A does not depend on the key.
    expect((await search(app, t.legacy, DEV_A)).status).toBe(200);
    // A key shorter than 32 characters is ignored (DB key signs) and says so once on stderr.
    const lines: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const weak = createApp(t.file, async () => ({ ok: true, status: 200, text: async () => RSS, json: async () => ({}) }), {
        env: { BILLING_TOKEN_SECRET: 'weak-value-x' },
      });
      expect((await search(weak, pair.accessToken, DEV_B)).status).toBe(200);
    } finally {
      process.stderr.write = orig;
    }
    expect(lines.join('')).toContain('BILLING_TOKEN_SECRET is shorter than 32 characters');
    expect(lines.join('')).not.toContain('weak-value-x');
  });

  it('an expired subscription gives 403 expired with a valid token; renewal brings the same token back', async () => {
    const t = await setup();
    const pair = await pairFor(t, DEV_B);
    await updateState(t.file, (st: State) => ({
      state: { ...st, subscriptions: st.subscriptions.map((x: object) => ({ ...x, paidUntil: Date.now() - 30 * DAY })) },
    }));
    expect(await search(t.app, pair.accessToken, DEV_B)).toMatchObject({ status: 403, data: { error: 'expired' } });
    const me = await call(t.app, 'GET', '/v1/me', { headers: { authorization: 'Bearer ' + pair.accessToken, 'x-device-id': DEV_B } });
    expect(me.status).toBe(200);
    expect(me.data.active).toBe(false);
    // Refresh still works (the phone learns its status); search stays closed.
    const r = await call(t.app, 'POST', '/v1/token/refresh', { headers: { 'x-device-id': DEV_B }, body: { refreshToken: pair.refreshToken } });
    expect(r.status).toBe(200);
    await updateState(t.file, (st: State) => ({
      state: { ...st, subscriptions: st.subscriptions.map((x: object) => ({ ...x, paidUntil: Date.now() + 30 * DAY })) },
    }));
    expect((await search(t.app, pair.accessToken, DEV_B)).status).toBe(200);
  });
});

describe('refresh rotation', () => {
  it('each refresh rotates; a retry inside 60 s with the successor unused is a lost response, not a clone', async () => {
    const t = await setup();
    const pair = await pairFor(t, DEV_B);
    const r1 = await call(t.app, 'POST', '/v1/token/refresh', { headers: { 'x-device-id': DEV_B }, body: { refreshToken: pair.refreshToken } });
    expect(r1.status).toBe(200);
    const n1 = r1.data as { refreshToken: string; accessToken: string; paidUntil: number };
    expect(n1.refreshToken).not.toBe(pair.refreshToken);
    expect(n1.paidUntil).toBeGreaterThan(Date.now());
    expect((await search(t.app, n1.accessToken, DEV_B)).status).toBe(200);
    // Lost response: the phone presents the old token again.
    const retry = await call(t.app, 'POST', '/v1/token/refresh', { headers: { 'x-device-id': DEV_B }, body: { refreshToken: pair.refreshToken } });
    expect(retry.status).toBe(200);
    const n2 = retry.data as { refreshToken: string };
    // The unused successor is dropped (no clone), the newest one works.
    expect(await call(t.app, 'POST', '/v1/token/refresh', { headers: { 'x-device-id': DEV_B }, body: { refreshToken: n1.refreshToken } })).toMatchObject({
      status: 401,
      data: { error: 'revoked' },
    });
    expect(activeRowForCode(t.db, pair.codeId)).not.toBeNull();
    const r3 = await call(t.app, 'POST', '/v1/token/refresh', { headers: { 'x-device-id': DEV_B }, body: { refreshToken: n2.refreshToken } });
    expect(r3.status).toBe(200);
    expect(t.sent.filter((m) => m.text.indexOf('отключено') >= 0)).toHaveLength(0);
  });

  it('a rotated token used after its successor was used is a suspected clone: marked, logged once an hour, nothing revoked', async () => {
    const t = await setup();
    const pair = await pairFor(t, DEV_B);
    const r1 = await call(t.app, 'POST', '/v1/token/refresh', { headers: { 'x-device-id': DEV_B }, body: { refreshToken: pair.refreshToken } });
    const n1 = r1.data as { refreshToken: string; accessToken: string };
    const r2 = await call(t.app, 'POST', '/v1/token/refresh', { headers: { 'x-device-id': DEV_B }, body: { refreshToken: n1.refreshToken } });
    expect(r2.status).toBe(200);
    const n2 = r2.data as { refreshToken: string; accessToken: string };
    // The copy still holds the first token: it gets a pair too (a false alarm must not lock a phone out).
    const clone = await call(t.app, 'POST', '/v1/token/refresh', { headers: { 'x-device-id': DEV_B }, body: { refreshToken: pair.refreshToken } });
    expect(clone.status).toBe(200);
    const row = activeRowForCode(t.db, pair.codeId);
    expect(row).toMatchObject({ status: 'active', clone_count: 1 });
    expect(row.clone_at).toBeGreaterThan(0);
    // Both holders keep working: nothing is revoked or unbound.
    expect((await search(t.app, n2.accessToken, DEV_B)).status).toBe(200);
    expect((await search(t.app, String(clone.data.accessToken), DEV_B)).status).toBe(200);
    expect(
      (await call(t.app, 'POST', '/v1/token/refresh', { headers: { 'x-device-id': DEV_B }, body: { refreshToken: n2.refreshToken } })).status,
    ).toBe(200);
    let st = readState(t.file);
    expect(st.codes.find((c: { id: string }) => c.id === pair.codeId)).toMatchObject({ deviceId: DEV_B });
    expect(st.audit[st.audit.length - 1]).toMatchObject({ action: 'device_clone', accountId: t.accountId });
    const feed = adminDashboard(st, Date.now()).events.map((e: { text: string }) => e.text);
    expect(feed.some((x: string) => x.indexOf('Подозрение на клон: ключ устройства bbbbbbbb') === 0)).toBe(true);
    // The user is not told.
    expect(t.sent).toHaveLength(0);
    // A second reuse within the hour counts but does not flood the journal.
    const again = await call(t.app, 'POST', '/v1/token/refresh', { headers: { 'x-device-id': DEV_B }, body: { refreshToken: n1.refreshToken } });
    expect(again.status).toBe(200);
    expect(activeRowForCode(t.db, pair.codeId).clone_count).toBe(2);
    st = readState(t.file);
    expect(st.audit.filter((a: { action: string }) => a.action === 'device_clone')).toHaveLength(1);
    // The admin device list shows the mark.
    const list = listDevices(t.db, t.subscriptionId).find((r: { code_id: string }) => r.code_id === pair.codeId);
    expect(list).toMatchObject({ clone_count: 2 });
    const user = userPayload(st, t.accountId, { registry: (subId: string) => listDevices(t.db, subId) });
    const shown = user.devices.find((d: { codeId: string }) => d.codeId === pair.codeId);
    expect(shown.cloneAt).toBeGreaterThan(0);
    expect(shown.cloneCount).toBe(2);
    expect(user.devices.find((d: { codeId: string }) => d.codeId === t.codeId).cloneAt).toBe(0);
  });

  it('a rotated token after the 60 s window is a suspected clone even if the successor was never used', () => {
    const file = tmpDb('grace');
    const s = base(Date.now());
    writeState(file, s.state);
    const db = registryDb(file);
    const secret = tokenSecret(db, {});
    const row = activeRowForCode(db, s.codeId);
    const now = Date.now();
    const issued = issuePair(db, secret, row, now).pair.refreshToken;
    const rot = refreshPair(db, secret, { refreshToken: issued, deviceId: DEV_A, now: now + 1000 });
    expect(rot.pair).toBeTruthy();
    const inside = refreshPair(db, secret, { refreshToken: issued, deviceId: DEV_A, now: now + 1000 + ROTATE_GRACE_MS });
    expect(inside.retry).toBe(true);
    expect(inside.clone).toBeUndefined();
    const outside = refreshPair(db, secret, { refreshToken: issued, deviceId: DEV_A, now: now + 1000 + ROTATE_GRACE_MS + 1 });
    expect(outside).toMatchObject({ clone: true, cloneLog: true });
    expect(outside.pair.refreshToken).toBeTruthy();
    const later = refreshPair(db, secret, { refreshToken: issued, deviceId: DEV_A, now: now + 2000 + ROTATE_GRACE_MS });
    expect(later).toMatchObject({ clone: true, cloneLog: false });
    const hourLater = refreshPair(db, secret, { refreshToken: issued, deviceId: DEV_A, now: now + 2000 + ROTATE_GRACE_MS + CLONE_LOG_EVERY_MS });
    expect(hourLater).toMatchObject({ clone: true, cloneLog: true });
    expect(activeRowForCode(db, s.codeId)).toMatchObject({ status: 'active', clone_count: 3 });
  });

  it('refuses unknown, other-device and expired refresh tokens, and rate-limits per IP', async () => {
    const t = await setup({ env: { BILLING_TOKEN_IP_MAX: '5' } });
    const pair = await pairFor(t, DEV_B);
    const r = (token: string, device: string) =>
      call(t.app, 'POST', '/v1/token/refresh', { headers: { 'x-device-id': device }, body: { refreshToken: token } });
    expect(await r('r1.' + 'x'.repeat(43), DEV_B)).toMatchObject({ status: 401, data: { error: 'bad_token' } });
    expect(await r(pair.refreshToken, DEV_A)).toMatchObject({ status: 401, data: { error: 'bad_token' } });
    expect(await r('', DEV_B)).toMatchObject({ status: 401, data: { error: 'bad_token' } });
    t.db.prepare('UPDATE refresh_tokens SET expires_at = ?').run(Date.now() - 1);
    expect(await r(pair.refreshToken, DEV_B)).toMatchObject({ status: 401, data: { error: 'refresh_expired' } });
    // Wrong-device and expired presentations do not revoke anything.
    expect(activeRowForCode(t.db, pair.codeId)).not.toBeNull();
    expect((await r(pair.refreshToken, DEV_B)).status).toBe(401);
    const limited = await r(pair.refreshToken, DEV_B);
    expect(limited.status).toBe(429);
    expect(Number((await r(pair.refreshToken, DEV_B)).status)).toBe(429);
  });
});

describe('revoke works against the registry', () => {
  it('admin revoke and bot «Отвязать» end access and refresh at once', async () => {
    const t = await setup();
    const pair = await pairFor(t, DEV_B);
    await updateState(t.file, (st: State) => revokeDevice(st, { accountId: t.accountId, codeId: pair.codeId, now: Date.now(), actor: ADMIN }));
    expect(await search(t.app, pair.accessToken, DEV_B)).toMatchObject({ status: 401, data: { error: 'revoked' } });
    expect(
      await call(t.app, 'POST', '/v1/token/refresh', { headers: { 'x-device-id': DEV_B }, body: { refreshToken: pair.refreshToken } }),
    ).toMatchObject({ status: 401, data: { error: 'revoked' } });
    expect(t.db.prepare('SELECT status FROM devices WHERE code_id = ?').get(pair.codeId)).toMatchObject({ status: 'revoked' });

    // Bot self-service on phone A (legacy token).
    await updateState(t.file, (st: State) => selfUnbind(st, { accountId: t.accountId, deviceIds: [DEV_A], now: Date.now() }));
    expect((await search(t.app, t.legacy, DEV_A)).status).toBe(403);
    expect(t.db.prepare('SELECT revoke_reason FROM devices WHERE code_id = ?').get(t.codeId)).toMatchObject({ revoke_reason: 'unbound' });
  });

  it('a rebind of the same slot gets a new registry row; old tokens of the slot stay dead', async () => {
    const t = await setup();
    const pair = await pairFor(t, DEV_B);
    const oldRow = activeRowForCode(t.db, pair.codeId);
    await updateState(t.file, (st: State) => revokeDevice(st, { accountId: t.accountId, codeId: pair.codeId, now: Date.now(), actor: ADMIN }));
    const code = readState(t.file).codes.find((c: { id: string }) => c.id === pair.codeId).plain;
    const again = await call(t.app, 'POST', '/v1/activate', { body: { code, deviceId: DEV_B, tokens: 'pair' } });
    expect(again.status).toBe(200);
    const newRow = activeRowForCode(t.db, pair.codeId);
    expect(newRow.id).not.toBe(oldRow.id);
    expect(await search(t.app, pair.accessToken, DEV_B)).toMatchObject({ status: 401, data: { error: 'revoked' } });
    expect((await search(t.app, String(again.data.accessToken), DEV_B)).status).toBe(200);
  });
});

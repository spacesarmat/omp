import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homePayload } from '../src/adminApi.mjs';
import { botReply, DEVICE_LIMIT_TEXT, paymentAdminNotices } from '../src/bot.mjs';
import {
  activate,
  applyPayment,
  createPromo,
  createSubscription,
  DEVICE_BASE,
  deviceLimitNow,
  financeReport,
  grantDays,
  issueActivation,
  issueCliAdminLogin,
  migrateDeviceBase,
  openAccount,
  quotePurchase,
  redeemPromo,
  sessionOk,
  startDeviceLink,
  confirmDeviceLink,
} from '../src/logic.mjs';
import { createApp, linkClearRequiresToken } from '../src/server.mjs';
import { activateLimitConfig, clientIp, createActivateLimiter } from '../src/services.mjs';
import { emptyState, readState, updateState, writeState } from '../src/store.mjs';
import { notificationHash } from '../src/yoomoney.mjs';

const NOW = Date.parse('2026-10-19T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const DEV_A = 'a'.repeat(32);
const DEV_B = 'b'.repeat(32);
const DEV_C = 'c'.repeat(32);

type State = ReturnType<typeof emptyState>;

function paid() {
  const opened = openAccount(emptyState(), { telegramId: '42', email: '', now: NOW });
  const created = createSubscription(opened.state, { accountId: opened.account.id, now: NOW, days: 30 });
  return { state: created.state as State, code: created.result.code as string, sub: created.result.subscriptionId as string, account: opened.account.id as string };
}

/** Both base slots bound: A with the first code, B with a second one. */
function full() {
  const start = paid();
  const a = activate(start.state, { code: start.code, deviceId: DEV_A, now: NOW });
  const second = issueActivation(a.state, { accountId: start.account, now: NOW });
  const b = activate(second.state, { code: second.result.code, deviceId: DEV_B, now: NOW });
  expect(b.result.error).toBeUndefined();
  return { ...start, state: b.state as State, tokenA: a.result.token as string, tokenB: b.result.token as string, codeB: second.result.code as string };
}

function codesOf(state: State, sub: string) {
  return state.codes.filter((c: { subscriptionId: string; revoked?: boolean }) => c.subscriptionId === sub && !c.revoked);
}

describe('device limit', () => {
  it('a base subscription allows two devices', () => {
    const start = paid();
    expect(DEVICE_BASE).toBe(2);
    expect(start.state.subscriptions[0].deviceLimit).toBe(2);
  });

  it('a bound code stays on its device and can be re-entered there', () => {
    const f = full();
    const refused = activate(f.state, { code: f.code, deviceId: DEV_C, now: NOW });
    expect(refused.result.error).toBe('other_device');
    const again = activate(f.state, { code: f.codeB, deviceId: DEV_B, now: NOW });
    expect(again.result.token).toBeTruthy();
  });

  it('activation of a free legacy code over the limit is device_limit and is logged', () => {
    const f = full();
    // Legacy data: a third unbound code minted before limits were enforced.
    const raised = { ...f.state, subscriptions: f.state.subscriptions.map((s: object) => ({ ...s, deviceLimit: 3 })) };
    const minted = issueActivation(raised, { accountId: f.account, now: NOW });
    const back = { ...minted.state, subscriptions: minted.state.subscriptions.map((s: object) => ({ ...s, deviceLimit: 2 })) };
    const refused = activate(back, { code: minted.result.code, deviceId: DEV_C, now: NOW });
    expect(refused.result.error).toBe('device_limit');
    expect(refused.result.token).toBeUndefined();
    expect(refused.state.attempts.some((a: { reason: string; accountId?: string }) => a.reason === 'device_limit' && a.accountId === f.account)).toBe(true);
    // Devices already bound keep working.
    expect(sessionOk(refused.state, { token: f.tokenA, deviceId: DEV_A, now: NOW })).toBeTruthy();
    expect(sessionOk(refused.state, { token: f.tokenB, deviceId: DEV_B, now: NOW })).toBeTruthy();
  });

  it('admin issue reuses a free code and refuses a new slot at the limit', () => {
    const start = paid();
    const reused = issueActivation(start.state, { accountId: start.account, now: NOW });
    expect(reused.result.code).toBe(start.code);
    expect(reused.result.reused).toBe(true);
    expect(codesOf(reused.state, start.sub)).toHaveLength(1);
    const f = full();
    const refused = issueActivation(f.state, { accountId: f.account, now: NOW });
    expect(refused.result.error).toBe('device_limit');
    expect(refused.result.bound).toBe(2);
    expect(refused.result.deviceLimit).toBe(2);
    expect(refused.state).toBe(f.state);
  });

  it('grant days at the limit extends the subscription without a new code', () => {
    const f = full();
    const before = codesOf(f.state, f.sub).length;
    const out = grantDays(f.state, { accountId: f.account, days: 5, now: NOW });
    expect(out.result.error).toBeUndefined();
    expect(out.result.code).toBe('');
    expect(out.result.limitReached).toBe(true);
    expect(out.result.paidUntil).toBe(NOW + 35 * DAY);
    expect(codesOf(out.state, f.sub)).toHaveLength(before);
  });

  it('grant days below the limit issues a code for the free slot', () => {
    const start = paid();
    const a = activate(start.state, { code: start.code, deviceId: DEV_A, now: NOW });
    const out = grantDays(a.state, { accountId: start.account, days: 1, now: NOW });
    expect(out.result.code).toBeTruthy();
    expect(out.result.limitReached).toBe(false);
    const again = grantDays(out.state, { accountId: start.account, days: 1, now: NOW });
    expect(again.result.code).toBe(out.result.code);
  });

  it('a promo at the limit adds days and no slot', () => {
    const f = full();
    const promo = createPromo(f.state, { code: 'DEMO7', days: 7, maxUses: 10, now: NOW });
    const out = redeemPromo(promo.state, { code: 'DEMO7', accountId: f.account, now: NOW });
    expect(out.result.error).toBeUndefined();
    expect(out.result.code).toBe('');
    expect(out.result.limitReached).toBe(true);
    expect(out.result.paidUntil).toBe(NOW + 37 * DAY);
    expect(codesOf(out.state, f.sub)).toHaveLength(2);
    expect(out.state.promos[0].uses).toHaveLength(1);
  });

  it('three promos on one account no longer mint three slots', () => {
    const start = paid();
    let state = start.state;
    for (const code of ['PROMOA', 'PROMOB', 'PROMOC']) {
      state = createPromo(state, { code, days: 1, maxUses: 5, now: NOW }).state;
      state = redeemPromo(state, { code, accountId: start.account, now: NOW }).state;
    }
    expect(codesOf(state, start.sub)).toHaveLength(1);
  });

  it('a paid extra device raises the limit and its code activates', () => {
    const f = full();
    f.state.settings.extraDeviceRub = 50;
    const quote = quotePurchase(f.state, { kind: 'dev', accountId: f.account, subscriptionId: f.sub, now: NOW });
    const applied = applyPayment(quote.state, { operationId: 'op-dev', label: quote.result.label, amount: '50.00', currency: '643', now: NOW });
    expect(applied.result.kind).toBe('device');
    expect(applied.result.code).toBeTruthy();
    // PR-2: the extra device is a monthly slot until paidUntil; the included limit stays 2.
    expect(applied.state.subscriptions[0].deviceLimit).toBe(2);
    expect(applied.state.subscriptions[0].extraSlots).toBe(1);
    expect(applied.state.subscriptions[0].extraUntil).toBe(applied.state.subscriptions[0].paidUntil);
    expect(deviceLimitNow(applied.state, applied.state.subscriptions[0], NOW)).toBe(3);
    const c = activate(applied.state, { code: applied.result.code, deviceId: DEV_C, now: NOW });
    expect(c.result.token).toBeTruthy();
  });

  it('bot «Код» and promo explain the limit instead of minting a code', () => {
    const f = full();
    const code = botReply(f.state, { chatId: '42', text: 'Код', now: NOW });
    const text = code.messages.map((m: { text: string }) => m.text).join('\n');
    expect(text).toContain(DEVICE_LIMIT_TEXT);
    expect(text).toContain('2 из 2');
    expect(codesOf(code.state, f.sub)).toHaveLength(2);
    const promoState = createPromo(f.state, { code: 'BOT1', days: 1, maxUses: 5, now: NOW }).state;
    const promo = botReply(promoState, { chatId: '42', text: '/promo BOT1', now: NOW });
    const promoText = promo.messages.map((m: { text: string }) => m.text).join('\n');
    expect(promoText).toContain('Промокод принят');
    expect(promoText).toContain(DEVICE_LIMIT_TEXT);
  });

  it('bot «Код» hands out a code while a slot is free', () => {
    const start = paid();
    const a = activate(start.state, { code: start.code, deviceId: DEV_A, now: NOW });
    const out = botReply(a.state, { chatId: '42', text: 'Код', now: NOW });
    const text = out.messages.map((m: { text: string }) => m.text).join('\n');
    expect(text).toContain('Код подписки');
    expect(codesOf(out.state, start.sub)).toHaveLength(2);
  });
});

describe('deviceLimit migration to the base of 2', () => {
  it('raises stored limits by one once, keeping a bought extra slot', () => {
    const old = {
      ...emptyState(),
      meta: undefined,
      subscriptions: [
        { id: 's1', accountId: 'a1', product: 'jackett', paidUntil: NOW + DAY, deviceLimit: 1, createdAt: NOW },
        { id: 's2', accountId: 'a2', product: 'jackett', paidUntil: NOW + DAY, deviceLimit: 2, createdAt: NOW },
      ],
    };
    const once = migrateDeviceBase(old);
    expect(once.subscriptions.map((s: { deviceLimit: number }) => s.deviceLimit)).toEqual([2, 3]);
    expect(once.meta.deviceBase).toBe(2);
    const twice = migrateDeviceBase(once);
    expect(twice.subscriptions.map((s: { deviceLimit: number }) => s.deviceLimit)).toEqual([2, 3]);
  });

  it('a stored "2 of 1" subscription reads back as "2 of 2" and both devices keep working', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omp-dev-'));
    const file = join(dir, 'billing.db');
    const f = full();
    // Snapshot as the old server wrote it: no meta, limit 1, two bound devices.
    const legacy: Record<string, unknown> = {
      ...f.state,
      subscriptions: f.state.subscriptions.map((s: object) => ({ ...s, deviceLimit: 1 })),
    };
    delete legacy.meta;
    writeState(file, legacy);
    const read = readState(file);
    expect(read.subscriptions[0].deviceLimit).toBe(2);
    expect(read.meta.deviceBase).toBe(2);
    expect(readState(file).subscriptions[0].deviceLimit).toBe(2);
    expect(sessionOk(read, { token: f.tokenA, deviceId: DEV_A, now: NOW })).toBeTruthy();
    expect(sessionOk(read, { token: f.tokenB, deviceId: DEV_B, now: NOW })).toBeTruthy();
    const home = homePayload({ ...read, subscriptions: read.subscriptions.map((s: object) => ({ ...s, paidUntil: Date.now() + DAY })) }, file, {});
    expect(home.subscriptions[0].overLimit).toBe(false);
    expect(home.subscriptions[0].bound).toBe(2);
  });
});

describe('YooMoney unaccepted', () => {
  function withQuote() {
    const start = paid();
    start.state.settings.priceRub = 150;
    const quote = quotePurchase(start.state, { kind: 'sub', accountId: start.account, subscriptionId: start.sub, now: NOW });
    return { ...start, state: quote.state as State, label: quote.result.label as string };
  }

  it('records a held payment as pending and does not extend', () => {
    const q = withQuote();
    const held = applyPayment(q.state, { operationId: 'op-h', label: q.label, amount: '150.00', currency: '643', unaccepted: 'true', now: NOW });
    expect(held.result.pending).toBe(true);
    expect(held.result.error).toBe('unaccepted');
    expect(held.state.subscriptions[0].paidUntil).toBe(NOW + 30 * DAY);
    const row = held.state.payments.find((p: { operationId: string }) => p.operationId === 'op-h');
    expect(row.pending).toBe(true);
    expect(row.accountId).toBe(q.account);
    const report = financeReport(held.state, NOW);
    expect(report.summary.total.count).toBe(0);
    expect(report.problems.some((p: { kind: string }) => p.kind === 'unaccepted')).toBe(true);
    const repeat = applyPayment(held.state, { operationId: 'op-h', label: q.label, amount: '150.00', currency: '643', unaccepted: 'true', now: NOW });
    expect(repeat.result.duplicate).toBe(true);
  });

  it('the accepted notice for the same operation then extends once', () => {
    const q = withQuote();
    const held = applyPayment(q.state, { operationId: 'op-h', label: q.label, amount: '150.00', currency: '643', unaccepted: 'true', now: NOW });
    const ok = applyPayment(held.state, { operationId: 'op-h', label: q.label, amount: '150.00', currency: '643', unaccepted: 'false', now: NOW });
    expect(ok.result.kind).toBe('renew');
    expect(ok.state.subscriptions[0].paidUntil).toBe(NOW + 60 * DAY);
    expect(ok.state.payments.filter((p: { operationId: string }) => p.operationId === 'op-h')).toHaveLength(1);
    expect(ok.state.payments[0].pending).toBeUndefined();
    const dup = applyPayment(ok.state, { operationId: 'op-h', label: q.label, amount: '150.00', currency: '643', now: NOW });
    expect(dup.result.duplicate).toBe(true);
  });

  it('admin notice says the payment is held', () => {
    const msgs = paymentAdminNotices({ adminTelegramIds: '1', adminNotify: true }, { ok: false, pending: true, amount: '150', label: 'buy:x', error: 'unaccepted', who: '' });
    expect(msgs[0].text).toContain('ждёт подтверждения');
  });
});

describe('activate rate limit', () => {
  it('reads limits from env with defaults', () => {
    expect(activateLimitConfig({})).toEqual({ ipMax: 20, codeMax: 10, windowMs: 600000 });
    expect(activateLimitConfig({ BILLING_ACTIVATE_IP_MAX: '3', BILLING_ACTIVATE_CODE_MAX: '0', BILLING_ACTIVATE_WINDOW_SEC: '60' })).toEqual({
      ipMax: 3,
      codeMax: 0,
      windowMs: 60000,
    });
    expect(activateLimitConfig({ BILLING_ACTIVATE_IP_MAX: 'x' }).ipMax).toBe(20);
  });

  it('limits per IP and per code and recovers after the window', () => {
    let t = NOW;
    const lim = createActivateLimiter({ ipMax: 3, codeMax: 2, windowMs: 60000 }, { now: () => t });
    expect(lim.check('1.1.1.1', 'k1')).toBe(0);
    expect(lim.check('2.2.2.2', 'k1')).toBe(0);
    expect(lim.check('3.3.3.3', 'k1')).toBeGreaterThan(0);
    expect(lim.check('1.1.1.1', 'k2')).toBe(0);
    expect(lim.check('1.1.1.1', 'k3')).toBe(0);
    expect(lim.check('1.1.1.1', 'k4')).toBe(60);
    t += 60001;
    expect(lim.check('1.1.1.1', 'k1')).toBe(0);
  });

  it('takes the client address from Cloudflare, then X-Forwarded-For, then the socket', () => {
    expect(clientIp({ headers: { 'cf-connecting-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1' } })).toBe('9.9.9.9');
    expect(clientIp({ headers: { 'x-forwarded-for': '1.1.1.1, 10.0.0.1' } })).toBe('1.1.1.1');
    expect(clientIp({ headers: {}, socket: { remoteAddress: '127.0.0.1' } })).toBe('127.0.0.1');
  });
});

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

async function call(
  app: (req: unknown, res: unknown) => Promise<void>,
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: unknown; form?: Record<string, string> } = {},
) {
  const payload = opts.form ? new URLSearchParams(opts.form).toString() : opts.body === undefined ? '' : JSON.stringify(opts.body);
  const req = {
    method,
    url: path,
    headers: {
      accept: 'application/json',
      'content-type': opts.form ? 'application/x-www-form-urlencoded' : 'application/json',
      ...(opts.headers || {}),
    },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  };
  const res = mockRes();
  await app(req, res);
  let data: Record<string, unknown> | null = null;
  try {
    data = JSON.parse(res.body) as Record<string, unknown>;
  } catch (e) {
    data = null;
  }
  return { status: res.status, headers: res.headers, data, body: res.body };
}

const noFetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }), text: async () => '', headers: {}, arrayBuffer: async () => new ArrayBuffer(0) });

function tempFile(state: unknown) {
  const file = join(mkdtempSync(join(tmpdir(), 'omp-pr1-')), 'billing.db');
  writeState(file, state);
  return file;
}

describe('billing HTTP: activation, link clear, /v1/me', () => {
  it('/v1/activate answers 409 device_limit for a third device and 429 past the IP limit', async () => {
    const f = full();
    const minted = issueActivation(
      { ...f.state, subscriptions: f.state.subscriptions.map((s: object) => ({ ...s, deviceLimit: 3 })) },
      { accountId: f.account, now: NOW },
    );
    const file = tempFile({ ...minted.state, subscriptions: minted.state.subscriptions.map((s: object) => ({ ...s, deviceLimit: 2, paidUntil: Date.now() + DAY })) });
    const app = createApp(file, noFetch, { env: { BILLING_ACTIVATE_IP_MAX: '3', BILLING_ACTIVATE_CODE_MAX: '10' } });
    const ip = { 'cf-connecting-ip': '203.0.113.5' };
    const third = await call(app, 'POST', '/v1/activate', { headers: ip, body: { code: minted.result.code, deviceId: DEV_C } });
    expect(third.status).toBe(409);
    expect(third.data && third.data.error).toBe('device_limit');
    const reentry = await call(app, 'POST', '/v1/activate', { headers: ip, body: { code: f.codeB, deviceId: DEV_B } });
    expect(reentry.status).toBe(200);
    await call(app, 'POST', '/v1/activate', { headers: ip, body: { code: 'ZZZZZZZZ', deviceId: DEV_C } });
    const limited = await call(app, 'POST', '/v1/activate', { headers: ip, body: { code: 'YYYYYYYY', deviceId: DEV_C } });
    expect(limited.status).toBe(429);
    expect(limited.data && limited.data.error).toBe('rate');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    const other = await call(app, 'POST', '/v1/activate', { headers: { 'cf-connecting-ip': '203.0.113.6' }, body: { code: 'YYYYYYYY', deviceId: DEV_C } });
    expect(other.status).toBe(403);
  });

  it('/v1/activate limits one code across addresses', async () => {
    const start = paid();
    const file = tempFile(start.state);
    const app = createApp(file, noFetch, { env: { BILLING_ACTIVATE_IP_MAX: '100', BILLING_ACTIVATE_CODE_MAX: '2' } });
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await call(app, 'POST', '/v1/activate', { headers: { 'cf-connecting-ip': '198.51.100.' + i }, body: { code: 'QQQQ-QQQQ', deviceId: DEV_C } });
      statuses.push(r.status);
    }
    expect(statuses).toEqual([403, 403, 429]);
  });

  it('/v1/link/clear checks a sent token, and can require one', async () => {
    const start = paid();
    const a = activate(start.state, { code: start.code, deviceId: DEV_A, now: NOW });
    const file = tempFile(a.state);
    const app = createApp(file, noFetch, { env: {} });
    const wrong = await call(app, 'POST', '/v1/link/clear', { headers: { 'x-device-id': DEV_A, authorization: 'Bearer nope' }, body: { deviceId: DEV_A } });
    expect(wrong.status).toBe(401);
    const foreign = await call(app, 'POST', '/v1/link/clear', { headers: { 'x-device-id': DEV_B, authorization: 'Bearer ' + a.result.token }, body: {} });
    expect(foreign.status).toBe(401);
    expect(readState(file).accounts[0].linkedDevices).toContain(DEV_A);
    const good = await call(app, 'POST', '/v1/link/clear', { headers: { 'x-device-id': DEV_A, authorization: 'Bearer ' + a.result.token }, body: {} });
    expect(good.status).toBe(200);
    expect(readState(file).accounts[0].linkedDevices).not.toContain(DEV_A);

    // Compatibility (default): the current app sends only the device id.
    const linked = startDeviceLink(readState(file), { deviceId: DEV_B, now: Date.now() });
    const confirmed = confirmDeviceLink(linked.state, { token: linked.result.token, telegramId: '42', now: Date.now() });
    writeState(file, confirmed.state);
    const legacy = await call(app, 'POST', '/v1/link/clear', { headers: { 'x-device-id': DEV_B }, body: { deviceId: DEV_B } });
    expect(legacy.status).toBe(200);

    const strict = createApp(file, noFetch, { env: { BILLING_LINK_CLEAR_REQUIRE_TOKEN: '1' } });
    const bare = await call(strict, 'POST', '/v1/link/clear', { headers: { 'x-device-id': DEV_A }, body: { deviceId: DEV_A } });
    expect(bare.status).toBe(401);
    expect(bare.data && bare.data.error).toBe('token_required');
    expect(linkClearRequiresToken({ BILLING_LINK_CLEAR_REQUIRE_TOKEN: 'on' })).toBe(true);
    expect(linkClearRequiresToken({})).toBe(false);
  });

  it('/v1/me lists other devices only for a valid token', async () => {
    const f = full();
    const file = tempFile({ ...f.state, subscriptions: f.state.subscriptions.map((s: object) => ({ ...s, paidUntil: Date.now() + DAY })) });
    const app = createApp(file, noFetch, { env: {} });
    const withToken = await call(app, 'GET', '/v1/me', { headers: { 'x-device-id': DEV_A, authorization: 'Bearer ' + f.tokenA } });
    expect(withToken.status).toBe(200);
    expect((withToken.data && (withToken.data.devices as unknown[])) || []).toHaveLength(2);
    expect(withToken.data && withToken.data.deviceLimit).toBe(2);
    const bare = await call(app, 'GET', '/v1/me', { headers: { 'x-device-id': DEV_A } });
    expect(bare.status).toBe(200);
    expect(bare.data && bare.data.active).toBe(true);
    expect(bare.data && bare.data.devices).toEqual([]);
  });

  it('/v1/yoomoney with unaccepted=true keeps the subscription date', async () => {
    const start = paid();
    start.state.settings.priceRub = 150;
    start.state.settings.yoomoneySecret = 'secret';
    const quote = quotePurchase(start.state, { kind: 'sub', accountId: start.account, subscriptionId: start.sub, now: NOW });
    const file = tempFile(quote.state);
    const app = createApp(file, noFetch, { env: {} });
    const fields: Record<string, string> = {
      notification_type: 'card-incoming',
      operation_id: 'op-u',
      amount: '150.00',
      currency: '643',
      datetime: '2026-10-19T00:00:00Z',
      sender: '',
      codepro: 'false',
      label: quote.result.label,
      unaccepted: 'true',
      sha1_hash: '',
    };
    fields.sha1_hash = notificationHash(fields, 'secret');
    const res = await call(app, 'POST', '/v1/yoomoney', { form: fields });
    expect(res.status).toBe(200);
    const after = readState(file);
    expect(after.subscriptions[0].paidUntil).toBe(NOW + 30 * DAY);
    expect(after.payments[0].pending).toBe(true);
  });

  it('admin issue at the limit flashes a clear error', async () => {
    const f = full();
    const file = tempFile({ ...f.state, subscriptions: f.state.subscriptions.map((s: object) => ({ ...s, paidUntil: Date.now() + DAY })) });
    const app = createApp(file, noFetch, { env: {} });
    const link = await updateState(file, (s: State) => issueCliAdminLogin(s, { now: Date.now() }));
    const once = await call(app, 'GET', '/admin/login/once?token=' + encodeURIComponent(link.token));
    const cookie = String(once.headers['set-cookie'] || '').split(';')[0];
    const home = await call(app, 'GET', '/admin/api/home', { headers: { cookie } });
    const csrf = home.data && home.data.csrf;
    const issued = await call(app, 'POST', '/admin/issue', { headers: { cookie }, body: { csrf, telegramId: '42', channel: 'none' } });
    const flash = (issued.data && issued.data.flash) as { error?: string; code?: string };
    expect(flash.error).toContain('Лимит устройств');
    expect(flash.code).toBe('');
    const granted = await call(app, 'POST', '/admin/grant', { headers: { cookie }, body: { csrf, accountId: f.account, days: 3 } });
    const g = (granted.data && granted.data.flash) as { text?: string; code?: string };
    expect(g.text).toContain('новый код не выдан');
    expect(g.code).toBe('');
  });
});

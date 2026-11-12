import { describe, expect, it } from 'vitest';
import { cryptoPaySign } from '../src/cryptoPay.mjs';
import { activate, createSubscription, ensureTelegramAccount, issueCliAdminLogin } from '../src/logic.mjs';
import { createApp } from '../src/server.mjs';
import { emptyState } from '../src/state.mjs';
import { grossUp, notificationSign } from '../src/yoomoney.mjs';
import { readState, testStore, writeState } from './pg';

const SECRET = 'test-notify-secret';
const DEV = 'd'.repeat(32);

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

async function call(
  app: (req: unknown, res: unknown) => Promise<void>,
  method: string,
  path: string,
  opts: { body?: unknown; form?: Record<string, string>; headers?: Record<string, string>; cookie?: string } = {},
) {
  const payload = opts.form ? new URLSearchParams(opts.form).toString() : opts.body === undefined ? '' : JSON.stringify(opts.body);
  const req = {
    method,
    url: path,
    headers: {
      accept: 'application/json',
      'content-type': opts.form ? 'application/x-www-form-urlencoded' : 'application/json',
      cookie: opts.cookie || '',
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
  return { status: res.status, headers: res.headers, body: res.body, data };
}

function signed(fields: Record<string, string>) {
  const next = { ...fields };
  next.sign = notificationSign(next, SECRET);
  return next;
}

async function boot() {
  const now = Date.UTC(2026, 10, 12, 9, 0, 0);
  const opened = ensureTelegramAccount(emptyState(), '42', now);
  const created = createSubscription(opened.state, { accountId: opened.account.id, now, days: 30 });
  const act = activate(created.state, { code: created.result.code, deviceId: DEV, now });
  const state = act.state;
  state.settings.botToken = '123:fake';
  state.settings.yoomoneySecret = SECRET;
  state.settings.yoomoneyWallet = '410011111111111';
  state.settings.adminTelegramIds = '7';
  state.settings.adminNotify = true;
  state.settings.cryptoPayToken = 'crypto-token';
  state.settings.cryptoRateUsdt = 100;
  state.settings.donate = {
    enabled: true,
    amounts: '100,300,500,1000',
    minRub: 50,
    maxRub: 15000,
    commentMax: 200,
    thanksText: 'Спасибо за поддержку OMP.',
    yoomoney: true,
    stars: true,
    crypto: true,
    rubPerStar: 2,
    notifyAll: true,
    notifyMin: 0,
    showAmounts: false,
  };
  const up = grossUp(300, 'AC');
  const until = created.result.paidUntil;
  state.donations = [
    {
      id: 'aabbccddeeff0011',
      accountId: opened.account.id,
      telegramId: '42',
      displayName: 'Анна',
      showName: true,
      nameHidden: false,
      comment: 'на сервер',
      commentHidden: false,
      amountRub: 300,
      method: 'AC',
      asset: '',
      payAmount: up.gross,
      gross: up.gross,
      fee: up.fee,
      status: 'pending',
      step: '',
      operationId: '',
      invoiceId: '',
      createdAt: now,
      paidAt: 0,
      refundedAt: 0,
    },
  ];
  const sent: string[] = [];
  const store = await testStore();
  await writeState(store, state);
  const app = createApp(store, async (_url: string, init?: { body?: string }) => {
    sent.push(String((init && init.body) || ''));
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 4 } }), text: async () => '' };
  });
  return { app, store, until, gross: up.gross, accountId: opened.account.id, sent, token: act.result.token as string };
}

describe('donate webhooks', () => {
  it('accepts one signed YooMoney notice, thanks the payer, and does not extend the subscription', async () => {
    const b = await boot();
    const notice = signed({
      notification_type: 'card-incoming',
      operation_id: 'op-don-http',
      amount: '300.00',
      withdraw_amount: b.gross,
      currency: '643',
      datetime: '2026-11-12T12:00:00Z',
      sender: '',
      codepro: 'false',
      label: 'don:aabbccddeeff0011',
      unaccepted: 'false',
    });
    const first = await call(b.app, 'POST', '/v1/yoomoney', { form: notice });
    expect(first.status).toBe(200);
    const state = await readState(b.store);
    const row = state.donations.find((d: { id: string }) => d.id === 'aabbccddeeff0011');
    expect(row.status).toBe('paid');
    expect(row.operationId).toBe('op-don-http');
    expect(state.payments).toEqual([]);
    expect(state.subscriptions[0].paidUntil).toBe(b.until);
    expect(b.sent.some((body) => body.indexOf('Спасибо за поддержку OMP') >= 0)).toBe(true);
    expect(b.sent.some((body) => body.indexOf('Донат 300') >= 0)).toBe(true);
    const me = await call(b.app, 'GET', '/v1/me', { headers: { authorization: 'Bearer ' + b.token, 'x-device-id': DEV } });
    expect(me.data && me.data.supporter).toBe(true);
    const thanks = await call(b.app, 'GET', '/v1/thanks');
    expect(JSON.stringify(thanks.data)).toContain('Анна');
    expect(JSON.stringify(thanks.data)).not.toContain('300');
    const second = await call(b.app, 'POST', '/v1/yoomoney', { form: notice });
    expect(second.status).toBe(200);
    const again = await readState(b.store);
    expect(again.donations.filter((d: { status: string }) => d.status === 'paid')).toHaveLength(1);
    expect(again.subscriptions[0].paidUntil).toBe(b.until);
  });

  it('rejects a bad signature and a short amount', async () => {
    const b = await boot();
    const bad = await call(b.app, 'POST', '/v1/yoomoney', {
      form: { ...signed({ notification_type: 'card-incoming', operation_id: 'x', amount: '300.00', currency: '643', label: 'don:aabbccddeeff0011', codepro: 'false', withdraw_amount: b.gross, datetime: '2026-11-12T12:00:00Z', sender: '', unaccepted: 'false' }), sign: '00' },
    });
    expect(bad.status).toBe(400);
    const up = grossUp(300, 'AC');
    const short = signed({
      notification_type: 'card-incoming',
      operation_id: 'op-short',
      amount: '1.00',
      withdraw_amount: '1.00',
      currency: '643',
      datetime: '2026-11-12T12:00:00Z',
      sender: '',
      codepro: 'false',
      label: 'don:aabbccddeeff0011',
      unaccepted: 'false',
    });
    expect(up.gross).not.toBe('1.00');
    const res = await call(b.app, 'POST', '/v1/yoomoney', { form: short });
    expect(res.status).toBe(200);
    const state = await readState(b.store);
    expect(state.donations[0].status).toBe('pending');
    expect(state.subscriptions[0].paidUntil).toBe(b.until);
  });

  it('settles a Crypto Pay donation once and ignores a second invoice', async () => {
    const b = await boot();
    const state = await readState(b.store);
    state.donations[0] = {
      ...state.donations[0],
      method: 'crypto',
      asset: 'USDT',
      payAmount: '3.00',
      gross: '',
      invoiceId: '77',
      amountRub: 300,
    };
    await writeState(b.store, state);
    const payload = {
      update_id: 1,
      update_type: 'invoice_paid',
      payload: { invoice_id: 77, status: 'paid', asset: 'USDT', amount: '3.00', paid_amount: '3.00', paid_asset: 'USDT', payload: 'don:aabbccddeeff0011' },
    };
    const sign = cryptoPaySign(JSON.stringify(payload), 'crypto-token');
    const ok = await call(b.app, 'POST', '/v1/crypto-pay', { body: payload, headers: { 'crypto-pay-api-signature': sign } });
    expect(ok.status).toBe(200);
    const paid = await readState(b.store);
    expect(paid.donations[0].status).toBe('paid');
    expect(paid.payments).toEqual([]);
    const again = await call(b.app, 'POST', '/v1/crypto-pay', { body: payload, headers: { 'crypto-pay-api-signature': sign } });
    expect(again.status).toBe(200);
    const twice = await readState(b.store);
    expect(twice.donations.filter((d: { status: string }) => d.status === 'paid')).toHaveLength(1);
  });
});

describe('donate admin', () => {
  it('saves switches, marks a refund, hides a name and exports csv', async () => {
    const b = await boot();
    const notice = signed({
      notification_type: 'card-incoming',
      operation_id: 'op-admin',
      amount: '300.00',
      withdraw_amount: b.gross,
      currency: '643',
      datetime: '2026-11-12T12:00:00Z',
      sender: '',
      codepro: 'false',
      label: 'don:aabbccddeeff0011',
      unaccepted: 'false',
    });
    await call(b.app, 'POST', '/v1/yoomoney', { form: notice });
    const storeState = await readState(b.store);
    const login = issueCliAdminLogin(storeState, { now: Date.now() });
    await writeState(b.store, login.state);
    const once = await call(b.app, 'GET', '/admin/login/once?token=' + encodeURIComponent(login.result.token));
    const cookie = String(once.headers['set-cookie'] || '');
    const home = await call(b.app, 'GET', '/admin/api/home', { cookie });
    const csrf = String((home.data && home.data.csrf) || '');
    const saved = await call(b.app, 'POST', '/admin/donate', {
      cookie,
      body: { csrf, enabled: 'false', yoomoney: 'true', stars: 'false', crypto: 'false', showAmounts: 'true', notifyAll: 'true', notifyMin: '500', amounts: '100,300', minRub: '50', maxRub: '5000', commentMax: '80', thanksText: 'Спасибо.', rubPerStar: '2' },
    });
    expect(saved.data && saved.data.ok).toBe(true);
    const after = await readState(b.store);
    expect(after.settings.donate.enabled).toBe(false);
    expect(after.settings.donate.showAmounts).toBe(true);
    const hidden = await call(b.app, 'POST', '/admin/donate/hide', { cookie, body: { csrf, id: 'aabbccddeeff0011', field: 'name' } });
    expect(hidden.data && hidden.data.ok).toBe(true);
    const thanks = await call(b.app, 'GET', '/v1/thanks');
    expect(JSON.stringify(thanks.data)).not.toContain('Анна');
    const csv = await call(b.app, 'GET', '/admin/donations.csv', { cookie });
    expect(csv.status).toBe(200);
    expect(csv.body).toContain('Анна');
    expect(csv.body).toContain('МСК');
    const refund = await call(b.app, 'POST', '/admin/donate/refund', { cookie, body: { csrf, id: 'aabbccddeeff0011', confirm: 'yes' } });
    expect(refund.data && refund.data.ok).toBe(true);
    const me = await call(b.app, 'GET', '/v1/me', { headers: { authorization: 'Bearer ' + b.token, 'x-device-id': DEV } });
    expect(me.data && me.data.supporter).toBe(false);
  });

  it('confirms a held YooMoney donation without a subscription payment', async () => {
    const b = await boot();
    const notice = signed({
      notification_type: 'card-incoming',
      operation_id: 'op-held-http',
      amount: '300.00',
      withdraw_amount: b.gross,
      currency: '643',
      datetime: '2026-11-12T12:00:00Z',
      sender: '',
      codepro: 'false',
      label: 'don:aabbccddeeff0011',
      unaccepted: 'true',
    });
    const held = await call(b.app, 'POST', '/v1/yoomoney', { form: notice });
    expect(held.status).toBe(200);
    const before = await readState(b.store);
    expect(before.donations[0].status).toBe('pending');
    expect(before.donations[0].held).toBe(true);
    expect(before.payments).toEqual([]);
    const login = issueCliAdminLogin(before, { now: Date.now() });
    await writeState(b.store, login.state);
    const once = await call(b.app, 'GET', '/admin/login/once?token=' + encodeURIComponent(login.result.token));
    const cookie = String(once.headers['set-cookie'] || '');
    const home = await call(b.app, 'GET', '/admin/api/home', { cookie });
    const csrf = String((home.data && home.data.csrf) || '');
    const confirmed = await call(b.app, 'POST', '/admin/donate/confirm', {
      cookie,
      body: { csrf, id: 'aabbccddeeff0011', confirm: 'yes' },
    });
    expect(confirmed.data && confirmed.data.ok).toBe(true);
    const after = await readState(b.store);
    expect(after.donations[0].status).toBe('paid');
    expect(after.payments).toEqual([]);
    expect(after.subscriptions[0].paidUntil).toBe(b.until);
  });
});

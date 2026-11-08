import { describe, expect, it } from 'vitest';
import { financeReport, openAccount, quotePurchase, subscriptionView } from '../src/logic.mjs';
import { createApp } from '../src/server.mjs';
import { emptyState } from '../src/state.mjs';
import { payUrl, notificationHash, notificationSign } from '../src/yoomoney.mjs';
import { readState, testStore, writeState } from './pg';

const SECRET = 'test-notify-secret';
const WALLET = '410011111111111';
const DAY = 24 * 60 * 60 * 1000;

type Fields = Record<string, string>;

function mockRes() {
  return {
    status: 0,
    body: '',
    headers: {} as Record<string, string>,
    writeHead(status: number) {
      this.status = status;
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
  form?: Fields | null,
) {
  const payload = form ? new URLSearchParams(form).toString() : '';
  const req = {
    method,
    url: path,
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  };
  const res = mockRes();
  await app(req, res);
  return res;
}

function signed(fields: Fields, secret = SECRET) {
  const next = { ...fields };
  next.sign = notificationSign(next, secret);
  return next;
}

function card(label: string, price: number, op: string, extra: Fields = {}) {
  const gross = Number(price).toFixed(2);
  const net = (Math.round(Number(price) * 97) / 100).toFixed(2);
  return signed({
    notification_type: 'card-incoming',
    operation_id: op,
    amount: net,
    withdraw_amount: gross,
    currency: '643',
    datetime: '2026-11-07T12:00:00Z',
    sender: '',
    codepro: 'false',
    label,
    unaccepted: 'false',
    ...extra,
  });
}

async function boot(price = 150) {
  const now = Date.now();
  const opened = openAccount(emptyState(), { telegramId: '42', email: '', now });
  const other = openAccount(opened.state, { telegramId: '77', email: '', now });
  const state = other.state;
  state.settings.priceRub = price;
  state.settings.extraDeviceRub = 50;
  state.settings.periodDays = 30;
  state.settings.yoomoneyWallet = WALLET;
  state.settings.yoomoneySecret = SECRET;
  state.settings.botToken = '123456:fake-token';
  const quoted = quotePurchase(state, { kind: 'new', accountId: opened.account.id, now });
  const store = await testStore();
  await writeState(store, quoted.state);
  const app = createApp(store, async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }), text: async () => '' }), {
    env: {},
  });
  return { store, app, quoted, buyer: opened.account.id, other: other.account.id, price, now };
}

function paidRows(state: { payments: { error?: string; pending?: boolean }[] }) {
  return state.payments.filter((p) => !p.error && !p.pending);
}

describe('YooMoney customer notice', () => {
  it('grants the quoted order to the buyer once, and shows it', async () => {
    const b = await boot();
    const label = b.quoted.result.label as string;
    const link = payUrl(WALLET, { sum: b.quoted.result.price, label, targets: 'OMP' });
    const q = new URL(link).searchParams;
    expect(q.get('receiver')).toBe(WALLET);
    expect(q.get('sum')).toBe(Number(b.price).toFixed(2));
    expect(q.get('label')).toBe(label);
    expect((q.get('label') || '').length).toBeLessThanOrEqual(64);
    expect(q.get('successURL')).toBeNull();

    const notice = card(label, b.price, 'op-live-1');
    expect((await call(b.app, 'POST', '/v1/yoomoney', notice)).status).toBe(200);
    const state = await readState(b.store);
    const view = subscriptionView(state, b.buyer, Date.now());
    expect(view && view.active).toBe(true);
    expect(view && view.paidUntil - b.now).toBeGreaterThan(29 * DAY);
    expect(view && view.paidUntil - b.now).toBeLessThan(31 * DAY);
    expect(subscriptionView(state, b.other, Date.now())).toBeNull();
    expect(paidRows(state)).toHaveLength(1);
    expect(paidRows(state)[0].accountId).toBe(b.buyer);
    expect(paidRows(state)[0].operationId).toBe('op-live-1');
    expect(paidRows(state)[0].withdrawAmount).toBe('150.00');
    const report = financeReport(state, Date.now());
    expect(report.summary.total.count).toBe(1);
    expect(report.payments[0].problem).toBe('');
    expect(report.payments[0].accountId).toBe(b.buyer);
  });

  it('does not grant an official test notice, an empty test, or a flagged signed payment', async () => {
    const b = await boot();
    const label = b.quoted.result.label as string;
    expect((await call(b.app, 'POST', '/v1/yoomoney', null)).status).toBe(200);
    expect((await call(b.app, 'POST', '/v1/yoomoney', { test_notification: 'true' })).status).toBe(200);
    const flagged = card(label, b.price, 'op-test-1', { test_notification: 'true' });
    expect((await call(b.app, 'POST', '/v1/yoomoney', flagged)).status).toBe(200);
    const bad = card(label, b.price, 'op-test-2', { test_notification: 'true' });
    bad.sign = '00'.repeat(32);
    expect((await call(b.app, 'POST', '/v1/yoomoney', bad)).status).toBe(400);
    const state = await readState(b.store);
    expect(state.subscriptions).toHaveLength(0);
    expect(paidRows(state)).toHaveLength(0);
    expect(state.webhooks.some((w: { kind: string }) => w.kind === 'test')).toBe(true);
  });

  it('rejects a bad signature, a dropped field and a legacy hash that does not match', async () => {
    const b = await boot();
    const label = b.quoted.result.label as string;
    const notice = card(label, b.price, 'op-bad-1');
    notice.amount = '1.00';
    expect((await call(b.app, 'POST', '/v1/yoomoney', notice)).status).toBe(400);
    const dropped = card(label, b.price, 'op-bad-2');
    delete dropped.currency;
    expect((await call(b.app, 'POST', '/v1/yoomoney', dropped)).status).toBe(400);
    const legacy = {
      notification_type: 'card-incoming',
      operation_id: 'op-legacy',
      amount: '150.00',
      currency: '643',
      datetime: '2026-11-07T12:00:00Z',
      sender: '',
      codepro: 'false',
      label,
      sha1_hash: notificationHash(
        {
          notification_type: 'card-incoming',
          operation_id: 'op-legacy',
          amount: '1.00',
          currency: '643',
          datetime: '2026-11-07T12:00:00Z',
          sender: '',
          codepro: 'false',
          label,
        },
        SECRET,
      ),
    };
    expect((await call(b.app, 'POST', '/v1/yoomoney', legacy)).status).toBe(400);
    const state = await readState(b.store);
    expect(state.subscriptions).toHaveLength(0);
  });

  it('keeps a legacy sha1 notice that still covers the price', async () => {
    const b = await boot();
    const label = b.quoted.result.label as string;
    const fields: Fields = {
      notification_type: 'card-incoming',
      operation_id: 'op-sha1',
      amount: '150.00',
      currency: '643',
      datetime: '2026-11-07T12:00:00Z',
      sender: '',
      codepro: 'false',
      label,
    };
    fields.sha1_hash = notificationHash(fields, SECRET);
    expect((await call(b.app, 'POST', '/v1/yoomoney', fields)).status).toBe(200);
    const state = await readState(b.store);
    expect(subscriptionView(state, b.buyer, Date.now())!.active).toBe(true);
  });

  it('refuses a short gross, a short net, the wrong currency, an unknown order and codepro', async () => {
    const b = await boot();
    const label = b.quoted.result.label as string;
    const cases: Fields[] = [
      card(label, b.price, 'op-short-gross', { withdraw_amount: '10.00', amount: '9.70' }),
      card(label, b.price, 'op-short-net', { amount: '100.00' }),
      card(label, b.price, 'op-currency', { currency: '840' }),
      card('buy:0123456789abcdef', b.price, 'op-unknown'),
      card(label, b.price, 'op-codepro', { codepro: 'true' }),
    ];
    for (const fields of cases) {
      expect((await call(b.app, 'POST', '/v1/yoomoney', fields)).status).toBe(200);
    }
    const wallet = signed({
      notification_type: 'p2p-incoming',
      operation_id: 'op-wallet-fee',
      amount: '145.50',
      withdraw_amount: '150.00',
      currency: '643',
      datetime: '2026-11-07T12:00:00Z',
      sender: '41001',
      codepro: 'false',
      label,
      unaccepted: 'false',
    });
    expect((await call(b.app, 'POST', '/v1/yoomoney', wallet)).status).toBe(200);
    const missingGross = card(label, b.price, 'op-no-gross');
    delete missingGross.withdraw_amount;
    missingGross.sign = notificationSign(missingGross, SECRET);
    expect((await call(b.app, 'POST', '/v1/yoomoney', missingGross)).status).toBe(200);
    const state = await readState(b.store);
    expect(state.subscriptions).toHaveLength(0);
    expect(paidRows(state)).toHaveLength(0);
    expect(state.payments.some((p: { error?: string }) => p.error === 'bad_label')).toBe(true);
    expect(state.payments.some((p: { error?: string }) => p.error === 'amount')).toBe(true);
  });

  it('accepts a wallet transfer at the documented 1% net', async () => {
    const b = await boot(1000);
    const label = b.quoted.result.label as string;
    const fields = signed({
      notification_type: 'p2p-incoming',
      operation_id: 'op-wallet-ok',
      amount: '990.09',
      withdraw_amount: '1000.00',
      currency: '643',
      datetime: '2026-11-07T12:00:00Z',
      sender: '41001',
      codepro: 'false',
      label,
      unaccepted: 'false',
    });
    expect((await call(b.app, 'POST', '/v1/yoomoney', fields)).status).toBe(200);
    expect(subscriptionView(await readState(b.store), b.buyer, Date.now())!.active).toBe(true);
  });

  it('holds an unaccepted transfer, then applies the same operation once', async () => {
    const b = await boot();
    const label = b.quoted.result.label as string;
    const held = card(label, b.price, 'op-hold', { unaccepted: 'true' });
    expect((await call(b.app, 'POST', '/v1/yoomoney', held)).status).toBe(200);
    expect(subscriptionView(await readState(b.store), b.buyer, Date.now())).toBeNull();
    const again = card(label, b.price, 'op-hold', { unaccepted: 'true' });
    expect((await call(b.app, 'POST', '/v1/yoomoney', again)).status).toBe(200);
    expect((await readState(b.store)).payments.filter((p: { pending?: boolean }) => p.pending)).toHaveLength(1);
    const ok = card(label, b.price, 'op-hold', { unaccepted: 'false' });
    expect((await call(b.app, 'POST', '/v1/yoomoney', ok)).status).toBe(200);
    const state = await readState(b.store);
    expect(subscriptionView(state, b.buyer, Date.now())!.active).toBe(true);
    expect(paidRows(state)).toHaveLength(1);
    expect(state.payments.filter((p: { pending?: boolean }) => p.pending)).toHaveLength(0);
  });

  it('replays and concurrent notices extend the subscription once', async () => {
    const b = await boot();
    const label = b.quoted.result.label as string;
    const notice = card(label, b.price, 'op-once');
    const both = await Promise.all([call(b.app, 'POST', '/v1/yoomoney', notice), call(b.app, 'POST', '/v1/yoomoney', notice)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 200]);
    expect((await call(b.app, 'POST', '/v1/yoomoney', notice)).status).toBe(200);
    const state = await readState(b.store);
    expect(paidRows(state)).toHaveLength(1);
    const until = subscriptionView(state, b.buyer, Date.now())!.paidUntil;
    expect(until - b.now).toBeGreaterThan(29 * DAY);
    expect(until - b.now).toBeLessThan(31 * DAY);
  });

  it('does not activate from a browser return, a cancel or a GET of the notice URL', async () => {
    const b = await boot();
    const label = b.quoted.result.label as string;
    const q = 'label=' + encodeURIComponent(label) + '&sum=150.00&success=1&fail=1';
    expect((await call(b.app, 'GET', '/v1/yoomoney/return?' + q)).status).toBe(200);
    expect((await call(b.app, 'POST', '/v1/yoomoney/return', { label, sum: '150.00', action: 'cancel' })).status).toBe(200);
    expect((await call(b.app, 'GET', '/v1/yoomoney?' + q)).status).toBe(404);
    const back = await call(b.app, 'GET', '/v1/yoomoney/return');
    expect(back.body).toContain('не включает подписку');
    const state = await readState(b.store);
    expect(state.subscriptions).toHaveLength(0);
    expect(state.payments).toHaveLength(0);
  });

  it('returns 500 when the database write fails, then applies the retry once', async () => {
    const b = await boot();
    const label = b.quoted.result.label as string;
    let left = 1;
    const flaky = {
      engine: b.store.engine,
      registry: b.store.registry,
      read: () => b.store.read(),
      update(fn: (s: unknown) => unknown) {
        if (left > 0) {
          left -= 1;
          return Promise.reject(new Error('db down'));
        }
        return b.store.update(fn);
      },
    };
    const app = createApp(flaky, async () => ({ ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' }), { env: {} });
    const notice = card(label, b.price, 'op-retry');
    expect((await call(app, 'POST', '/v1/yoomoney', notice)).status).toBe(500);
    expect((await readState(b.store)).subscriptions).toHaveLength(0);
    expect((await call(app, 'POST', '/v1/yoomoney', notice)).status).toBe(200);
    expect((await call(app, 'POST', '/v1/yoomoney', notice)).status).toBe(200);
    const state = await readState(b.store);
    expect(paidRows(state)).toHaveLength(1);
    expect(subscriptionView(state, b.buyer, Date.now())!.active).toBe(true);
  });
});

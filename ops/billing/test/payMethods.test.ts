import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { botCallback, botReply } from '../src/bot.mjs';
import { amountCovers, cryptoPayAuthentic, cryptoPayHost, cryptoPaySign, formatAsset, paidInvoice } from '../src/cryptoPay.mjs';
import { applyPayment, financeReport, openAccount, quotePurchase } from '../src/logic.mjs';
import { cryptoOffered, starCheckoutDecision, starDue, starInvoiceBody } from '../src/payMethods.mjs';
import { createApp, pollBot } from '../src/server.mjs';
import { mergeSettings, publicAdminSettings } from '../src/services.mjs';
import { emptyState } from '../src/state.mjs';
import { readState, testStore, writeState } from './pg';

const DAY = 24 * 60 * 60 * 1000;
const TOKEN = 'crypto-pay-test-token';

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
  opts: { body?: string; headers?: Record<string, string> } = {},
) {
  const payload = opts.body || '';
  const req = {
    method,
    url: path,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  };
  const res = mockRes();
  await app(req, res);
  return res;
}

function signedBody(obj: unknown, token = TOKEN) {
  const raw = JSON.stringify(obj);
  return { raw, sign: cryptoPaySign(raw, token) };
}

describe('stars and crypto prices', () => {
  it('charges the configured stars and does not add a fee', () => {
    expect(starDue({ starsPrice: 100, starsExtra: 40 }, 'new', 0, 150, 150)).toBe(100);
    expect(starDue({ starsPrice: 100, starsExtra: 40 }, 'sub', 2, 250, 250)).toBe(180);
    // A ruble credit scales stars down. Floor, so the payer is not asked for an extra star.
    expect(starDue({ starsPrice: 100 }, 'sub', 0, 150, 135)).toBe(90);
    const state = emptyState();
    state.settings.starsEnabled = true;
    state.settings.starsPrice = 100;
    state.settings.priceRub = 150;
    const opened = openAccount(state, { telegramId: '42', email: '', now: 1 });
    const quoted = quotePurchase(opened.state, { kind: 'new', accountId: opened.account.id, now: 1, method: 'stars' });
    expect(quoted.result.payAmount).toBe('100');
    expect(quoted.result.asset).toBe('XTR');
    const invoice = starInvoiceBody('42', {
      title: 'Подписка OMP',
      description: 'Подписка OMP, 30 дн.',
      payload: quoted.result.label,
      stars: 100,
    });
    expect(invoice.currency).toBe('XTR');
    expect(invoice.prices).toEqual([{ label: 'Подписка OMP', amount: 100 }]);
    expect(invoice.provider_token).toBe('');
  });

  it('keeps both methods off until the admin turns them on', () => {
    const fresh = emptyState().settings;
    expect(fresh.starsEnabled).toBe(false);
    expect(fresh.cryptoEnabled).toBe(false);
    expect(publicAdminSettings(fresh).starsEnabled).toBe(false);
    expect(publicAdminSettings(fresh).cryptoEnabled).toBe(false);
    const next = mergeSettings(fresh, { starsEnabled: 'true', starsPrice: '80', cryptoEnabled: 'false', cryptoPayToken: 'nope' });
    expect(next.starsEnabled).toBe(true);
    expect(next.starsPrice).toBe(80);
    expect(next.cryptoEnabled).toBe(false);
    expect(next.cryptoPayToken).toBe('');
    expect(JSON.stringify(publicAdminSettings({ ...next, cryptoPayToken: TOKEN }))).not.toContain(TOKEN);
  });

  it('hides crypto for RU and for an unknown country when the flag is on', () => {
    const on = { cryptoEnabled: true, cryptoNonRu: false };
    expect(cryptoOffered(on, 'RU')).toBe(true);
    const limited = { cryptoEnabled: true, cryptoNonRu: true };
    expect(cryptoOffered(limited, 'DE')).toBe(true);
    expect(cryptoOffered(limited, 'RU')).toBe(false);
    expect(cryptoOffered(limited, '')).toBe(false);
    expect(cryptoOffered({ cryptoEnabled: false, cryptoNonRu: false }, 'DE')).toBe(false);
  });
});

describe('crypto pay signature and amounts', () => {
  it('signs the raw body with SHA256(token) and rejects a changed byte', () => {
    expect(cryptoPayHost(false)).toBe('https://pay.crypt.bot');
    expect(cryptoPayHost(true)).toBe('https://testnet-pay.crypt.bot');
    const raw = '{"update_id":1}';
    const key = createHash('sha256').update(TOKEN, 'utf8').digest();
    const expectHex = createHmac('sha256', key).update(raw, 'utf8').digest('hex');
    expect(cryptoPaySign(raw, TOKEN)).toBe(expectHex);
    expect(cryptoPayAuthentic(raw, expectHex, TOKEN)).toBe(true);
    expect(cryptoPayAuthentic(raw + ' ', expectHex, TOKEN)).toBe(false);
    expect(cryptoPayAuthentic(raw, expectHex, '')).toBe(false);
    expect(formatAsset('USDT', 1.5)).toBe('1.50');
    expect(amountCovers('1.50', '1.5')).toBe(true);
    expect(amountCovers('1.49', '1.50')).toBe(false);
    expect(amountCovers('2', '1.50')).toBe(true);
    expect(amountCovers('0', '1')).toBe(false);
  });
});

describe('one order, one extension', () => {
  function boot() {
    const now = Date.UTC(2026, 10, 1);
    const opened = openAccount(emptyState(), { telegramId: '42', email: '', now });
    const state = opened.state;
    state.settings.priceRub = 150;
    state.settings.periodDays = 30;
    state.settings.starsEnabled = true;
    state.settings.starsPrice = 100;
    state.settings.cryptoEnabled = true;
    state.settings.cryptoUsdt = 2;
    return { state, accountId: opened.account.id, now };
  }

  it('extends once for the exact star amount and ignores a short or repeated payment', () => {
    const b = boot();
    const quoted = quotePurchase(b.state, { kind: 'new', accountId: b.accountId, now: b.now, method: 'stars' });
    const label = quoted.result.label;
    const paid = applyPayment(quoted.state, {
      operationId: 'stars:charge-1',
      label,
      amount: '100',
      currency: 'XTR',
      now: b.now,
    });
    expect(paid.result.kind).toBe('new');
    expect(paid.state.subscriptions).toHaveLength(1);
    expect(paid.state.payments[0].provider).toBe('stars');
    expect(paid.state.payments[0].rub).toBe(150);
    const again = applyPayment(paid.state, {
      operationId: 'stars:charge-1',
      label,
      amount: '100',
      currency: 'XTR',
      now: b.now + 1,
    });
    expect(again.result.duplicate).toBe(true);
    expect(again.state.subscriptions[0].paidUntil).toBe(paid.state.subscriptions[0].paidUntil);
    const other = applyPayment(paid.state, {
      operationId: 'stars:charge-2',
      label,
      amount: '100',
      currency: 'XTR',
      now: b.now + 2,
    });
    expect(other.result.duplicate).toBe(true);
    expect(other.state.subscriptions).toHaveLength(1);
    const fresh = quotePurchase(b.state, { kind: 'new', accountId: b.accountId, now: b.now, method: 'stars' });
    const short = applyPayment(fresh.state, {
      operationId: 'stars:short',
      label: fresh.result.label,
      amount: '99',
      currency: 'XTR',
      now: b.now,
    });
    expect(short.result.error).toBe('amount');
    expect(short.state.subscriptions).toHaveLength(0);
    const report = financeReport(paid.state, b.now + DAY);
    expect(report.summary.month.byMethod.stars.stars).toBe(100);
    expect(report.summary.month.byMethod.stars.rub).toBe(150);
    expect(report.summary.month.sum).toBe(150);
  });

  it('refuses a crypto underpayment and a second invoice for the same order', () => {
    const b = boot();
    const quoted = quotePurchase(b.state, { kind: 'new', accountId: b.accountId, now: b.now, method: 'crypto', asset: 'USDT' });
    expect(quoted.result.payAmount).toBe('2.00');
    const order = quoted.state;
    const row = order.purchases.find((p: { id: string }) => p.id === quoted.result.id);
    row.invoiceId = '77';
    const short = applyPayment(order, {
      operationId: 'crypto:77',
      label: quoted.result.label,
      amount: '1.99',
      currency: 'USDT',
      now: b.now,
    });
    expect(short.result.error).toBe('amount');
    expect(short.state.subscriptions).toHaveLength(0);
    const ok = applyPayment(order, {
      operationId: 'crypto:77',
      label: quoted.result.label,
      amount: '2.00',
      currency: 'USDT',
      now: b.now,
    });
    expect(ok.result.kind).toBe('new');
    const extra = applyPayment(ok.state, {
      operationId: 'crypto:88',
      label: quoted.result.label,
      amount: '2.00',
      currency: 'USDT',
      now: b.now + 1,
    });
    expect(extra.result.error === 'bad_label' || extra.result.duplicate).toBe(true);
    expect(extra.state.subscriptions).toHaveLength(1);
    expect(extra.state.subscriptions[0].paidUntil).toBe(ok.state.subscriptions[0].paidUntil);
  });

  it('scales crypto by the ruble credit and refuses a second order that spends the same credit', () => {
    const b = boot();
    b.state.settings.cryptoUsdt = 2;
    const opened = applyPayment(b.state, {
      operationId: 'ym-new',
      label: 'new:' + b.accountId,
      amount: '150.00',
      currency: '643',
      now: b.now,
    });
    expect(opened.result.kind).toBe('new');
    opened.state.subscriptions[0].creditRub = 50;
    const subId = opened.state.subscriptions[0].id;
    const stars = quotePurchase(opened.state, {
      kind: 'sub',
      accountId: b.accountId,
      subscriptionId: subId,
      now: b.now + 1,
      method: 'stars',
    });
    expect(stars.result.payAmount).toBe('66');
    const crypto = quotePurchase(stars.state, {
      kind: 'sub',
      accountId: b.accountId,
      subscriptionId: subId,
      now: b.now + 1,
      method: 'crypto',
      asset: 'USDT',
    });
    expect(crypto.result.payAmount).toBe('1.33');
    const paid = applyPayment(crypto.state, {
      operationId: 'stars:credit',
      label: stars.result.label,
      amount: '66',
      currency: 'XTR',
      now: b.now + 2,
    });
    expect(paid.result.kind).toBe('renew');
    expect(paid.state.subscriptions[0].creditRub).toBe(0);
    const until = paid.state.subscriptions[0].paidUntil;
    const second = applyPayment(paid.state, {
      operationId: 'crypto:credit',
      label: crypto.result.label,
      amount: '1.33',
      currency: 'USDT',
      now: b.now + 3,
    });
    expect(second.result.error).toBe('amount');
    expect(second.state.subscriptions[0].paidUntil).toBe(until);
  });

  it('pre_checkout does not extend the subscription', () => {
    const b = boot();
    const quoted = quotePurchase(b.state, { kind: 'new', accountId: b.accountId, now: b.now, method: 'stars' });
    const before = quoted.state.subscriptions.length;
    const decision = starCheckoutDecision(quoted.state, {
      id: 'q1',
      currency: 'XTR',
      total_amount: 100,
      invoice_payload: quoted.result.label,
      from: { id: 42 },
    });
    expect(decision.ok).toBe(true);
    expect(quoted.state.subscriptions).toHaveLength(before);
    expect(
      starCheckoutDecision(quoted.state, {
        currency: 'XTR',
        total_amount: 99,
        invoice_payload: quoted.result.label,
        from: { id: 42 },
      }).ok,
    ).toBe(false);
  });
});

describe('crypto pay webhook', () => {
  async function boot() {
    const now = Date.now();
    const opened = openAccount(emptyState(), { telegramId: '42', email: '', now });
    const state = opened.state;
    state.settings.priceRub = 150;
    state.settings.periodDays = 30;
    state.settings.cryptoEnabled = true;
    state.settings.cryptoUsdt = 2;
    state.settings.cryptoPayToken = TOKEN;
    state.settings.botToken = '123456:fake';
    const quoted = quotePurchase(state, { kind: 'new', accountId: opened.account.id, now, method: 'crypto', asset: 'USDT' });
    const row = quoted.state.purchases.find((p: { id: string }) => p.id === quoted.result.id);
    row.invoiceId = '55';
    const store = await testStore();
    await writeState(store, quoted.state);
    const app = createApp(store, async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }), text: async () => '' }));
    return { app, store, label: quoted.result.label as string };
  }

  function notice(amount: string, invoiceId = 55) {
    return {
      update_id: 1,
      update_type: 'invoice_paid',
      payload: {
        invoice_id: invoiceId,
        status: 'paid',
        asset: 'USDT',
        amount: '2.00',
        paid_amount: amount,
        paid_asset: 'USDT',
        payload: '',
      },
    };
  }

  it('rejects a bad signature, accepts one payment, and does not extend twice or on a short payment', async () => {
    const b = await boot();
    const bad = signedBody({ update_type: 'invoice_paid' });
    const rejected = await call(b.app, 'POST', '/v1/crypto-pay', {
      body: bad.raw + 'x',
      headers: { 'crypto-pay-api-signature': bad.sign },
    });
    expect(rejected.status).toBe(400);
    expect((await readState(b.store)).subscriptions).toHaveLength(0);

    const short = notice('1.00');
    short.payload.payload = b.label;
    const shortSigned = signedBody(short);
    const under = await call(b.app, 'POST', '/v1/crypto-pay', {
      body: shortSigned.raw,
      headers: { 'crypto-pay-api-signature': shortSigned.sign },
    });
    expect(under.status).toBe(200);
    expect((await readState(b.store)).subscriptions).toHaveLength(0);

    const ok = notice('2.00');
    ok.payload.payload = b.label;
    const okSigned = signedBody(ok);
    const first = await call(b.app, 'POST', '/v1/crypto-pay', {
      body: okSigned.raw,
      headers: { 'crypto-pay-api-signature': okSigned.sign },
    });
    expect(first.status).toBe(200);
    const after = await readState(b.store);
    expect(after.subscriptions).toHaveLength(1);
    const until = after.subscriptions[0].paidUntil;
    const second = await call(b.app, 'POST', '/v1/crypto-pay', {
      body: okSigned.raw,
      headers: { 'crypto-pay-api-signature': okSigned.sign },
    });
    expect(second.status).toBe(200);
    const replayed = await readState(b.store);
    expect(replayed.subscriptions).toHaveLength(1);
    expect(replayed.subscriptions[0].paidUntil).toBe(until);
    expect(paidInvoice({ update_type: 'invoice_paid', payload: { status: 'active', invoice_id: 1 } })).toBeNull();
  });
});

describe('stars poll durability', () => {
  function starUpdate(id: number) {
    return {
      update_id: id,
      message: {
        chat: { id: 42, type: 'private' },
        successful_payment: {
          currency: 'XTR',
          total_amount: 100,
          invoice_payload: 'buy:abc',
          telegram_payment_charge_id: 'charge-1',
        },
      },
    };
  }

  function tg(result: unknown) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result }),
      text: async () => '',
    };
  }

  it('retries the same update when the payment write fails, and does not apply it during cutover', async () => {
    const state = emptyState();
    state.settings.botToken = '123456:poll';
    const offsets: number[] = [];
    let polls = 0;
    const fetchImpl = async (url: string) => {
      if (String(url).indexOf('/getUpdates') < 0) return tg({});
      const offset = Number(new URL(url).searchParams.get('offset') || 0);
      offsets.push(offset);
      polls += 1;
      return tg(polls === 1 ? [starUpdate(7)] : []);
    };
    const store = {
      read: async () => state,
      update: async () => {
        throw new Error('db down');
      },
      registry: {},
    };
    await pollBot(store, fetchImpl, { maxLoops: 3, sleep: async () => {}, now: () => Date.now() });
    expect(offsets[0]).toBe(0);
    expect(offsets[1]).toBe(7);

    const cutoverOffsets: number[] = [];
    let cutoverPolls = 0;
    let writes = 0;
    const cutoverFetch = async (url: string) => {
      if (String(url).indexOf('/getUpdates') < 0) return tg({});
      cutoverOffsets.push(Number(new URL(url).searchParams.get('offset') || 0));
      cutoverPolls += 1;
      return tg(cutoverPolls === 1 ? [starUpdate(9)] : []);
    };
    const cutoverStore = {
      read: async () => state,
      update: async () => {
        writes += 1;
        return {};
      },
      registry: {},
    };
    await pollBot(cutoverStore, cutoverFetch, {
      maxLoops: 3,
      adminLoginOnly: true,
      sleep: async () => {},
      now: () => Date.now(),
    });
    expect(writes).toBe(0);
    expect(cutoverOffsets[0]).toBe(0);
    expect(cutoverOffsets[1]).toBe(9);
  });
});

describe('bot stars invoice', () => {
  it('offers stars only when the switch is on, and the invoice has no provider token', () => {
    const now = 1;
    const opened = openAccount(emptyState(), { telegramId: '42', email: '', now });
    opened.state.settings.priceRub = 150;
    opened.state.settings.starsPrice = 100;
    opened.state.settings.starsEnabled = false;
    opened.state.settings.yoomoneyWallet = '4100';
    const off = botReply(opened.state, { chatId: '42', text: 'Оплатить', now });
    expect(JSON.stringify(off.messages)).not.toContain('st:');
    off.state.settings.starsEnabled = true;
    const on = botReply(off.state, { chatId: '42', text: 'Оплатить', now });
    const packed = JSON.stringify(on.messages);
    expect(packed).toContain('Звёзды - 100');
    const id = packed.match(/st:([a-f0-9]+)/);
    expect(id).toBeTruthy();
    const tapped = botCallback(on.state, { chatId: '42', data: 'st:' + id![1], now });
    const invoice = tapped.messages[0].invoice;
    expect(invoice.currency).toBe('XTR');
    expect(invoice.provider_token).toBe('');
    expect(invoice.payload).toBe('buy:' + id![1]);
  });
});

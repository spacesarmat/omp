import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { botCallback, botReply } from '../src/bot.mjs';
import { amountCovers, cryptoPayAuthentic, cryptoPayHost, cryptoPaySign, formatAsset, paidInvoice } from '../src/cryptoPay.mjs';
import { applyPayment, financeReport, openAccount, quotePurchase } from '../src/logic.mjs';
import { cryptoOffered, starCheckoutDecision, starDue, starInvoiceBody } from '../src/payMethods.mjs';
import { createApp, handleCallback, pollBot } from '../src/server.mjs';
import { mergeSettings, publicAdminSettings } from '../src/services.mjs';
import { emptyState } from '../src/state.mjs';
import { readState, testStore, writeState } from './pg';

const DAY = 24 * 60 * 60 * 1000;
const TOKEN = 'crypto-pay-test-token';
const TESTNET_TOKEN = 'crypto-pay-testnet-TTTT';

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

  it('credits the ruble value when a crypto device is paid after the subscription ended', () => {
    const b = boot();
    b.state.settings.extraDeviceRub = 0;
    b.state.settings.cryptoExtraUsdt = 2;
    b.state.settings.cryptoRateUsdt = 90;
    const opened = applyPayment(b.state, {
      operationId: 'ym-new',
      label: 'new:' + b.accountId,
      amount: '150.00',
      currency: '643',
      now: b.now - 40 * DAY,
    });
    const subId = opened.state.subscriptions[0].id;
    const quoted = quotePurchase(opened.state, {
      kind: 'dev',
      accountId: b.accountId,
      subscriptionId: subId,
      now: b.now,
      method: 'crypto',
      asset: 'USDT',
    });
    expect(quoted.result.payAmount).toBe('2.00');
    expect(quoted.result.rub).toBe(180);
    const paid = applyPayment(quoted.state, {
      operationId: 'crypto:late-dev',
      label: quoted.result.label,
      amount: '2.00',
      currency: 'USDT',
      now: b.now,
    });
    expect(paid.result.kind).toBe('credit');
    expect(paid.result.credit).toBe(180);
    expect(paid.state.subscriptions[0].extraSlots || 0).toBe(0);
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

  async function capture(run: () => Promise<void>) {
    const lines: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      await run();
    } finally {
      process.stderr.write = write;
    }
    return lines.join('');
  }

  function paidNotice(amount: string, label: string, invoiceId = 55) {
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
        payload: label,
      },
    };
  }

  it('ignores a testnet signature while live mode is on, and still extends on the live signature', async () => {
    const b = await boot();
    const state = await readState(b.store);
    state.settings.cryptoPayTestnetToken = TESTNET_TOKEN;
    state.settings.cryptoTestnet = false;
    await writeState(b.store, state);
    const foreign = signedBody(paidNotice('2.00', b.label), TESTNET_TOKEN);
    let status = 0;
    const log = await capture(async () => {
      const ignored = await call(b.app, 'POST', '/v1/crypto-pay', {
        body: foreign.raw,
        headers: { 'crypto-pay-api-signature': foreign.sign },
      });
      status = ignored.status;
      expect(ignored.body).toBe('ok');
      expect(ignored.body).not.toContain(TESTNET_TOKEN);
      expect(ignored.body).not.toContain(TOKEN);
    });
    expect(status).toBe(200);
    expect(log).not.toContain(TESTNET_TOKEN);
    expect(log).not.toContain(TOKEN);
    const held = await readState(b.store);
    expect(held.subscriptions).toHaveLength(0);
    expect(held.webhooks.some((w: { kind?: string }) => w.kind === 'ignored')).toBe(true);
    expect(JSON.stringify(financeReport(held, Date.now()))).not.toContain(TESTNET_TOKEN);
    const live = signedBody(paidNotice('2.00', b.label), TOKEN);
    const accepted = await call(b.app, 'POST', '/v1/crypto-pay', {
      body: live.raw,
      headers: { 'crypto-pay-api-signature': live.sign },
    });
    expect(accepted.status).toBe(200);
    expect((await readState(b.store)).subscriptions).toHaveLength(1);
  });

  it('extends on the testnet signature only while testnet is on', async () => {
    const b = await boot();
    const state = await readState(b.store);
    state.settings.cryptoPayTestnetToken = TESTNET_TOKEN;
    state.settings.cryptoTestnet = true;
    await writeState(b.store, state);
    const live = signedBody(paidNotice('2.00', b.label), TOKEN);
    const ignored = await call(b.app, 'POST', '/v1/crypto-pay', {
      body: live.raw,
      headers: { 'crypto-pay-api-signature': live.sign },
    });
    expect(ignored.status).toBe(200);
    expect((await readState(b.store)).subscriptions).toHaveLength(0);
    const testnet = signedBody(paidNotice('2.00', b.label), TESTNET_TOKEN);
    const accepted = await call(b.app, 'POST', '/v1/crypto-pay', {
      body: testnet.raw,
      headers: { 'crypto-pay-api-signature': testnet.sign },
    });
    expect(accepted.status).toBe(200);
    const after = await readState(b.store);
    expect(after.subscriptions).toHaveLength(1);
    expect(after.webhooks.some((w: { kind?: string }) => w.kind === 'ignored')).toBe(true);
    const report = JSON.stringify(financeReport(after, Date.now()));
    expect(report).not.toContain(TESTNET_TOKEN);
    expect(report).not.toContain(TOKEN);
    expect(JSON.stringify(after.webhooks)).not.toContain(TESTNET_TOKEN);
    expect(JSON.stringify(after.webhooks)).not.toContain(TOKEN);
  });
});

describe('crypto pay invoice host', () => {
  const BOT = '123456:invoice-bot';

  async function quoted(settings: Record<string, unknown>) {
    const now = Date.now();
    const opened = openAccount(emptyState(), { telegramId: '42', email: '', now });
    const state = opened.state;
    Object.assign(state.settings, {
      priceRub: 150,
      periodDays: 30,
      cryptoEnabled: true,
      cryptoUsdt: 2,
      botToken: BOT,
      ...settings,
    });
    const quote = quotePurchase(state, { kind: 'new', accountId: opened.account.id, now, method: 'crypto', asset: 'USDT' });
    const store = await testStore();
    await writeState(store, quote.state);
    return { store, id: quote.result.id as string };
  }

  function net() {
    const calls: { url: string; token: string; body: string }[] = [];
    const fetchImpl = async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
      calls.push({
        url: String(url),
        token: init && init.headers ? String(init.headers['Crypto-Pay-API-Token'] || '') : '',
        body: init && init.body ? String(init.body) : '',
      });
      if (String(url).indexOf('/api/createInvoice') >= 0) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            result: {
              invoice_id: 9,
              bot_invoice_url: 'https://t.me/CryptoBot?start=inv9',
              pay_url: 'https://t.me/CryptoBot?start=inv9',
              asset: 'USDT',
              amount: '2.00',
            },
          }),
          text: async () => '',
        };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }), text: async () => '' };
    };
    return { calls, fetchImpl };
  }

  function press(id: string) {
    return {
      id: 'cb-' + id,
      data: 'cr:USDT:' + id,
      from: { id: 42 },
      message: { message_id: 70, chat: { id: 42, type: 'private' } },
    };
  }

  it('creates the invoice on the testnet host with the testnet token', async () => {
    const b = await quoted({ cryptoTestnet: true, cryptoPayToken: TOKEN, cryptoPayTestnetToken: TESTNET_TOKEN });
    const http = net();
    await handleCallback(b.store, BOT, press(b.id), http.fetchImpl, 5000);
    const invoice = http.calls.find((c) => c.url.indexOf('/api/createInvoice') >= 0);
    expect(invoice && invoice.url).toBe('https://testnet-pay.crypt.bot/api/createInvoice');
    expect(invoice && invoice.token).toBe(TESTNET_TOKEN);
    expect(JSON.stringify(http.calls)).not.toContain(TOKEN);
  });

  it('creates the invoice on the live host with the live token', async () => {
    const b = await quoted({ cryptoTestnet: false, cryptoPayToken: TOKEN, cryptoPayTestnetToken: TESTNET_TOKEN });
    const http = net();
    await handleCallback(b.store, BOT, press(b.id), http.fetchImpl, 5000);
    const invoice = http.calls.find((c) => c.url.indexOf('/api/createInvoice') >= 0);
    expect(invoice && invoice.url).toBe('https://pay.crypt.bot/api/createInvoice');
    expect(invoice && invoice.token).toBe(TOKEN);
    expect(JSON.stringify(http.calls)).not.toContain(TESTNET_TOKEN);
  });

  it('returns disabled and does not call Crypto Pay when testnet is on without a testnet token', async () => {
    const b = await quoted({ cryptoTestnet: true, cryptoPayToken: TOKEN, cryptoPayTestnetToken: '' });
    const http = net();
    const logs: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      logs.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      await handleCallback(b.store, BOT, press(b.id), http.fetchImpl, 5000);
    } finally {
      process.stderr.write = write;
    }
    expect(http.calls.some((c) => c.url.indexOf('crypt.bot') >= 0)).toBe(false);
    expect(JSON.stringify(http.calls)).not.toContain(TOKEN);
    expect(logs.join('')).not.toContain(TOKEN);
    const sent = http.calls.find((c) => c.url.indexOf('/sendMessage') >= 0);
    expect(sent && sent.body).toContain('Не удалось создать счёт');
  });

  it('issues a new testnet invoice instead of reusing a live link, and reuses that testnet link', async () => {
    const b = await quoted({ cryptoTestnet: false, cryptoPayToken: TOKEN, cryptoPayTestnetToken: TESTNET_TOKEN });
    const calls: { url: string; token: string; body: string }[] = [];
    const fetchImpl = async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
      calls.push({
        url: String(url),
        token: init && init.headers ? String(init.headers['Crypto-Pay-API-Token'] || '') : '',
        body: init && init.body ? String(init.body) : '',
      });
      if (String(url).indexOf('/api/createInvoice') >= 0) {
        const n = calls.filter((c) => c.url.indexOf('/api/createInvoice') >= 0).length;
        const host = String(url).indexOf('testnet-pay.crypt.bot') >= 0 ? 'testnet-pay.crypt.bot' : 'pay.crypt.bot';
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            result: {
              invoice_id: n,
              bot_invoice_url: 'https://' + host + '/i/' + n,
              pay_url: 'https://' + host + '/i/' + n,
              asset: 'USDT',
              amount: '2.00',
            },
          }),
          text: async () => '',
        };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }), text: async () => '' };
    };
    await handleCallback(b.store, BOT, press(b.id), fetchImpl, 5000);
    const state = await readState(b.store);
    state.settings.cryptoTestnet = true;
    await writeState(b.store, state);
    await handleCallback(b.store, BOT, press(b.id), fetchImpl, 5000);
    const invoices = calls.filter((c) => c.url.indexOf('/api/createInvoice') >= 0);
    expect(invoices.map((c) => c.url + ' ' + c.token)).toEqual([
      'https://pay.crypt.bot/api/createInvoice ' + TOKEN,
      'https://testnet-pay.crypt.bot/api/createInvoice ' + TESTNET_TOKEN,
    ]);
    const sent = calls.filter((c) => c.url.indexOf('/sendMessage') >= 0);
    expect(JSON.stringify(sent)).toContain('https://testnet-pay.crypt.bot/i/2');
    expect(JSON.stringify(sent[sent.length - 1])).not.toContain('https://pay.crypt.bot/i/1');
    await handleCallback(b.store, BOT, press(b.id), fetchImpl, 5000);
    expect(calls.filter((c) => c.url.indexOf('/api/createInvoice') >= 0)).toHaveLength(2);
    const back = await readState(b.store);
    back.settings.cryptoTestnet = false;
    await writeState(b.store, back);
    await handleCallback(b.store, BOT, press(b.id), fetchImpl, 5000);
    expect(calls.filter((c) => c.url.indexOf('/api/createInvoice') >= 0)).toHaveLength(2);
    const again = calls.filter((c) => c.url.indexOf('/sendMessage') >= 0);
    expect(JSON.stringify(again[again.length - 1])).toContain('https://pay.crypt.bot/i/1');
  });

  it('does not hand out a saved live link when testnet is on and the testnet token is missing', async () => {
    const b = await quoted({ cryptoTestnet: false, cryptoPayToken: TOKEN, cryptoPayTestnetToken: '' });
    const row = (await readState(b.store)).purchases.find((p: { id: string }) => p.id === b.id);
    row.payUrl = 'https://pay.crypt.bot/i/live';
    row.webUrl = 'https://pay.crypt.bot/i/live';
    row.invoiceId = 'live';
    const state = await readState(b.store);
    state.purchases = state.purchases.map((p: { id: string }) => (p.id === b.id ? row : p));
    state.settings.cryptoTestnet = true;
    await writeState(b.store, state);
    const http = net();
    await handleCallback(b.store, BOT, press(b.id), http.fetchImpl, 5000);
    expect(http.calls.some((c) => c.url.indexOf('crypt.bot') >= 0)).toBe(false);
    expect(JSON.stringify(http.calls)).not.toContain('https://pay.crypt.bot/i/live');
    expect(JSON.stringify(http.calls)).not.toContain(TOKEN);
    const sent = http.calls.find((c) => c.url.indexOf('/sendMessage') >= 0);
    expect(sent && sent.body).toContain('Не удалось создать счёт');
  });

  it('keeps a pre-mode live invoice payable after a later testnet link', async () => {
    const b = await quoted({ cryptoTestnet: false, cryptoPayToken: TOKEN, cryptoPayTestnetToken: TESTNET_TOKEN });
    const state = await readState(b.store);
    const row = state.purchases.find((p: { id: string }) => p.id === b.id);
    row.invoiceId = 'A';
    row.payUrl = 'https://pay.crypt.bot/i/A';
    row.webUrl = 'https://pay.crypt.bot/i/A';
    delete row.cryptoTestnet;
    delete row.cryptoLinks;
    await writeState(b.store, state);
    const http = net();
    await handleCallback(b.store, BOT, press(b.id), http.fetchImpl, 5000);
    expect(http.calls.some((c) => c.url.indexOf('/api/createInvoice') >= 0)).toBe(false);
    expect(JSON.stringify(http.calls)).toContain('https://pay.crypt.bot/i/A');
    const switched = await readState(b.store);
    switched.settings.cryptoTestnet = true;
    await writeState(b.store, switched);
    await handleCallback(b.store, BOT, press(b.id), http.fetchImpl, 5000);
    const back = await readState(b.store);
    back.settings.cryptoTestnet = false;
    const paid = applyPayment(back, {
      operationId: 'crypto:A',
      label: 'buy:' + b.id,
      amount: '2.00',
      currency: 'USDT',
      now: Date.now(),
    });
    expect(paid.result.error).toBeUndefined();
    expect(paid.state.subscriptions).toHaveLength(1);
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
    const sent: string[] = [];
    let writes = 0;
    const login = {
      update_id: 10,
      message: { chat: { id: 7, type: 'private' }, text: '/start admin_tok', from: { id: 7 } },
    };
    const cutoverFetch = async (url: string, init?: { body?: string }) => {
      if (String(url).indexOf('/getUpdates') < 0) {
        sent.push(String(url));
        return tg({ message_id: 1 });
      }
      const next = Number(new URL(url).searchParams.get('offset') || 0);
      cutoverOffsets.push(next);
      return tg(next === 0 || next === 9 ? [starUpdate(9), login] : []);
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
      adminAuthMem: { panelLogins: () => [], replacePanelLogins: () => {} },
      sleep: async () => {},
      now: () => Date.now(),
    });
    expect(writes).toBe(0);
    expect(cutoverOffsets[0]).toBe(0);
    expect(cutoverOffsets[1]).toBe(9);
    expect(sent.filter((u) => u.indexOf('/sendMessage') >= 0)).toHaveLength(1);
  });
});

describe('stars checkout is answered first', () => {
  it('answers pre_checkout before a preceding message is sent', async () => {
    const state = emptyState();
    state.settings.botToken = '123456:poll';
    const calls: string[] = [];
    let polls = 0;
    const fetchImpl = async (url: string) => {
      const path = String(url);
      if (path.indexOf('/getUpdates') >= 0) {
        polls += 1;
        const batch =
          polls === 1
            ? [
                { update_id: 1, message: { chat: { id: 5, type: 'private' }, text: 'Привет', from: { id: 5 } } },
                {
                  update_id: 2,
                  pre_checkout_query: {
                    id: 'pq-1',
                    from: { id: 5 },
                    currency: 'XTR',
                    total_amount: 1,
                    invoice_payload: 'buy:missing',
                  },
                },
              ]
            : [];
        return { ok: true, status: 200, json: async () => ({ ok: true, result: batch }), text: async () => '' };
      }
      calls.push(path);
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }), text: async () => '' };
    };
    const store = {
      read: async () => state,
      update: async (fn: (s: typeof state) => { state: typeof state; result?: unknown }) => {
        const out = fn(state);
        return out && out.result !== undefined ? out.result : out;
      },
      registry: {},
    };
    await pollBot(store, fetchImpl, { maxLoops: 2, sleep: async () => {}, now: () => Date.now() });
    const checkout = calls.findIndex((u) => u.indexOf('/answerPreCheckoutQuery') >= 0);
    const message = calls.findIndex((u) => u.indexOf('/sendMessage') >= 0);
    expect(checkout).toBeGreaterThanOrEqual(0);
    expect(message).toBeGreaterThanOrEqual(0);
    expect(checkout).toBeLessThan(message);
  });

  it('refuses a second checkout when that order is already paid in the same batch', async () => {
    const now = Date.now();
    const opened = openAccount(emptyState(), { telegramId: '42', email: '', now });
    opened.state.settings.priceRub = 150;
    opened.state.settings.starsEnabled = true;
    opened.state.settings.starsPrice = 100;
    opened.state.settings.botToken = '123456:poll';
    const quoted = quotePurchase(opened.state, { kind: 'new', accountId: opened.account.id, now, method: 'stars' });
    let state = quoted.state;
    const label = String(quoted.result.label);
    const answers: Array<{ ok?: boolean }> = [];
    let polls = 0;
    const fetchImpl = async (url: string, init?: { body?: string }) => {
      const path = String(url);
      if (path.indexOf('/getUpdates') >= 0) {
        polls += 1;
        const batch =
          polls === 1
            ? [
                {
                  update_id: 1,
                  message: {
                    chat: { id: 42, type: 'private' },
                    from: { id: 42 },
                    successful_payment: {
                      currency: 'XTR',
                      total_amount: 100,
                      invoice_payload: label,
                      telegram_payment_charge_id: 'charge-1',
                    },
                  },
                },
                {
                  update_id: 2,
                  pre_checkout_query: {
                    id: 'pq-2',
                    from: { id: 42 },
                    currency: 'XTR',
                    total_amount: 100,
                    invoice_payload: label,
                  },
                },
              ]
            : [];
        return { ok: true, status: 200, json: async () => ({ ok: true, result: batch }), text: async () => '' };
      }
      if (path.indexOf('/answerPreCheckoutQuery') >= 0 && init && init.body) answers.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }), text: async () => '' };
    };
    const store = {
      read: async () => state,
      update: async (fn: (s: typeof state) => { state: typeof state }) => {
        const out = fn(state);
        if (out && out.state) state = out.state;
        return out;
      },
      registry: {},
    };
    await pollBot(store, fetchImpl, { maxLoops: 2, sleep: async () => {}, now: () => now });
    expect(answers).toEqual([expect.objectContaining({ ok: false, pre_checkout_query_id: 'pq-2' })]);
    expect(state.subscriptions).toHaveLength(1);
    expect(state.subscriptions[0].paidUntil).toBeGreaterThan(now);
  });

  it('approves only the first checkout for one order in a batch', async () => {
    const now = Date.now();
    const opened = openAccount(emptyState(), { telegramId: '42', email: '', now });
    opened.state.settings.priceRub = 150;
    opened.state.settings.starsEnabled = true;
    opened.state.settings.starsPrice = 100;
    opened.state.settings.botToken = '123456:poll';
    const quoted = quotePurchase(opened.state, { kind: 'new', accountId: opened.account.id, now, method: 'stars' });
    const state = quoted.state;
    const label = String(quoted.result.label);
    const answers: Array<{ ok?: boolean; pre_checkout_query_id?: string }> = [];
    let polls = 0;
    const fetchImpl = async (url: string, init?: { body?: string }) => {
      const path = String(url);
      if (path.indexOf('/getUpdates') >= 0) {
        polls += 1;
        const checkout = (id: string, updateId: number) => ({
          update_id: updateId,
          pre_checkout_query: { id, from: { id: 42 }, currency: 'XTR', total_amount: 100, invoice_payload: label },
        });
        const batch = polls === 1 ? [checkout('pq-a', 1), checkout('pq-b', 2)] : [];
        return { ok: true, status: 200, json: async () => ({ ok: true, result: batch }), text: async () => '' };
      }
      if (path.indexOf('/answerPreCheckoutQuery') >= 0 && init && init.body) answers.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }), text: async () => '' };
    };
    await pollBot(
      { read: async () => state, update: async (fn: (s: typeof state) => unknown) => fn(state), registry: {} },
      fetchImpl,
      { maxLoops: 1, sleep: async () => {}, now: () => now },
    );
    expect(answers.map((a) => ({ id: a.pre_checkout_query_id, ok: a.ok }))).toEqual([
      { id: 'pq-a', ok: true },
      { id: 'pq-b', ok: false },
    ]);
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

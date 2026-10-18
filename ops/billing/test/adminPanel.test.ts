import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homePayload, userPayload } from '../src/adminApi.mjs';
import { matchesSubscriptionFilter, nextSupportSelection, reminderTargets } from '../admin/src/lib/subs.ts';
import { adminNotifyEnabled, paymentAdminNotices, serviceDownNotices, botReply } from '../src/bot.mjs';
import {
  accountCard,
  activate,
  createPromos,
  createSubscription,
  dailySeries,
  financeReport,
  issueActivation,
  issueCliAdminLogin,
  issueMany,
  openAccount,
  pagePayments,
} from '../src/logic.mjs';
import { createApp } from '../src/server.mjs';
import { maskWallet, mergeSettings, publicAdminSettings, SECRET_MASK } from '../src/services.mjs';
import { emptyState, readState, updateState, writeState } from '../src/store.mjs';
import { notificationHash } from '../src/yoomoney.mjs';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function seeded() {
  const opened = openAccount(emptyState(), { telegramId: '42', email: 'a@b.c', now: NOW });
  const created = createSubscription(opened.state, { accountId: opened.account.id, now: NOW, days: 30 });
  return { state: created.state, account: opened.account, code: created.result.code, until: created.result.paidUntil };
}

describe('admin payload hides codes', () => {
  it('omits plaintext from the home list and the user card', () => {
    const start = seeded();
    start.state.subscriptions[0].paidUntil = Date.now() + 30 * DAY;
    const home = homePayload(start.state, '/tmp/billing.db', {});
    const blob = JSON.stringify(home);
    expect(blob).not.toContain(start.code);
    expect(blob).not.toContain(start.code.replace(/-/g, ''));
    expect(blob).not.toContain('"plain"');
    const sub = home.subscriptions[0];
    expect(sub.status).toBe('unbound');
    expect(sub.paidUntil).toBeGreaterThan(Date.now());
    const soon = { ...sub, status: 'soon', active: true, bound: 0, paidUntil: Date.now() + 3 * DAY };
    expect(matchesSubscriptionFilter(soon, 'unbound')).toBe(true);
    expect(matchesSubscriptionFilter(soon, 'week')).toBe(true);
    expect(matchesSubscriptionFilter({ ...soon, bound: 2 }, 'unbound')).toBe(false);
    expect(matchesSubscriptionFilter({ ...soon, active: false, status: 'expired', bound: 0 }, 'unbound')).toBe(false);
    const user = userPayload(start.state, start.account.id, {});
    expect(user.codes[0].hasPlain).toBe(true);
    expect(user.codes[0].plain).toBeUndefined();
    expect(JSON.stringify(user)).not.toContain(start.code.replace(/-/g, ''));
  });

  it('keeps the real subscription expiry when another code is issued', () => {
    const start = seeded();
    // The first code is on a phone, so the second device slot gets a new code.
    start.state = activate(start.state, { code: start.code, deviceId: 'a'.repeat(32), now: NOW }).state;
    const again = issueActivation(start.state, {
      accountId: start.account.id,
      days: 1,
      now: NOW + DAY,
    });
    expect(again.result.created).toBe(false);
    expect(again.result.paidUntil).toBe(start.until);
    const card = accountCard(again.state, start.account.id, NOW + DAY);
    expect(card.sub.paidUntil).toBe(start.until);
    expect(card.codes.length).toBe(2);
    const user = userPayload(again.state, start.account.id, {});
    expect(user.subscription.paidUntil).toBe(start.until);
  });

  it('shows the longer subscription when a short one was created later', () => {
    const start = seeded();
    const extra = createSubscription(start.state, { accountId: start.account.id, now: NOW + DAY, days: 1 });
    const card = accountCard(extra.state, start.account.id, NOW + DAY);
    expect(card.sub.paidUntil).toBe(start.until);
  });
});

describe('finance and lists', () => {
  it('does not render empty problem fields as dot separators', () => {
    const state = emptyState();
    state.webhooks = [{ kind: 'bad_signature', at: NOW, amount: '', label: '', operationId: '' }];
    state.payments = [{ operationId: 'op1', label: '', amount: '', at: NOW, error: 'amount' }];
    const fin = financeReport(state, NOW);
    for (const row of fin.problems) {
      expect(row.text).not.toContain('·  ·');
      expect(row.text).not.toBe(' · ');
    }
    const empty = fin.problems.find((p) => p.kind === 'bad_signature');
    expect(empty.text).toBe('');
    expect(empty.operationId).toBe('');
  });

  it('builds a daily series and pages payments', () => {
    const start = seeded();
    start.state.payments = [
      { operationId: 'a', label: 'new:' + start.account.id, amount: '100', at: NOW, error: '' },
      { operationId: 'b', label: 'new:' + start.account.id, amount: '50', at: NOW + DAY, error: '' },
    ];
    const series = dailySeries(start.state, NOW + DAY, 30);
    expect(series).toHaveLength(30);
    expect(series.some((row) => row.revenue === 100)).toBe(true);
    expect(series.some((row) => row.revenue === 50)).toBe(true);
    const page = pagePayments(start.state, { q: '42', offset: 0, limit: 1 });
    expect(page.total).toBe(2);
    expect(page.payments).toHaveLength(1);
  });
});

describe('support selection', () => {
  it('pins the first thread and falls back when that thread closes', () => {
    expect(nextSupportSelection('', ['a', 'b'], '')).toBe('a');
    expect(nextSupportSelection('a', ['b', 'a'], '')).toBe('a');
    expect(nextSupportSelection('a', ['b'], '')).toBe('b');
    expect(nextSupportSelection('a', [], '')).toBe('');
    expect(nextSupportSelection('card', ['b'], 'card')).toBe('card');
  });
});

describe('reminders', () => {
  it('sends one reminder per account using the latest expiry', () => {
    const rows = [
      { accountId: 'a', telegramId: '1', status: 'soon', paidUntil: 5, paidUntilText: 'short' },
      { accountId: 'a', telegramId: '1', status: 'active', paidUntil: 50, paidUntilText: 'long' },
      { accountId: 'b', telegramId: '2', status: 'expiring', paidUntil: 3, paidUntilText: 'old' },
      { accountId: 'b', telegramId: '2', status: 'soon', paidUntil: 8, paidUntilText: 'latest' },
      { accountId: 'c', telegramId: '', status: 'soon', paidUntil: 9, paidUntilText: 'no-tg' },
    ];
    const out = reminderTargets(rows);
    expect(out.map((row) => row.accountId)).toEqual(['b']);
    expect(out[0].paidUntilText).toBe('latest');
  });
});

describe('bulk codes and promos', () => {
  it('issues several codes and several promos', () => {
    const codes = issueMany(emptyState(), { count: 3, days: 7, now: NOW });
    expect(codes.result.codes).toHaveLength(3);
    expect(new Set(codes.result.codes.map((c) => c.accountId)).size).toBe(3);
    expect(codes.result.codes[0].paidUntil).toBe(NOW + 7 * DAY);
    const promos = createPromos(emptyState(), { count: 2, days: 3, maxUses: 4, now: NOW });
    expect(promos.result.promos).toHaveLength(2);
    expect(promos.result.promos[0].code).not.toBe(promos.result.promos[1].code);
  });
});

describe('admin telegram notices', () => {
  it('masks the wallet and keeps it when the form posts the mask', () => {
    const cur = emptyState().settings;
    cur.yoomoneyWallet = '410011234567890';
    expect(maskWallet(cur.yoomoneyWallet)).toBe(SECRET_MASK + '7890');
    expect(publicAdminSettings(cur).yoomoneyWallet).toBe(SECRET_MASK + '7890');
    const next = mergeSettings(cur, { yoomoneyWallet: maskWallet(cur.yoomoneyWallet), adminNotify: 'false' });
    expect(next.yoomoneyWallet).toBe('410011234567890');
    expect(next.adminNotify).toBe(false);
    expect(adminNotifyEnabled(next)).toBe(false);
  });

  it('notifies on payment and service down only when enabled, and skips support when off', () => {
    const settings = emptyState().settings;
    settings.adminTelegramIds = '99';
    const pay = paymentAdminNotices(settings, { ok: true, amount: '100', label: 'buy:1', who: '42' });
    expect(pay).toHaveLength(1);
    expect(pay[0].text).toContain('Новая оплата');
    settings.adminNotify = false;
    expect(paymentAdminNotices(settings, { ok: false, error: 'amount', amount: '1' })).toHaveLength(0);
    settings.adminNotify = true;
    const down = serviceDownNotices(settings, { jackett: { configured: true, ok: false, error: 'down' } }, {});
    expect(down.messages).toHaveLength(1);
    expect(down.messages[0].text).toContain('Jackett');
    const again = serviceDownNotices(settings, { jackett: { configured: true, ok: false, error: 'down' } }, down.snapshot);
    expect(again.messages).toHaveLength(0);
    const state = emptyState();
    state.settings.adminTelegramIds = '99';
    state.settings.adminNotify = false;
    const asked = botReply(state, { chatId: '7', text: '/start support', now: NOW });
    const sent = botReply(asked.state, { chatId: '7', text: 'привет', now: NOW + 1, awaiting: { kind: 'support' } });
    expect(sent.state.supportMessages).toHaveLength(1);
    expect(sent.messages.some((m) => m.supportNotify)).toBe(false);
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
  opts: { cookie?: string; body?: unknown; form?: Record<string, string> } = {},
) {
  const payload = opts.form ? new URLSearchParams(opts.form).toString() : opts.body === undefined ? '' : JSON.stringify(opts.body);
  const req = {
    method,
    url: path,
    headers: {
      cookie: opts.cookie || '',
      accept: opts.form ? '' : 'application/json',
      'content-type': opts.form ? 'application/x-www-form-urlencoded' : opts.body === undefined ? '' : 'application/json',
    },
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

describe('admin http', () => {
  it('reveals one code, issues for N days, and still notifies on extend', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omp-admin-'));
    const file = join(dir, 'billing.db');
    const start = seeded();
    start.state.settings.botToken = 'token';
    start.state.settings.adminNotify = true;
    writeState(file, start.state);
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 3 } }),
        text: async () => '',
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    };
    const app = createApp(file, fetchImpl);
    const denied = await call(app, 'POST', '/admin/login', { body: { password: 'secret1' } });
    expect(denied.status).toBe(403);
    expect(denied.body).not.toContain('secret1');
    expect(JSON.stringify(readState(file))).not.toContain('secret1');
    const link = await updateState(file, (s) => issueCliAdminLogin(s, { now: Date.now() }));
    expect(JSON.stringify(readState(file))).not.toContain(link.token);
    const once = await call(app, 'GET', '/admin/login/once?token=' + encodeURIComponent(link.token));
    expect(once.status).toBe(302);
    const cookie = String(once.headers['set-cookie'] || '');
    expect(cookie).toContain('omp_admin=');
    const reuse = await call(app, 'GET', '/admin/login/once?token=' + encodeURIComponent(link.token));
    expect(reuse.status).toBe(403);
    const home = await call(app, 'GET', '/admin/api/home', { cookie });
    expect(JSON.stringify(home.data)).not.toContain('"plain"');
    const user = await call(app, 'GET', '/admin/api/user?id=' + encodeURIComponent(start.account.id), { cookie });
    const codes = ((user.data && user.data.codes) || []) as { id: string; hasPlain?: boolean; plain?: string }[];
    expect(codes[0].hasPlain).toBe(true);
    expect(codes[0].plain).toBeUndefined();
    const revealed = await call(app, 'GET', '/admin/api/reveal?codeId=' + encodeURIComponent(codes[0].id), { cookie });
    expect(revealed.data && revealed.data.plain).toBe(start.code);
    calls.length = 0;
    const granted = await call(app, 'POST', '/admin/grant', {
      cookie,
      body: { csrf: (home.data && home.data.csrf) || (user.data && user.data.csrf), accountId: start.account.id, days: 2 },
    });
    expect(granted.data && granted.data.ok).toBe(true);
    expect(calls.some((u) => u.indexOf('sendMessage') >= 0)).toBe(true);
    const home3 = await call(app, 'GET', '/admin/api/home', { cookie });
    const issued = await call(app, 'POST', '/admin/issue', {
      cookie,
      body: { csrf: home3.data && home3.data.csrf, telegramId: '77', days: 7, channel: 'none' },
    });
    const flash = (issued.data && issued.data.flash) as { text?: string };
    expect(flash.text || '').toContain('7 дн.');
    const redir = String((issued.data && issued.data.redirect) || '');
    const id = new URL(redir, 'http://127.0.0.1').searchParams.get('id') || '';
    const found = await call(app, 'GET', '/admin/api/user?id=' + encodeURIComponent(id), { cookie });
    const until = ((found.data && found.data.subscription) || {}) as { paidUntil?: number };
    expect(Math.abs((until.paidUntil || 0) - (Date.now() + 7 * DAY))).toBeLessThan(60_000);
  });

  it('logs a bad yoomoney signature and does not notify admins', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omp-yoo-'));
    const file = join(dir, 'billing.db');
    const state = emptyState();
    state.settings.yoomoneySecret = 'secret';
    state.settings.botToken = 'token';
    state.settings.adminTelegramIds = '99';
    state.settings.adminNotify = true;
    writeState(file, state);
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 1 } }),
        text: async () => '',
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    };
    const app = createApp(file, fetchImpl);
    const forged = {
      notification_type: 'p2p-incoming',
      operation_id: 'op-forged',
      amount: '999.00',
      currency: '643',
      datetime: '2026-01-15T12:00:00Z',
      sender: '41001',
      codepro: 'false',
      label: 'attacker-label',
      sha1_hash: 'deadbeef',
    };
    const bad = await call(app, 'POST', '/v1/yoomoney', { form: forged });
    expect(bad.status).toBe(400);
    expect(bad.body).toBe('bad signature');
    expect(calls).toHaveLength(0);
    expect(readState(file).webhooks.some((row: { kind?: string }) => row.kind === 'bad_signature')).toBe(true);
    const fields = { ...forged, operation_id: 'op-real', sha1_hash: '' };
    fields.sha1_hash = notificationHash(fields, 'secret');
    const ok = await call(app, 'POST', '/v1/yoomoney', { form: fields });
    expect(ok.status).toBe(200);
    expect(calls.some((url) => url.indexOf('sendMessage') >= 0)).toBe(true);
  });
});

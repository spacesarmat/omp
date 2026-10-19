import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homePayload } from '../src/adminApi.mjs';
import { botReply, reminderMessage } from '../src/bot.mjs';
import {
  accessUntil,
  activate,
  activeExtras,
  applyPayment,
  createPromo,
  createSubscription,
  deviceLimitNow,
  dueReminders,
  END_WINDOW_MS,
  grantDays,
  graceDays,
  issueActivation,
  markReminder,
  migrateDeviceBase,
  migrateExtraSlots,
  mskDate,
  mskDateTime,
  mskDayStart,
  openAccount,
  quotePurchase,
  redeemPromo,
  releaseReminder,
  REMINDER_TRIES,
  renewableExtras,
  renewalPrice,
  sessionOk,
  subAccess,
  subscriptionView,
} from '../src/logic.mjs';
import { createApp, runReminders, startReminders } from '../src/server.mjs';
import { mergeSettings, publicAdminSettings } from '../src/services.mjs';
import { emptyState, readState, writeState } from '../src/store.mjs';
import { notificationHash } from '../src/yoomoney.mjs';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
// 2026-10-19 00:00 UTC = 03:00 MSK
const NOW = Date.parse('2026-10-19T00:00:00Z');
const DEV_A = 'a'.repeat(32);
const DEV_B = 'b'.repeat(32);
const DEV_C = 'c'.repeat(32);

type State = ReturnType<typeof emptyState>;
type Sub = State['subscriptions'][number] & Record<string, unknown>;

function priced(state: State) {
  state.settings.priceRub = 150;
  state.settings.extraDeviceRub = 50;
  state.settings.periodDays = 30;
  state.settings.yoomoneyWallet = '410011';
  state.settings.botToken = 'test-token';
  return state;
}

/** Telegram account 42 with a 30-day subscription from NOW and prices 150 / 50 ₽. */
function paid(days = 30, at = NOW) {
  const opened = openAccount(priced(emptyState()), { telegramId: '42', email: '', now: at });
  const created = createSubscription(opened.state, { accountId: opened.account.id, now: at, days });
  return { state: created.state as State, code: created.result.code as string, sub: created.result.subscriptionId as string, account: opened.account.id as string };
}

function subOf(state: State, id: string) {
  return state.subscriptions.find((s: { id: string }) => s.id === id) as Sub;
}

function withSub(state: State, id: string, patch: Record<string, unknown>): State {
  return { ...state, subscriptions: state.subscriptions.map((s: Sub) => (s.id === id ? { ...s, ...patch } : s)) } as State;
}

function pay(state: State, label: string, amount: string, now: number, op: string) {
  return applyPayment(state, { operationId: op, label, amount, currency: '643', now });
}

/** A on NOW, B on NOW+1, then a paid extra slot and C on NOW+2. */
function threeDevices() {
  const start = paid();
  const a = activate(start.state, { code: start.code, deviceId: DEV_A, now: NOW });
  const second = issueActivation(a.state, { accountId: start.account, now: NOW + 1 });
  const b = activate(second.state, { code: second.result.code, deviceId: DEV_B, now: NOW + 1 });
  const quote = quotePurchase(b.state, { kind: 'dev', accountId: start.account, subscriptionId: start.sub, now: NOW + 2 });
  expect(quote.result.price).toBe(50);
  const bought = pay(quote.state, quote.result.label, '50.00', NOW + 2, 'op-dev');
  expect(bought.result.kind).toBe('device');
  const c = activate(bought.state, { code: bought.result.code, deviceId: DEV_C, now: NOW + 2 });
  expect(c.result.token).toBeTruthy();
  return {
    ...start,
    state: c.state as State,
    tokens: { A: a.result.token as string, B: b.result.token as string, C: c.result.token as string },
  };
}

describe('grace period', () => {
  it('reads graceDays from settings: default 3, 0 allowed, capped at 30', () => {
    expect(graceDays({})).toBe(3);
    expect(graceDays({ graceDays: '' })).toBe(3);
    expect(graceDays({ graceDays: 0 })).toBe(0);
    expect(graceDays({ graceDays: '5' })).toBe(5);
    expect(graceDays({ graceDays: 99 })).toBe(30);
    expect(graceDays({ graceDays: -1 })).toBe(3);
    expect(graceDays({ graceDays: 'x' })).toBe(3);
    expect(emptyState().settings.graceDays).toBe(3);
    expect(mergeSettings({ graceDays: 3 }, { graceDays: '1' }).graceDays).toBe(1);
    expect(mergeSettings({ graceDays: 2 }, {}).graceDays).toBe(2);
    expect(publicAdminSettings({ graceDays: 0 }).graceDays).toBe(0);
  });

  it('keeps access through the grace period and stops on its last millisecond', () => {
    const start = paid();
    const a = activate(start.state, { code: start.code, deviceId: DEV_A, now: NOW });
    const until = NOW + 30 * DAY;
    const ok = (t: number) => sessionOk(a.state, { token: a.result.token, deviceId: DEV_A, now: t });
    expect(ok(until - 1)).toMatchObject({ grace: false });
    expect(ok(until)).toMatchObject({ grace: true, accessUntil: until + 3 * DAY });
    expect(ok(until + 3 * DAY - 1)).toMatchObject({ grace: true });
    expect(ok(until + 3 * DAY)).toBeNull();
    expect(accessUntil(a.state, subOf(a.state, start.sub))).toBe(until + 3 * DAY);
  });

  it('graceDays 0 ends access exactly at paidUntil', () => {
    const start = paid();
    start.state.settings.graceDays = 0;
    const a = activate(start.state, { code: start.code, deviceId: DEV_A, now: NOW });
    const until = NOW + 30 * DAY;
    expect(sessionOk(a.state, { token: a.result.token, deviceId: DEV_A, now: until - 1 })).toBeTruthy();
    expect(sessionOk(a.state, { token: a.result.token, deviceId: DEV_A, now: until })).toBeNull();
  });

  it('only the server clock counts: a token checked with a later "now" is refused, an earlier one passes', () => {
    const start = paid(1);
    const a = activate(start.state, { code: start.code, deviceId: DEV_A, now: NOW });
    // The phone cannot send its own time: sessionOk takes the server's now.
    expect(sessionOk(a.state, { token: a.result.token, deviceId: DEV_A, now: NOW + 4 * DAY })).toBeNull();
    expect(sessionOk(a.state, { token: a.result.token, deviceId: DEV_A, now: NOW + 4 * DAY - 1 })).toBeTruthy();
  });

  it('a code activates during grace and not after it', () => {
    const start = paid(1);
    const inGrace = activate(start.state, { code: start.code, deviceId: DEV_A, now: NOW + DAY + HOUR });
    expect(inGrace.result.token).toBeTruthy();
    const late = activate(start.state, { code: start.code, deviceId: DEV_A, now: NOW + 4 * DAY });
    expect(late.result.error).toBe('expired');
  });

  it('subscriptionView, the bot cabinet and the panel show the grace period', () => {
    const start = paid();
    const t = NOW + 31 * DAY;
    const view = subscriptionView(start.state, start.account, t);
    expect(view).toMatchObject({ active: true, paid: false, inGrace: true, accessUntil: NOW + 33 * DAY, graceDays: 3 });
    const cab = botReply(start.state, { chatId: '42', text: 'Кабинет', now: t });
    const text = cab.messages[0].text as string;
    expect(text).toContain('Подписка закончилась 18.11.2026 03:00 МСК');
    expect(text).toContain('Льготный период: поиск работает до 21.11.2026 03:00 МСК');
    const after = paid(1, Date.now() - 2 * DAY);
    const graceHome = homePayload(after.state, ':memory:', {}) as { subscriptions: { status: string; inGrace: boolean; active: boolean }[] };
    expect(graceHome.subscriptions[0]).toMatchObject({ status: 'grace', inGrace: true, active: true });
    const gone = paid(1, Date.now() - 5 * DAY);
    expect((homePayload(gone.state, ':memory:', {}) as { subscriptions: { status: string }[] }).subscriptions[0].status).toBe('expired');
  });

  it('a paid renewal in grace continues from paidUntil; after grace it starts now', () => {
    const start = paid();
    const until = NOW + 30 * DAY;
    const q1 = quotePurchase(start.state, { kind: 'sub', accountId: start.account, subscriptionId: start.sub, now: until + DAY });
    const inGrace = pay(q1.state, q1.result.label, '150', until + DAY, 'op-g');
    expect(inGrace.result.paidUntil).toBe(until + 30 * DAY);
    const q2 = quotePurchase(start.state, { kind: 'sub', accountId: start.account, subscriptionId: start.sub, now: until + 5 * DAY });
    const late = pay(q2.state, q2.result.label, '150', until + 5 * DAY, 'op-l');
    expect(late.result.paidUntil).toBe(until + 35 * DAY);
    const q3 = quotePurchase(start.state, { kind: 'sub', accountId: start.account, subscriptionId: start.sub, now: NOW + DAY });
    const early = pay(q3.state, q3.result.label, '150', NOW + DAY, 'op-e');
    expect(early.result.paidUntil).toBe(until + 30 * DAY);
  });

  it('gift days (promo, admin grant) still start from max(paidUntil, now)', () => {
    const start = paid();
    const t = NOW + 31 * DAY;
    const granted = grantDays(start.state, { accountId: start.account, days: 2, now: t });
    expect(granted.result.paidUntil).toBe(t + 2 * DAY);
    const promo = createPromo(start.state, { code: 'GIFT2', days: 2, maxUses: 5, now: NOW });
    const redeemed = redeemPromo(promo.state, { code: 'GIFT2', accountId: start.account, now: NOW });
    expect(redeemed.result.paidUntil).toBe(NOW + 32 * DAY);
  });
});

describe('monthly extra device', () => {
  it('a bought slot lasts until paidUntil and counts in the limit', () => {
    const f = threeDevices();
    const sub = subOf(f.state, f.sub);
    expect(sub.deviceLimit).toBe(2);
    expect(sub.extraSlots).toBe(1);
    expect(sub.extraUntil).toBe(NOW + 30 * DAY);
    expect(deviceLimitNow(f.state, sub, NOW)).toBe(3);
    for (const [dev, token] of [[DEV_A, f.tokens.A], [DEV_B, f.tokens.B], [DEV_C, f.tokens.C]]) {
      expect(sessionOk(f.state, { token, deviceId: dev, now: NOW + 10 * DAY })).toBeTruthy();
    }
  });

  it('renewal price is 150 + 50 × active extra slots, with a breakdown in the bot', () => {
    const f = threeDevices();
    const sub = subOf(f.state, f.sub);
    expect(renewalPrice(f.state, sub, NOW)).toMatchObject({ base: 150, extras: 1, extraSum: 50, total: 200 });
    expect(renewalPrice(f.state, sub, NOW, { withExtras: false })).toMatchObject({ extras: 0, total: 150 });
    const two = withSub(f.state, f.sub, { extraSlots: 2 });
    expect(renewalPrice(two, subOf(two, f.sub), NOW).total).toBe(250);
    const q = quotePurchase(f.state, { kind: 'sub', accountId: f.account, subscriptionId: f.sub, now: NOW });
    expect(q.result).toMatchObject({ price: 200, extras: 1 });
    const reply = botReply(f.state, { chatId: '42', text: 'Продлить', now: NOW });
    const texts = reply.messages.map((m: { text: string }) => m.text);
    expect(texts[0]).toContain('Продление на 30 дн., до 18.12.2026:');
    expect(texts[0]).toContain('• подписка — 150 ₽');
    expect(texts[0]).toContain('• доп. устройство × 1 — 50 ₽');
    expect(texts[0]).toContain('Итого: 200 ₽');
    expect(texts[0]).toContain('sum=200');
    expect(texts[1]).toContain('Без доп. устройств — 150 ₽');
    expect(texts[1]).toContain('sum=150');
  });

  it('renewal with the extra slot moves it to the new paidUntil; 150 ₽ for a 200 ₽ quote is refused', () => {
    const f = threeDevices();
    const q = quotePurchase(f.state, { kind: 'sub', accountId: f.account, subscriptionId: f.sub, now: NOW + 29 * DAY });
    const short = pay(q.state, q.result.label, '150', NOW + 29 * DAY, 'op-short');
    expect(short.result.error).toBe('amount');
    const ok = pay(q.state, q.result.label, '194.00', NOW + 29 * DAY, 'op-ok');
    expect(ok.result).toMatchObject({ kind: 'renew', extras: 1, paidUntil: NOW + 60 * DAY });
    const sub = subOf(ok.state, f.sub);
    expect(sub.extraUntil).toBe(NOW + 60 * DAY);
    expect(sessionOk(ok.state, { token: f.tokens.C, deviceId: DEV_C, now: NOW + 50 * DAY })).toBeTruthy();
  });

  it('after a base-only renewal the slot lapses after its own grace; the newest device loses access but stays bound', () => {
    const f = threeDevices();
    const q = quotePurchase(f.state, { kind: 'sub', accountId: f.account, subscriptionId: f.sub, now: NOW + 29 * DAY, withExtras: false });
    expect(q.result.price).toBe(150);
    const renewed = pay(q.state, q.result.label, '150', NOW + 29 * DAY, 'op-base').state as State;
    const sub = subOf(renewed, f.sub);
    expect(sub.paidUntil).toBe(NOW + 60 * DAY);
    expect(sub.extraUntil).toBe(NOW + 30 * DAY);
    const lapse = NOW + 33 * DAY;
    expect(activeExtras(renewed, sub, lapse - 1)).toBe(1);
    expect(activeExtras(renewed, sub, lapse)).toBe(0);
    const ok = (dev: string, token: string, t: number) => !!sessionOk(renewed, { token, deviceId: dev, now: t });
    expect(ok(DEV_C, f.tokens.C, lapse - 1)).toBe(true);
    expect(ok(DEV_C, f.tokens.C, lapse)).toBe(false);
    expect(ok(DEV_A, f.tokens.A, lapse)).toBe(true);
    expect(ok(DEV_B, f.tokens.B, lapse)).toBe(true);
    // Not deleted: the binding and the session stay.
    expect(renewed.codes.filter((c: { deviceId: string }) => c.deviceId === DEV_C)).toHaveLength(1);
    const view = subscriptionView(renewed, f.account, lapse);
    expect(view.deviceLimit).toBe(2);
    expect(view.devices.find((d: { deviceId: string }) => d.deviceId === DEV_C).overLimit).toBe(true);
    // Re-entry on C is refused; no new code at 3 bound of 2.
    const back = activate(renewed, { code: 'XXXX-XXXX', deviceId: DEV_C, now: lapse });
    expect(back.result.error).toBe('bad_code');
    const issue = issueActivation(renewed, { accountId: f.account, now: lapse });
    expect(issue.result.error).toBe('device_limit');
    const cab = botReply(renewed, { chatId: '42', text: 'Кабинет', now: lapse });
    expect(cab.messages[0].text).toContain('Устройства: 3 из 2');
    expect(cab.messages[0].text).toContain('cccccccc… (не работает: доп. устройство не продлено)');
    // The renewal price no longer includes the lapsed slot.
    expect(renewalPrice(renewed, sub, lapse).total).toBe(150);
    // Buying the slot again brings C back without a new code.
    const dq = quotePurchase(renewed, { kind: 'dev', accountId: f.account, subscriptionId: f.sub, now: lapse + DAY });
    const again = pay(dq.state, dq.result.label, '50', lapse + DAY, 'op-dev2');
    const restored = subOf(again.state, f.sub);
    expect(restored.extraSlots).toBe(1);
    expect(restored.extraUntil).toBe(NOW + 60 * DAY);
    expect(sessionOk(again.state, { token: f.tokens.C, deviceId: DEV_C, now: lapse + DAY })).toBeTruthy();
  });

  it('after grace the renewal still offers the lapsed slot: 200 ₽ brings it and the bound device back', () => {
    const f = threeDevices();
    const t = NOW + 40 * DAY; // paidUntil + 10 days: grace is over
    const sub = subOf(f.state, f.sub);
    expect(subAccess(f.state, sub, t).access).toBe(false);
    expect(activeExtras(f.state, sub, t)).toBe(0);
    expect(renewableExtras(f.state, sub, t)).toBe(1);
    expect(renewalPrice(f.state, sub, t)).toMatchObject({ base: 150, extras: 1, extraSum: 50, total: 200 });
    expect(sessionOk(f.state, { token: f.tokens.C, deviceId: DEV_C, now: t })).toBeNull();
    const q = quotePurchase(f.state, { kind: 'sub', accountId: f.account, subscriptionId: f.sub, now: t });
    expect(q.result).toMatchObject({ price: 200, extras: 1 });
    const renewed = pay(q.state, q.result.label, '200.00', t, 'op-late');
    expect(renewed.result).toMatchObject({ kind: 'renew', extras: 1, paidUntil: t + 30 * DAY });
    const after = subOf(renewed.state, f.sub);
    expect(after).toMatchObject({ extraSlots: 1, extraUntil: t + 30 * DAY, deviceLimit: 2 });
    // All three bound phones work again with their old tokens; no new code was minted.
    for (const [dev, token] of [[DEV_A, f.tokens.A], [DEV_B, f.tokens.B], [DEV_C, f.tokens.C]]) {
      expect(sessionOk(renewed.state, { token, deviceId: dev, now: t + DAY })).toBeTruthy();
    }
    expect(renewed.state.codes).toHaveLength(f.state.codes.length);
  });

  it('after grace a 150 ₽ renewal (base only) leaves the extra device off, bound, and not offered again', () => {
    const f = threeDevices();
    const t = NOW + 40 * DAY;
    const q = quotePurchase(f.state, { kind: 'sub', accountId: f.account, subscriptionId: f.sub, now: t, withExtras: false });
    expect(q.result).toMatchObject({ price: 150, extras: 0 });
    const renewed = pay(q.state, q.result.label, '150', t, 'op-base-late');
    expect(renewed.result.paidUntil).toBe(t + 30 * DAY);
    expect(sessionOk(renewed.state, { token: f.tokens.C, deviceId: DEV_C, now: t + DAY })).toBeNull();
    expect(sessionOk(renewed.state, { token: f.tokens.A, deviceId: DEV_A, now: t + DAY })).toBeTruthy();
    expect(sessionOk(renewed.state, { token: f.tokens.B, deviceId: DEV_B, now: t + DAY })).toBeTruthy();
    expect(renewed.state.codes.filter((c: { deviceId: string }) => c.deviceId === DEV_C)).toHaveLength(1);
    // The dropped slot is not in later renewals any more; «Код» sells a new one.
    const sub = subOf(renewed.state, f.sub);
    expect(renewalPrice(renewed.state, sub, t + DAY).total).toBe(150);
    expect(renewalPrice(renewed.state, sub, t + 40 * DAY).total).toBe(150);
  });

  it('after grace the amount must cover the quote: 150 ₽ for a 200 ₽ quote is refused, ~3% fee is fine', () => {
    const f = threeDevices();
    const t = NOW + 40 * DAY;
    const q = quotePurchase(f.state, { kind: 'sub', accountId: f.account, subscriptionId: f.sub, now: t });
    const short = pay(q.state, q.result.label, '150.00', t, 'op-short-late');
    expect(short.result.error).toBe('amount');
    expect(subOf(short.state, f.sub).paidUntil).toBe(NOW + 30 * DAY);
    expect(sessionOk(short.state, { token: f.tokens.A, deviceId: DEV_A, now: t })).toBeNull();
    const fee = pay(q.state, q.result.label, '194.00', t, 'op-fee-late');
    expect(fee.result).toMatchObject({ kind: 'renew', extras: 1 });
    const under = pay(q.state, q.result.label, '193.00', t, 'op-under-late');
    expect(under.result.error).toBe('amount');
    const rub = applyPayment(q.state, { operationId: 'op-usd', label: q.result.label, amount: '200', currency: '840', now: t });
    expect(rub.result.error).toBe('amount');
  });

  it('after grace the bot offers 200 ₽ with a breakdown and «Без доп. устройств — 150 ₽»; «Подписка» renews too', () => {
    const f = threeDevices();
    const t = NOW + 40 * DAY;
    for (const press of ['Продлить', 'Подписка']) {
      const reply = botReply(f.state, { chatId: '42', text: press, now: t });
      const texts = reply.messages.map((m: { text: string }) => m.text);
      expect(texts[0]).toContain('• подписка — 150 ₽');
      expect(texts[0]).toContain('• доп. устройство × 1 — 50 ₽');
      expect(texts[0]).toContain('Итого: 200 ₽');
      expect(texts[0]).toContain('sum=200');
      expect(texts[1]).toContain('Без доп. устройств — 150 ₽. Доп. устройство тогда останется отключённым (привязка сохранится)');
      expect(texts[1]).toContain('sum=150');
    }
  });

  it('gift days carry an active slot along, so a gift never cuts off a paid device', () => {
    const f = threeDevices();
    const granted = grantDays(f.state, { accountId: f.account, days: 7, now: NOW + DAY });
    const sub = subOf(granted.state, f.sub);
    expect(sub.paidUntil).toBe(NOW + 37 * DAY);
    expect(sub.extraUntil).toBe(NOW + 37 * DAY);
  });

  it('bot «Код» explains the monthly price of one more device', () => {
    const f = threeDevices();
    const reply = botReply(f.state, { chatId: '42', text: 'Код', now: NOW });
    const text = reply.messages.map((m: { text: string }) => m.text).join('\n');
    expect(text).toContain('Устройства: 3 из 3 (2 в подписке + 1 доп. до 18.11.2026)');
    expect(text).toContain('Ещё одно устройство — 50 ₽ до 18.11.2026');
    expect(text).toContain('продление станет 250 ₽');
    const price = botReply(f.state, { chatId: '42', text: 'Цены', now: NOW });
    expect(price.messages[0].text).toContain('Доп. устройство — 50 ₽ в месяц');
    expect(price.messages[0].text).toContain('3 дн. льготного периода');
  });
});

describe('migration of lifetime extra devices', () => {
  it('turns deviceLimit above the base into a slot valid until the current paidUntil, once', () => {
    const start = paid();
    const legacy = { ...withSub(start.state, start.sub, { deviceLimit: 3 }), meta: { deviceBase: 2 } } as State;
    const moved = migrateExtraSlots(legacy);
    const sub = subOf(moved, start.sub);
    expect(sub).toMatchObject({ deviceLimit: 2, extraSlots: 1, extraUntil: NOW + 30 * DAY });
    expect(moved.meta.extraMonthly).toBe(1);
    expect(migrateExtraSlots(withSub(moved, start.sub, { deviceLimit: 4 }))).toMatchObject({ meta: { extraMonthly: 1 } });
    expect(subOf(migrateExtraSlots(withSub(moved, start.sub, { deviceLimit: 4 })), start.sub).deviceLimit).toBe(4);
  });

  it('a snapshot from before PR-1 (base 1, one bought device) ends as 2 included + 1 monthly slot via SQLite', () => {
    const start = paid();
    const old = { ...withSub(start.state, start.sub, { deviceLimit: 2 }) } as Record<string, unknown>;
    delete old.meta;
    const file = join(mkdtempSync(join(tmpdir(), 'omp-pr2-')), 'billing.db');
    writeState(file, old);
    const read = readState(file);
    expect(subOf(read, start.sub)).toMatchObject({ deviceLimit: 2, extraSlots: 1, extraUntil: NOW + 30 * DAY });
    expect(read.meta).toMatchObject({ deviceBase: 2, extraMonthly: 1 });
    // A plain old subscription («2 из 1» in prod) becomes 2 included, no extra slot.
    const plain = migrateExtraSlots(migrateDeviceBase({ ...withSub(start.state, start.sub, { deviceLimit: 1 }), meta: {} }));
    expect(subOf(plain, start.sub)).toMatchObject({ deviceLimit: 2 });
    expect(subOf(plain, start.sub).extraSlots || 0).toBe(0);
  });
});

/** Account 42 whose subscription ends at `until`, extended/created long before. */
function expiringAt(until: number) {
  const start = paid();
  const state = withSub(start.state, start.sub, { paidUntil: until, createdAt: until - 30 * DAY, extendedAt: until - 30 * DAY });
  return { ...start, state };
}

const msk = (iso: string) => Date.parse(iso + '+03:00');

describe('renewal reminders', () => {
  it('3 days before, the day before and the expiry day, from 10:00 MSK until the end of that day', () => {
    const until = msk('2026-10-25T15:00:00');
    const f = expiringAt(until);
    const due = (iso: string) => dueReminders(f.state, msk(iso)).map((r: { kind: string }) => r.kind);
    expect(due('2026-10-22T09:59:59')).toEqual([]);
    expect(due('2026-10-22T10:00:00')).toEqual(['d3']);
    expect(due('2026-10-22T23:59:59')).toEqual(['d3']);
    expect(due('2026-10-23T00:00:00')).toEqual([]);
    expect(due('2026-10-23T12:00:00')).toEqual([]);
    expect(due('2026-10-24T10:00:00')).toEqual(['d1']);
    expect(due('2026-10-25T10:00:00')).toEqual(['d0']);
    expect(due('2026-10-25T16:00:00')).toEqual(['d0']);
    expect(due('2026-10-26T10:00:00')).toEqual([]);
  });

  it('uses the Moscow calendar day, not the UTC one', () => {
    // 25.10 00:30 MSK is still 24.10 in UTC.
    const until = msk('2026-10-25T00:30:00');
    expect(new Date(until).toISOString().slice(0, 10)).toBe('2026-10-24');
    expect(mskDayStart(until)).toBe(msk('2026-10-25T00:00:00'));
    expect(mskDate(until)).toBe('25.10.2026');
    expect(mskDateTime(until)).toBe('25.10.2026 00:30 МСК');
    const f = expiringAt(until);
    expect(dueReminders(f.state, msk('2026-10-22T10:00:00')).map((r: { kind: string }) => r.kind)).toEqual(['d3']);
    // The expiry-day reminder comes at 10:00, after the 00:30 expiry: it speaks of the grace period.
    const d0 = dueReminders(f.state, msk('2026-10-25T10:00:00'));
    expect(d0.map((r: { kind: string }) => r.kind)).toEqual(['d0']);
    const msg = reminderMessage(f.state, d0[0], msk('2026-10-25T10:00:00'));
    expect(msg.text).toContain('Подписка OMP закончилась сегодня в 00:30 МСК.');
    expect(msg.text).toContain('Льготный период: поиск работает до 28.10.2026 00:30 МСК.');
    // 23:59 MSK expiry: the reminder still comes the same day, before the end.
    const late = expiringAt(msk('2026-10-25T23:59:00'));
    const lateRows = dueReminders(late.state, msk('2026-10-25T10:00:00'));
    expect(reminderMessage(late.state, lateRows[0], msk('2026-10-25T10:00:00')).text).toContain('заканчивается сегодня в 23:59 МСК');
  });

  it('texts: d3 and d1 name the date and the renewal price with the extra slot', () => {
    const f = threeDevices();
    const until = NOW + 30 * DAY; // 18.11.2026 03:00 MSK
    const d3 = dueReminders(f.state, msk('2026-11-15T10:00:00'));
    expect(d3.map((r: { kind: string }) => r.kind)).toEqual(['d3']);
    const m3 = reminderMessage(f.state, d3[0], msk('2026-11-15T10:00:00'));
    expect(m3.chatId).toBe('42');
    expect(m3.text).toBe(
      'Подписка OMP заканчивается через 3 дня — 18.11.2026 в 03:00 МСК.\n' +
        'Продление на 30 дн.: 200 ₽ (подписка 150 ₽ + доп. устройство 50 ₽ × 1).\n' +
        'Нажмите «Продлить» — ссылка на оплату придёт в этот чат.',
    );
    expect(m3.inline.inline_keyboard[0][0]).toEqual({ text: 'Продлить', url: 'https://t.me/OMPBILLINGBOT?start=renew' });
    const d1 = dueReminders(f.state, msk('2026-11-17T10:00:00'));
    expect(reminderMessage(f.state, d1[0], msk('2026-11-17T10:00:00')).text).toContain('заканчивается завтра — 18.11.2026 в 03:00 МСК');
    const plain = expiringAt(until);
    const p1 = dueReminders(plain.state, msk('2026-11-17T10:00:00'));
    expect(reminderMessage(plain.state, p1[0], msk('2026-11-17T10:00:00')).text).toContain('Продление на 30 дн.: 150 ₽.');
    const d0 = expiringAt(msk('2026-11-18T18:00:00'));
    const r0 = dueReminders(d0.state, msk('2026-11-18T10:00:00'));
    const t0 = reminderMessage(d0.state, r0[0], msk('2026-11-18T10:00:00')).text;
    expect(t0).toContain('Подписка OMP заканчивается сегодня в 18:00 МСК.');
    expect(t0).toContain('После этого ещё 3 дн. льготного периода: поиск будет работать до 21.11.2026 18:00 МСК.');
  });

  it('each reminder goes once per expiry date; a renewal starts a new cycle', () => {
    const until = msk('2026-10-25T15:00:00');
    const f = expiringAt(until);
    const at = msk('2026-10-22T11:00:00');
    const rows = dueReminders(f.state, at);
    const marked = markReminder(f.state, { ...rows[0], now: at });
    expect(dueReminders(marked, at)).toEqual([]);
    expect(dueReminders(marked, msk('2026-10-22T20:00:00'))).toEqual([]);
    expect(dueReminders(marked, msk('2026-10-24T10:00:00')).map((r: { kind: string }) => r.kind)).toEqual(['d1']);
    // Paid one day before: the next reminders refer to the new date only.
    const q = quotePurchase(marked, { kind: 'sub', accountId: f.account, subscriptionId: f.sub, now: msk('2026-10-24T09:00:00') });
    const renewed = pay(q.state, q.result.label, '150', msk('2026-10-24T09:00:00'), 'op-r').state as State;
    expect(dueReminders(renewed, msk('2026-10-24T10:00:00'))).toEqual([]);
    expect(dueReminders(renewed, msk('2026-10-25T10:00:00'))).toEqual([]);
    expect(dueReminders(renewed, msk('2026-11-21T10:00:00')).map((r: { kind: string }) => r.kind)).toEqual(['d3']);
  });

  it('skips a reminder whose time came before the subscription was taken, and accounts without Telegram', () => {
    // 1-day promo at 15:00: no «завтра» right away, only the expiry-day one.
    const taken = msk('2026-10-22T15:00:00');
    const f = paid(1, taken);
    expect(dueReminders(f.state, msk('2026-10-22T16:00:00'))).toEqual([]);
    expect(dueReminders(f.state, msk('2026-10-23T10:00:00')).map((r: { kind: string }) => r.kind)).toEqual(['d0']);
    const noTg = { ...f.state, accounts: f.state.accounts.map((a: object) => ({ ...a, telegramId: '' })) } as State;
    expect(dueReminders(noTg, msk('2026-10-23T10:00:00'))).toEqual([]);
    // Fully lapsed (graceDays 0): no expiry-day reminder is left, only the «end» notice.
    const gone = expiringAt(msk('2026-10-25T00:30:00'));
    gone.state.settings.graceDays = 0;
    expect(dueReminders(gone.state, msk('2026-10-25T10:00:00')).map((r: { kind: string }) => r.kind)).toEqual(['end']);
  });

  it('a failed send is freed for a retry, up to REMINDER_TRIES', () => {
    const f = expiringAt(msk('2026-10-25T15:00:00'));
    const at = msk('2026-10-22T10:00:00');
    const row = dueReminders(f.state, at)[0];
    let state = f.state;
    for (let i = 0; i < REMINDER_TRIES; i++) {
      expect(dueReminders(state, at)).toHaveLength(1);
      state = markReminder(state, { ...row, now: at });
      state = releaseReminder(state, row);
    }
    expect(dueReminders(state, at)).toEqual([]);
  });
});

describe('grace end notice', () => {
  const kinds = (state: State, iso: string) => dueReminders(state, msk(iso)).map((r: { kind: string }) => r.kind);

  it('comes from 10:00 MSK when grace ended in the night, until the end of that day', () => {
    // paidUntil 22.10 02:00 MSK → grace ends 25.10 02:00 MSK.
    const f = expiringAt(msk('2026-10-22T02:00:00'));
    expect(kinds(f.state, '2026-10-25T01:59:59')).toEqual([]);
    expect(kinds(f.state, '2026-10-25T02:00:00')).toEqual([]);
    expect(kinds(f.state, '2026-10-25T09:59:59')).toEqual([]);
    expect(kinds(f.state, '2026-10-25T10:00:00')).toEqual(['end']);
    expect(kinds(f.state, '2026-10-25T23:59:59')).toEqual(['end']);
    expect(kinds(f.state, '2026-10-26T00:00:00')).toEqual([]);
    expect(kinds(f.state, '2026-10-27T10:00:00')).toEqual([]);
  });

  it('comes right away when grace ended after 10:00 MSK, and not a millisecond before', () => {
    const f = expiringAt(msk('2026-10-22T15:30:00'));
    expect(kinds(f.state, '2026-10-25T15:29:59')).toEqual([]);
    expect(kinds(f.state, '2026-10-25T15:30:00')).toEqual(['end']);
    // A 23:50 end is not lost to the 10-minute tick: it stays due for END_WINDOW_MS.
    const late = expiringAt(msk('2026-10-22T23:50:00'));
    const end = msk('2026-10-25T23:50:00');
    expect(dueReminders(late.state, end + END_WINDOW_MS - 1).map((r: { kind: string }) => r.kind)).toEqual(['end']);
    expect(dueReminders(late.state, end + END_WINDOW_MS)).toEqual([]);
  });

  it('is sent once per expiry date and starts over after a renewal', () => {
    const f = expiringAt(msk('2026-10-22T15:30:00'));
    const at = msk('2026-10-25T16:00:00');
    const row = dueReminders(f.state, at)[0];
    const marked = markReminder(f.state, { ...row, now: at });
    expect(dueReminders(marked, at + HOUR)).toEqual([]);
    const q = quotePurchase(marked, { kind: 'sub', accountId: f.account, subscriptionId: f.sub, now: at + 2 * HOUR });
    const renewed = pay(q.state, q.result.label, '150', at + 2 * HOUR, 'op-after').state as State;
    const sub = subOf(renewed, f.sub);
    expect(sub.paidUntil).toBe(at + 2 * HOUR + 30 * DAY);
    expect(dueReminders(renewed, at + 3 * HOUR)).toEqual([]);
    // The next cycle gets its own end notice.
    const nextEnd = sub.paidUntil + 3 * DAY;
    expect(dueReminders(renewed, nextEnd).map((r: { kind: string }) => r.kind)).toEqual(['end']);
  });

  it('text: grace ended, price with the lapsed extra slot and a «Продлить» button', () => {
    const f = threeDevices(); // paidUntil 18.11 03:00 MSK, extra slot until the same date
    const at = msk('2026-11-21T10:00:00');
    const rows = dueReminders(f.state, at);
    expect(rows.map((r: { kind: string }) => r.kind)).toEqual(['end']);
    const msg = reminderMessage(f.state, rows[0], at);
    expect(msg.text).toBe(
      'Льготный период закончился — поиск в OMP отключён.\n' +
        'Продлите подписку, чтобы продолжить: 200 ₽ на 30 дн. (подписка 150 ₽ + доп. устройство 50 ₽ × 1).\n' +
        'Привязанные устройства заработают сами, код вводить не нужно. Без доп. устройств — 150 ₽.\n' +
        'Нажмите «Продлить» — ссылка на оплату придёт в этот чат.',
    );
    expect(msg.text).not.toContain('«Код»');
    expect(msg.inline.inline_keyboard[0][0]).toEqual({ text: 'Продлить', url: 'https://t.me/OMPBILLINGBOT?start=renew' });
    // A slot dropped by an earlier base-only renewal is not offered: plain 150 ₽.
    const dropped = withSub(f.state, f.sub, { extraUntil: NOW + 10 * DAY });
    const t2 = reminderMessage(dropped, dueReminders(dropped, at)[0], at).text;
    expect(t2).toContain('Продлите подписку, чтобы продолжить: 150 ₽ на 30 дн.\nНажмите');
    const plain = expiringAt(msk('2026-11-18T03:00:00'));
    plain.state.settings.graceDays = 0;
    const p = reminderMessage(plain.state, dueReminders(plain.state, msk('2026-11-18T10:00:00'))[0], msk('2026-11-18T10:00:00'));
    expect(p.text).toContain('Подписка OMP закончилась — поиск отключён.');
  });

  it('the runner sends it once, and not on a BILLING_BOT_POLL=0 copy', async () => {
    const f = expiringAt(msk('2026-10-22T15:30:00'));
    const file = join(mkdtempSync(join(tmpdir(), 'omp-pr2-')), 'billing.db');
    writeState(file, f.state);
    const sent: { text: string }[] = [];
    const net = async (url: string, init?: { body?: string }) => {
      if (String(url).indexOf('/sendMessage') >= 0 && init && init.body) sent.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }), text: async () => '', headers: {}, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const clock = () => msk('2026-10-25T16:00:00');
    const stopOff = startReminders(file, net, { env: { BILLING_BOT_POLL: 'off' }, firstMs: 1, everyMs: 5, now: clock });
    await new Promise((r) => setTimeout(r, 40));
    stopOff();
    expect(sent).toHaveLength(0);
    expect(await runReminders(file, net, clock())).toEqual({ sent: 1, failed: 0 });
    expect(await runReminders(file, net, clock() + 10 * 60 * 1000)).toEqual({ sent: 0, failed: 0 });
    expect(sent[0].text).toContain('Льготный период закончился');
    expect(readState(file).subscriptions[0].reminders.sent.end).toBe(clock());
  });
});

describe('reminder runner', () => {
  const stops: (() => void)[] = [];
  afterEach(() => {
    while (stops.length) (stops.pop() as () => void)();
  });

  function capture(ok = true) {
    const sent: { chat_id: string; text: string; reply_markup?: unknown }[] = [];
    const net = async (url: string, init?: { body?: string }) => {
      if (String(url).indexOf('/sendMessage') >= 0 && init && init.body) sent.push(JSON.parse(init.body));
      return {
        ok,
        status: ok ? 200 : 403,
        json: async () => (ok ? { ok: true, result: { message_id: sent.length } } : { ok: false, error_code: 403 }),
        text: async () => '',
        headers: {},
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    };
    return { sent, net };
  }

  function fileWith(state: unknown) {
    const file = join(mkdtempSync(join(tmpdir(), 'omp-pr2-')), 'billing.db');
    writeState(file, state);
    return file;
  }

  it('sends a due reminder once, even when ticks repeat', async () => {
    const f = expiringAt(msk('2026-10-25T15:00:00'));
    const file = fileWith(f.state);
    const { sent, net } = capture();
    const at = msk('2026-10-24T10:05:00');
    expect(await runReminders(file, net, at)).toEqual({ sent: 1, failed: 0 });
    expect(await runReminders(file, net, at + 10 * 60 * 1000)).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].chat_id).toBe('42');
    expect(sent[0].text).toContain('заканчивается завтра');
    expect(readState(file).subscriptions[0].reminders.sent.d1).toBe(at);
  });

  it('retries a failed send on the next tick and gives up after REMINDER_TRIES', async () => {
    const f = expiringAt(msk('2026-10-25T15:00:00'));
    const file = fileWith(f.state);
    const down = capture(false);
    const at = msk('2026-10-24T10:05:00');
    for (let i = 0; i < REMINDER_TRIES; i++) expect(await runReminders(file, down.net, at + i)).toEqual({ sent: 0, failed: 1 });
    expect(await runReminders(file, down.net, at + 99)).toEqual({ sent: 0, failed: 0 });
  });

  it('does nothing without a bot token', async () => {
    const f = expiringAt(msk('2026-10-25T15:00:00'));
    f.state.settings.botToken = '';
    const file = fileWith(f.state);
    const { sent, net } = capture();
    expect(await runReminders(file, net, msk('2026-10-24T10:05:00'))).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(0);
    expect(readState(file).subscriptions[0].reminders).toBeUndefined();
  });

  it('the timer runs only on the polling instance (BILLING_BOT_POLL) and never repeats a reminder', async () => {
    const f = expiringAt(msk('2026-10-25T15:00:00'));
    const file = fileWith(f.state);
    const clock = () => msk('2026-10-24T10:05:00');
    const off = capture();
    stops.push(startReminders(file, off.net, { env: { BILLING_BOT_POLL: '0' }, firstMs: 1, everyMs: 5, now: clock }));
    await new Promise((r) => setTimeout(r, 40));
    expect(off.sent).toHaveLength(0);
    expect(readState(file).subscriptions[0].reminders).toBeUndefined();
    const on = capture();
    stops.push(startReminders(file, on.net, { env: {}, firstMs: 1, everyMs: 5, now: clock }));
    await new Promise((r) => setTimeout(r, 80));
    expect(on.sent).toHaveLength(1);
    expect(on.sent[0].text).toContain('заканчивается завтра');
  });
});

describe('billing HTTP: grace and over-limit phones', () => {
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

  async function call(app: (req: unknown, res: unknown) => Promise<void>, method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown; form?: Record<string, string> } = {}) {
    const payload = opts.form ? new URLSearchParams(opts.form).toString() : opts.body === undefined ? '' : JSON.stringify(opts.body);
    const req = {
      method,
      url: path,
      headers: { accept: 'application/json', 'content-type': opts.form ? 'application/x-www-form-urlencoded' : 'application/json', ...(opts.headers || {}) },
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
    return { status: res.status, data };
  }

  /** Shift every timestamp so the scenario's `at` is the real now. */
  function realTime(state: State, at: number): State {
    const d = Date.now() - at;
    return {
      ...state,
      subscriptions: state.subscriptions.map((s: Sub) => ({
        ...s,
        paidUntil: s.paidUntil + d,
        extraUntil: s.extraUntil ? Number(s.extraUntil) + d : 0,
      })),
      codes: state.codes.map((c: { boundAt: number }) => ({ ...c, boundAt: c.boundAt ? c.boundAt + d : 0 })),
    } as State;
  }

  const noFetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }), text: async () => '', headers: {}, arrayBuffer: async () => new ArrayBuffer(0) });

  it('/v1/me in grace is active with inGrace; after grace it is inactive', async () => {
    const start = paid();
    const a = activate(start.state, { code: start.code, deviceId: DEV_A, now: NOW });
    const file = join(mkdtempSync(join(tmpdir(), 'omp-pr2-')), 'billing.db');
    writeState(file, realTime(a.state, NOW + 31 * DAY));
    const app = createApp(file, noFetch, { env: {} });
    const me = await call(app, 'GET', '/v1/me', { headers: { 'x-device-id': DEV_A, authorization: 'Bearer ' + a.result.token } });
    expect(me.status).toBe(200);
    expect(me.data).toMatchObject({ active: true, inGrace: true, overLimit: false });
    writeState(file, realTime(a.state, NOW + 34 * DAY));
    const after = await call(app, 'GET', '/v1/me', { headers: { 'x-device-id': DEV_A, authorization: 'Bearer ' + a.result.token } });
    expect(after.status).toBe(200);
    expect(after.data).toMatchObject({ active: false, inGrace: false });
    const search = await call(app, 'POST', '/v1/search', { headers: { 'x-device-id': DEV_A, authorization: 'Bearer ' + a.result.token }, body: { q: 'x' } });
    expect(search.status).toBe(403);
    expect(search.data && search.data.error).toBe('expired');
  });

  it('an over-limit phone keeps its session: /v1/me says overLimit, search says device_limit', async () => {
    const f = threeDevices();
    const q = quotePurchase(f.state, { kind: 'sub', accountId: f.account, subscriptionId: f.sub, now: NOW + 29 * DAY, withExtras: false });
    const renewed = pay(q.state, q.result.label, '150', NOW + 29 * DAY, 'op-base').state as State;
    const file = join(mkdtempSync(join(tmpdir(), 'omp-pr2-')), 'billing.db');
    writeState(file, realTime(renewed, NOW + 34 * DAY));
    const app = createApp(file, noFetch, { env: {} });
    const meC = await call(app, 'GET', '/v1/me', { headers: { 'x-device-id': DEV_C, authorization: 'Bearer ' + f.tokens.C } });
    expect(meC.status).toBe(200);
    expect(meC.data).toMatchObject({ active: false, overLimit: true, deviceLimit: 2 });
    const bareC = await call(app, 'GET', '/v1/me', { headers: { 'x-device-id': DEV_C } });
    expect(bareC.data).toMatchObject({ active: false, overLimit: true });
    const meA = await call(app, 'GET', '/v1/me', { headers: { 'x-device-id': DEV_A, authorization: 'Bearer ' + f.tokens.A } });
    expect(meA.data).toMatchObject({ active: true, overLimit: false });
    const search = await call(app, 'POST', '/v1/search', { headers: { 'x-device-id': DEV_C, authorization: 'Bearer ' + f.tokens.C }, body: { q: 'x' } });
    expect(search.status).toBe(403);
    expect(search.data && search.data.error).toBe('device_limit');
  });

  it('extra_expired: a phone held only by a lapsed extra slot hears it (token pair); old apps keep device_limit', async () => {
    const f = threeDevices();
    const q = quotePurchase(f.state, { kind: 'sub', accountId: f.account, subscriptionId: f.sub, now: NOW + 29 * DAY, withExtras: false });
    const renewed = pay(q.state, q.result.label, '150', NOW + 29 * DAY, 'op-base').state as State;
    const file = join(mkdtempSync(join(tmpdir(), 'omp-pr2-')), 'billing.db');
    writeState(file, realTime(renewed, NOW + 34 * DAY));
    const app = createApp(file, noFetch, { env: {} });
    // the old token (an app before PR-5) still gets the code it knows
    const legacy = await call(app, 'POST', '/v1/search', { headers: { 'x-device-id': DEV_C, authorization: 'Bearer ' + f.tokens.C }, body: { q: 'x' } });
    expect(legacy.status).toBe(403);
    expect(legacy.data && legacy.data.error).toBe('device_limit');
    // the same phone on the token pair: same status, the precise reason
    const up = await call(app, 'POST', '/v1/token/upgrade', { headers: { 'x-device-id': DEV_C, authorization: 'Bearer ' + f.tokens.C } });
    expect(up.status).toBe(200);
    const access = String((up.data as { accessToken: string }).accessToken);
    const search = await call(app, 'POST', '/v1/search', { headers: { 'x-device-id': DEV_C, authorization: 'Bearer ' + access }, body: { q: 'x' } });
    expect(search.status).toBe(403);
    expect(search.data && search.data.error).toBe('extra_expired');
    // A and B are inside the included devices: nothing changes for them
    const meA = await call(app, 'GET', '/v1/me', { headers: { 'x-device-id': DEV_A, authorization: 'Bearer ' + f.tokens.A } });
    expect(meA.data).toMatchObject({ active: true, overLimit: false });
  });

  it('extra_expired on activation: 409 like device_limit, only for apps that ask for the token pair', async () => {
    const start = paid();
    const a = activate(start.state, { code: start.code, deviceId: DEV_A, now: NOW });
    const second = issueActivation(a.state, { accountId: start.account, now: NOW + 1 });
    const b = activate(second.state, { code: second.result.code, deviceId: DEV_B, now: NOW + 1 });
    const quote = quotePurchase(b.state, { kind: 'dev', accountId: start.account, subscriptionId: start.sub, now: NOW + 2 });
    const bought = pay(quote.state, quote.result.label, '50.00', NOW + 2, 'op-dev');
    // the base is renewed, the extra slot is not: its code was never used
    const q = quotePurchase(bought.state as State, { kind: 'sub', accountId: start.account, subscriptionId: start.sub, now: NOW + 29 * DAY, withExtras: false });
    const renewed = pay(q.state, q.result.label, '150', NOW + 29 * DAY, 'op-base').state as State;
    const late = NOW + 40 * DAY;
    expect(activate(renewed, { code: bought.result.code, deviceId: DEV_C, now: late }).result.error).toBe('device_limit');
    const pairNew = activate(renewed, { code: bought.result.code, deviceId: DEV_C, now: late, legacy: false });
    expect(pairNew.result.error).toBe('extra_expired');
    expect(pairNew.state.attempts[pairNew.state.attempts.length - 1].reason).toBe('extra_expired');

    const file = join(mkdtempSync(join(tmpdir(), 'omp-pr2-')), 'billing.db');
    writeState(file, realTime(renewed, late));
    const app = createApp(file, noFetch, { env: {} });
    const old = await call(app, 'POST', '/v1/activate', { body: { code: bought.result.code, deviceId: DEV_C } });
    expect(old.status).toBe(409);
    expect(old.data && old.data.error).toBe('device_limit');
    const fresh = await call(app, 'POST', '/v1/activate', { body: { code: bought.result.code, deviceId: DEV_C, tokens: 'pair' } });
    expect(fresh.status).toBe(409);
    expect(fresh.data && fresh.data.error).toBe('extra_expired');
  });

  it('no extra slot at all: a full subscription is device_limit for every app', () => {
    const start = paid();
    const a = activate(start.state, { code: start.code, deviceId: DEV_A, now: NOW });
    const second = issueActivation(a.state, { accountId: start.account, now: NOW + 1 });
    const b = activate(second.state, { code: second.result.code, deviceId: DEV_B, now: NOW + 1 });
    const third = issueActivation(b.state, { accountId: start.account, now: NOW + 2 });
    expect(third.result.error).toBe('device_limit');
    // B's code entered on a third phone: the code is someone else's
    expect(activate(b.state, { code: second.result.code, deviceId: DEV_C, now: NOW + 3, legacy: false }).result.error).toBe('other_device');
  });

  it('/v1/yoomoney renewal with an extra slot tells the user both dates in MSK', async () => {
    const f = threeDevices();
    f.state.settings.yoomoneySecret = 'secret';
    const q = quotePurchase(f.state, { kind: 'sub', accountId: f.account, subscriptionId: f.sub, now: NOW });
    const file = join(mkdtempSync(join(tmpdir(), 'omp-pr2-')), 'billing.db');
    writeState(file, q.state);
    const sent: { chat_id: string; text: string }[] = [];
    const net = async (url: string, init?: { body?: string }) => {
      if (String(url).indexOf('/sendMessage') >= 0 && init && init.body) sent.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }), text: async () => '', headers: {}, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const app = createApp(file, net, { env: {} });
    const fields: Record<string, string> = {
      notification_type: 'card-incoming',
      operation_id: 'op-renew',
      amount: '200.00',
      currency: '643',
      datetime: '2026-10-19T00:00:00Z',
      sender: '',
      codepro: 'false',
      label: q.result.label,
      sha1_hash: '',
    };
    fields.sha1_hash = notificationHash(fields, 'secret');
    const res = await call(app, 'POST', '/v1/yoomoney', { form: fields });
    expect(res.status).toBe(200);
    const sub = readState(file).subscriptions[0];
    expect(sub.extraUntil).toBe(sub.paidUntil);
    const user = sent.find((m) => m.chat_id === '42');
    expect(user && user.text).toContain('Подписка продлена до ' + mskDateTime(sub.paidUntil));
    expect(user && user.text).toContain('Доп. устройств: 1, тоже до ' + mskDate(sub.paidUntil));
  });
});

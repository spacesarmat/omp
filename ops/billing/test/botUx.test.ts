import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  botCallback,
  botReply,
  mainKeyboard,
  parseAction,
  paymentAdminNotices,
  paymentUserMessage,
  pendingUserText,
  rejectUserText,
  trialPromo,
} from '../src/bot.mjs';
import { rejectPendingPayment } from '../src/deviceAdmin.mjs';
import {
  activate,
  applyPayment,
  createPromo,
  createSubscription,
  deviceCode,
  ensureTelegramAccount,
  quotePurchase,
  redeemPromo,
  mskDateTime,
  renewalPrice,
  subscriptionView,
} from '../src/logic.mjs';
import { activeRowForCode, touchRow } from '../src/registry.mjs';
import { createApp, pollBot } from '../src/server.mjs';
import { mergeSettings } from '../src/services.mjs';
import { emptyState, readState, registryDb, writeState } from '../src/store.mjs';
import { notificationHash } from '../src/yoomoney.mjs';

const NOW = Date.UTC(2026, 9, 19, 9, 0, 0); // 19.10.2026 12:00 MSK
const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;
const DEV_A = 'a'.repeat(32);
const DEV_B = 'b'.repeat(32);
const DEV_C = 'c'.repeat(32);

type State = ReturnType<typeof emptyState>;
type Msg = { chatId: string; text: string; inline?: { inline_keyboard: { text: string; url?: string; callback_data?: string }[][] } };

/** Account 42 with a 30-day subscription from NOW, `bound` phones bound, `extras` monthly slots. */
function setup({ bound = 2, extras = 0, at = NOW }: { bound?: number; extras?: number; at?: number } = {}) {
  let state: State = emptyState();
  Object.assign(state.settings, { priceRub: 150, extraDeviceRub: 50, periodDays: 30, yoomoneyWallet: '4100', publicOrigin: 'https://billing.example.test' });
  const opened = ensureTelegramAccount(state, '42', at);
  const created = createSubscription(opened.state, { accountId: opened.account.id, now: at, days: 30 });
  state = created.state;
  const sub = created.result.subscriptionId as string;
  if (extras) {
    state = { ...state, subscriptions: state.subscriptions.map((s: { id: string; paidUntil: number }) => (s.id === sub ? { ...s, extraSlots: extras, extraUntil: s.paidUntil } : s)) };
  }
  const tokens: string[] = [];
  const devs = [DEV_A, DEV_B, DEV_C];
  for (let i = 0; i < bound; i++) {
    const slot = deviceCode(state, sub, at);
    const act = activate(slot.state, { code: slot.code, deviceId: devs[i], now: at + i });
    state = act.state;
    tokens.push(act.result.token);
  }
  return { state, sub, account: opened.account.id as string, tokens };
}

function subOf(state: State, id: string) {
  return state.subscriptions.find((s: { id: string }) => s.id === id);
}

function pay(state: State, label: string, amount: string, now: number, op: string) {
  return applyPayment(state, { operationId: op, label, amount, currency: '643', now });
}

function urls(msg: Msg) {
  return ((msg.inline && msg.inline.inline_keyboard) || []).flat().map((b) => b.text + ' → ' + (b.url || b.callback_data || ''));
}

const say = (state: State, text: string, now = NOW, extra: object = {}) => botReply(state, { chatId: '42', text, now, ...extra });

describe('P1-1: an old renewal link never drops a slot bought later', () => {
  it('keeps both slots and moves them to the new end date', () => {
    const f = setup({ bound: 3, extras: 1 });
    const renew = quotePurchase(f.state, { kind: 'sub', accountId: f.account, subscriptionId: f.sub, now: NOW });
    expect(renew.result).toMatchObject({ price: 200, extras: 1 });
    const dev = quotePurchase(renew.state, { kind: 'dev', accountId: f.account, subscriptionId: f.sub, now: NOW });
    const bought = pay(dev.state, dev.result.label, '50', NOW, 'op-dev');
    expect(subOf(bought.state, f.sub).extraSlots).toBe(2);
    const late = pay(bought.state, renew.result.label, '200', NOW + DAY, 'op-old');
    const sub = subOf(late.state, f.sub);
    expect(sub.paidUntil).toBe(NOW + 60 * DAY);
    expect(sub.extraSlots).toBe(2);
    expect(sub.extraUntil).toBe(NOW + 60 * DAY);
    expect(late.result).toMatchObject({ kind: 'renew', extras: 2 });
    expect(subscriptionView(late.state, f.account, NOW + DAY).deviceLimit).toBe(4);
  });

  it('a slot left out of a base-only renewal is paid with the next new one, not extended for free', () => {
    const f = setup({ bound: 3, extras: 1 });
    const base = quotePurchase(f.state, { kind: 'sub', accountId: f.account, subscriptionId: f.sub, now: NOW, withExtras: false });
    const renewed = pay(base.state, base.result.label, '150', NOW, 'op-base').state;
    expect(subOf(renewed, f.sub).extraUntil).toBe(NOW + 30 * DAY);
    const dev = quotePurchase(renewed, { kind: 'dev', accountId: f.account, subscriptionId: f.sub, now: NOW + MIN });
    expect(dev.result).toMatchObject({ price: 100, extras: 2 });
    const screen = say(dev.state, 'Устройства', NOW + MIN);
    const offer = screen.messages[1] as Msg;
    expect(offer.text).toContain('Ещё одно устройство — 100 ₽: 50 ₽ за новое и 50 ₽ × 1 за доп. устройство, не продлённое вместе с подпиской.');
    expect(urls(offer)[0]).toContain('Оплатить 100 ₽');
    // 50 ₽ is not enough for that link.
    expect(pay(dev.state, dev.result.label, '50', NOW + MIN, 'op-short').result.error).toBe('amount');
    const ok = pay(dev.state, dev.result.label, '100', NOW + MIN, 'op-dev2');
    expect(subOf(ok.state, f.sub)).toMatchObject({ extraSlots: 2, extraUntil: NOW + 60 * DAY });
  });
});

describe('P1-2: an extra-slot payment after the end becomes a credit', () => {
  it('credits 50 ₽ after the grace period, shows it and takes it off the next renewal', () => {
    const f = setup({ bound: 2 });
    const dev = quotePurchase(f.state, { kind: 'dev', accountId: f.account, subscriptionId: f.sub, now: NOW });
    const ended = NOW + 40 * DAY;
    const paid = pay(dev.state, dev.result.label, '48.50', ended, 'op-late');
    expect(paid.result).toMatchObject({ kind: 'credit', credit: 50, creditTotal: 50, grace: false });
    const sub = subOf(paid.state, f.sub);
    expect(sub.creditRub).toBe(50);
    expect(sub.extraSlots || 0).toBe(0);
    expect(paid.state.payments[paid.state.payments.length - 1]).toMatchObject({ credited: 50 });
    expect(paid.state.payments[paid.state.payments.length - 1].error).toBeUndefined();
    const note = paymentUserMessage(paid.state, paid.result);
    expect(note.text).toBe(
      '✅ Оплата 50 ₽ получена, но подписка уже закончилась — отдельно доп. устройство не подключить.\n' +
        'Мы зачли 50 ₽: сумма вычтется из следующего продления. Нажмите «Оплатить».',
    );
    // Shown in the cabinet and in «Оплатить».
    expect(say(paid.state, 'Кабинет', ended).messages[0].text).toContain('Зачёт: 50 ₽ — вычтем из следующего продления.');
    const offer = say(paid.state, 'Оплатить', ended).messages[0] as Msg;
    expect(offer.text).toContain('• зачёт — −50 ₽');
    expect(offer.text).toContain('Итого: 100 ₽');
    expect(urls(offer)[0]).toContain('Оплатить 100 ₽');
    expect(renewalPrice(paid.state, sub, ended)).toMatchObject({ gross: 150, credit: 50, total: 100 });
    // Applied: the renewal at 100 ₽ uses the credit up.
    const q = quotePurchase(paid.state, { kind: 'sub', accountId: f.account, subscriptionId: f.sub, now: ended });
    const renewed = pay(q.state, q.result.label, '100', ended, 'op-renew');
    expect(renewed.result).toMatchObject({ kind: 'renew', credit: 50 });
    expect(subOf(renewed.state, f.sub)).toMatchObject({ creditRub: 0, paidUntil: ended + 30 * DAY });
    expect(paymentUserMessage(renewed.state, renewed.result).text).toContain('Зачтено: 50 ₽.');
    // The same 100 ₽ link paid again: the credit is gone, so 100 ₽ no longer covers it.
    const twice = pay(renewed.state, q.result.label, '100', ended + MIN, 'op-renew-2');
    expect(twice.result.error).toBe('amount');
    expect(subOf(twice.state, f.sub).paidUntil).toBe(ended + 30 * DAY);
  });

  it('credits a slot paid in the grace period too (state check on the link)', () => {
    const f = setup({ bound: 2 });
    const dev = quotePurchase(f.state, { kind: 'dev', accountId: f.account, subscriptionId: f.sub, now: NOW });
    expect(dev.state.purchases[0].paidUntil).toBe(NOW + 30 * DAY);
    const grace = NOW + 31 * DAY;
    const paid = pay(dev.state, dev.result.label, '50', grace, 'op-grace');
    expect(paid.result).toMatchObject({ kind: 'credit', grace: true });
    expect(paymentUserMessage(paid.state, paid.result).text).toContain('подписка сейчас в льготном периоде');
    // While the subscription is paid the same kind of link still buys the slot.
    const live = pay(dev.state, dev.result.label, '50', NOW + DAY, 'op-live');
    expect(live.result).toMatchObject({ kind: 'device' });
  });
});

describe('P1-3: grace sells «Продлить + устройство» only', () => {
  it('offers one purchase, counted from the old end date, and gives the new slot a code', () => {
    const f = setup({ bound: 2 });
    const grace = NOW + 31 * DAY;
    const screen = say(f.state, 'Устройства', grace);
    const texts = screen.messages.map((m: Msg) => m.text).join('\n');
    expect(texts).not.toContain('Ещё одно устройство');
    expect(texts).toContain('Сейчас льготный период — отдельно устройство не купить.');
    expect(texts).toContain('Продление на 30 дней, до 18.12.2026 12:00 МСК:');
    expect(texts).toContain('• доп. устройство × 1 — 50 ₽');
    const offer = screen.messages[1] as Msg;
    expect(urls(offer)).toEqual([expect.stringContaining('Продлить + устройство — 200 ₽ → https://yoomoney.ru/')]);
    const quote = screen.state.purchases[screen.state.purchases.length - 1];
    expect(quote).toMatchObject({ kind: 'sub', price: 200, extras: 1, addExtra: 1 });
    const paid = pay(screen.state, 'buy:' + quote.id, '200', grace, 'op-plus');
    const sub = subOf(paid.state, f.sub);
    expect(sub.paidUntil).toBe(NOW + 60 * DAY);
    expect(sub).toMatchObject({ extraSlots: 1, extraUntil: NOW + 60 * DAY });
    expect(paid.result.code).toMatch(/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/);
    const note = paymentUserMessage(paid.state, paid.result);
    expect(note.text).toContain('Подписка продлена до 18.12.2026 12:00 МСК.');
    expect(note.text).toMatch(/Код для нового устройства: `[A-Z0-9]{4}-[A-Z0-9]{4}`/);
  });

  it('with an extra slot already, the grace offer is 250 ₽', () => {
    const f = setup({ bound: 3, extras: 1 });
    const screen = say(f.state, 'Устройства', NOW + 31 * DAY);
    expect(urls(screen.messages[1] as Msg)[0]).toContain('Продлить + устройство — 250 ₽');
  });
});

describe('P1-4: held YooMoney payments', () => {
  it('tells the payer it is held and the admin to confirm, without «unaccepted»', () => {
    const f = setup({ bound: 1 });
    const q = quotePurchase(f.state, { kind: 'sub', accountId: f.account, subscriptionId: f.sub, now: NOW });
    const held = applyPayment(q.state, { operationId: 'op-h', label: q.result.label, amount: '150.00', currency: '643', unaccepted: 'true', now: NOW });
    expect(held.result).toMatchObject({ pending: true, accountId: f.account, amount: '150.00' });
    expect(pendingUserText('150.00')).toBe(
      '⏳ Платёж 150.00 ₽ получен и ждёт подтверждения. Подписка продлится сама — платить ещё раз не нужно.\nЕсли что-то не так — «Поддержка».',
    );
    const admin = paymentAdminNotices({ adminTelegramIds: '99', adminNotify: true }, { pending: true, amount: '150.00', label: q.result.label, who: '42' });
    expect(admin[0].text).toContain('⏳ Платёж 150.00 ₽ ждёт подтверждения. Подписка не продлена.');
    expect(admin[0].text).toContain('Подтвердите в кошельке ЮMoney или кнопкой в панели.');
    expect(admin[0].text).not.toContain('unaccepted');
    const err = paymentAdminNotices({ adminTelegramIds: '99' }, { error: 'amount', amount: '10', label: 'x' });
    expect(err[0].text).toContain('Ошибка оплаты: сумма меньше цены');
    const rejected = rejectPendingPayment(held.state, { operationId: 'op-h', now: NOW + MIN, actor: { kind: 'admin', id: '99', label: '99' } });
    expect(rejected.result).toMatchObject({ ok: true, accountId: f.account, amount: '150.00' });
    expect(rejectUserText('150.00')).toContain('Платёж 150.00 ₽ не подтверждён — подписка не продлена.');
  });

  it('the webhook sends the ⏳ message to the payer in Telegram', async () => {
    const f = setup({ bound: 1 });
    f.state.settings.yoomoneySecret = 'secret';
    f.state.settings.botToken = 'test-token';
    f.state.settings.adminNotify = false;
    const q = quotePurchase(f.state, { kind: 'sub', accountId: f.account, subscriptionId: f.sub, now: NOW });
    const file = join(mkdtempSync(join(tmpdir(), 'omp-ux-')), 'billing.db');
    writeState(file, q.state);
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    const net = async (url: string, init: { body?: string }) => {
      sent.push({ url, body: init && init.body ? JSON.parse(init.body) : {} });
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
    };
    const app = createApp(file, net, { env: {} });
    const fields: Record<string, string> = {
      notification_type: 'card-incoming',
      operation_id: 'op-wh',
      amount: '150.00',
      currency: '643',
      datetime: '2026-10-19T00:00:00Z',
      sender: '',
      codepro: 'false',
      label: q.result.label,
      unaccepted: 'true',
      sha1_hash: '',
    };
    fields.sha1_hash = notificationHash(fields, 'secret');
    const payload = new URLSearchParams(fields).toString();
    const res = { status: 0, headers: {}, body: '', writeHead(s: number) { this.status = s; }, setHeader() {}, end(b?: string) { this.body = String(b || ''); } };
    await app(
      {
        method: 'POST',
        url: '/v1/yoomoney',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        socket: { remoteAddress: '127.0.0.1' },
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(payload);
        },
      },
      res,
    );
    expect(res.status).toBe(200);
    const toUser = sent.filter((c) => c.url.endsWith('/sendMessage') && c.body.chat_id === '42');
    expect(toUser).toHaveLength(1);
    expect(String(toUser[0].body.text)).toContain('⏳ Платёж 150.00 ₽ получен и ждёт подтверждения.');
    expect(readState(file).payments[0].pending).toBe(true);
  });
});

describe('trial day, gift days, menu', () => {
  it('mentions the trial day only while the public promo exists and has uses', () => {
    const f = setup({ bound: 0 });
    const fresh = { ...f.state, subscriptions: [], codes: [] };
    expect(say(fresh, 'Кабинет').messages[0].text).not.toContain('Пробный день');
    expect(say(fresh, 'Цены').messages[0].text).not.toContain('Пробный день');
    fresh.settings = mergeSettings(fresh.settings, { publicPromo: 'demo-1' });
    expect(fresh.settings.publicPromo).toBe('DEMO1');
    // Set but not created yet: still hidden.
    expect(trialPromo(fresh)).toBe('');
    const made = createPromo(fresh, { code: 'DEMO1', days: 1, maxUses: 1, now: NOW }).state;
    expect(say(made, 'Кабинет').messages[0].text).toContain('Пробный день — промокод DEMO1 в «Промокод».');
    const used = redeemPromo(made, { code: 'DEMO1', accountId: f.account, now: NOW }).state;
    expect(trialPromo(used)).toBe('');
  });

  it('gift days in grace count from now, a paid renewal from the old date', () => {
    const f = setup({ bound: 1 });
    const grace = NOW + 31 * DAY;
    const promo = createPromo(f.state, { code: 'GIFT1', days: 1, maxUses: 1, now: NOW }).state;
    const gift = redeemPromo(promo, { code: 'GIFT1', accountId: f.account, now: grace });
    expect(subOf(gift.state, f.sub).paidUntil).toBe(grace + DAY);
    const q = quotePurchase(f.state, { kind: 'sub', accountId: f.account, subscriptionId: f.sub, now: grace });
    expect(subOf(pay(q.state, q.result.label, '150', grace, 'op-g').state, f.sub).paidUntil).toBe(NOW + 60 * DAY);
  });

  it('has 6 buttons and keeps the old labels as aliases', () => {
    expect(mainKeyboard().keyboard.flat().map((b: { text: string }) => b.text)).toEqual(['Кабинет', 'Оплатить', 'Устройства', 'Промокод', 'Цены', 'Поддержка']);
    expect(parseAction('Подписка').action).toBe('pay');
    expect(parseAction('Продлить').action).toBe('pay');
    expect(parseAction('Код').action).toBe('devices');
    expect(parseAction('Отвязать').action).toBe('devices');
    expect(parseAction('/start renew').action).toBe('pay');
    expect(parseAction('/Start@OMPBILLINGBOT').action).toBe('cabinet');
    expect(parseAction('/start something-old').action).toBe('cabinet');
  });

  it('the post-grace cabinet says search is off and points to «Оплатить»', () => {
    const f = setup({ bound: 2 });
    const text = say(f.state, 'Кабинет', NOW + 40 * DAY).messages[0].text;
    expect(text).toContain('Подписка закончилась 18.11.2026 12:00 МСК — поиск отключён на всех устройствах.');
    expect(text).toContain('Привязано устройств: 2. После оплаты они заработают сами, код вводить не нужно.');
    expect(text).toContain('Нажмите «Оплатить».');
    expect(text).not.toContain('«Код»');
    expect(say(f.state, 'Устройства', NOW + 40 * DAY).messages[0].text).toContain('Нажмите «Оплатить» — устройства заработают сами.');
  });

  it('the new-subscription message has the end date and the code with a hyphen', () => {
    const f = setup({ bound: 0 });
    const fresh = { ...f.state, subscriptions: [], codes: [] };
    const q = quotePurchase(fresh, { kind: 'new', accountId: f.account, now: NOW });
    const paid = pay(q.state, q.result.label, '150', NOW, 'op-new');
    const note = paymentUserMessage(paid.state, paid.result);
    expect(note.text).toContain('✅ Оплата получена. Подписка до 18.11.2026 12:00 МСК, до 2 телефонов.');
    expect(note.text).toMatch(/Код подписки: `[A-Z0-9]{4}-[A-Z0-9]{4}`/);
    expect(note.text).toContain('На ТВ подписка не нужна.');
    expect(note.inline.inline_keyboard[0][0].url).toMatch(/\/go\/[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });
});

describe('admin /grant and support limit', () => {
  it('never creates an account, resolves @nick and tells the user', () => {
    const f = setup({ bound: 1 });
    f.state.settings.adminTelegramIds = '99';
    const named = botReply(f.state, { chatId: '42', text: '/start', now: NOW, from: { username: 'tester', firstName: 'T' } }).state;
    const before = named.accounts.length;
    const typo = botReply(named, { chatId: '99', text: '/grant 11 30', now: NOW });
    expect(typo.messages[0].text).toContain('Не найден пользователь «11»');
    expect(typo.messages[0].text).toContain('Новый аккаунт не создан.');
    // Only the admin's own account (from writing to the bot) is new.
    expect(typo.state.accounts.filter((a: { telegramId: string }) => a.telegramId === '11')).toHaveLength(0);
    expect(typo.state.accounts.length).toBe(before + 1);
    expect(botReply(named, { chatId: '99', text: '/grant @tester abc', now: NOW }).messages[0].text).toContain('Нужно целое число дней');
    const ok = botReply(named, { chatId: '99', text: '/grant @Tester 30', now: NOW });
    expect(subOf(ok.state, f.sub).paidUntil).toBe(NOW + 60 * DAY);
    const toUser = ok.messages.find((m: Msg) => m.chatId === '42');
    expect(toUser.text).toContain('Вам добавлено 30 дней. Подписка до 18.12.2026 12:00 МСК.');
    expect(toUser.text).toMatch(/`[A-Z0-9]{4}-[A-Z0-9]{4}`/);
    const toAdmin = ok.messages.find((m: Msg) => m.chatId === '99');
    expect(toAdmin.text).toContain('Выдано +30 дней — @tester · 42');
  });

  it('forwards at most 5 support messages per 10 minutes', () => {
    let state = setup({ bound: 0 }).state;
    state.settings.adminTelegramIds = '99';
    for (let i = 0; i < 5; i++) {
      const out = say(state, '/support вопрос ' + i, NOW + i * 1000);
      expect(out.messages.some((m: Msg) => m.chatId === '99')).toBe(true);
      state = out.state;
    }
    const sixth = say(state, '/support ещё', NOW + 6000);
    expect(sixth.messages).toHaveLength(1);
    expect(sixth.messages[0].text).toContain('Слишком много сообщений подряд');
    expect(say(state, '/support потом', NOW + 11 * MIN).messages.some((m: Msg) => m.chatId === '99')).toBe(true);
  });
});

describe('pollBot: groups and inline buttons', () => {
  function harness(state: State, updates: unknown[]) {
    const file = join(mkdtempSync(join(tmpdir(), 'omp-ux-poll-')), 'billing.db');
    state.settings.botToken = 'poll-token';
    state.settings.adminNotify = false;
    writeState(file, state);
    const calls: { method: string; body: Record<string, unknown> }[] = [];
    let served = false;
    const net = async (url: string, init: { body?: string }) => {
      const method = url.split('/').pop()!.split('?')[0];
      calls.push({ method, body: init && init.body ? JSON.parse(init.body) : {} });
      if (method === 'getUpdates') {
        const result = served ? [] : updates;
        served = true;
        return { ok: true, status: 200, json: async () => ({ ok: true, result }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 7 } }) };
    };
    return { file, calls, net };
  }

  it('ignores a group chat completely', async () => {
    const h = harness(emptyState(), [{ update_id: 1, message: { message_id: 1, chat: { id: -100500, type: 'supergroup' }, from: { id: 5 }, text: '/start' } }]);
    await pollBot(h.file, h.net, { maxLoops: 1, sleep: async () => {} });
    expect(h.calls.filter((c) => c.method === 'sendMessage')).toEqual([]);
    expect(readState(h.file).accounts).toEqual([]);
  });

  it('answers a button, asks to confirm, then unbinds and clears the confirm buttons', async () => {
    const f = setup({ bound: 2 });
    const codeId = f.state.codes.find((c: { deviceId: string }) => c.deviceId === DEV_A).id;
    const cq = (id: string, data: string) => ({
      update_id: Number(id),
      callback_query: { id, data, from: { id: 42 }, message: { message_id: 70, chat: { id: 42, type: 'private' } } },
    });
    const ask = harness(f.state, [cq('11', 'u1:' + codeId)]);
    await pollBot(ask.file, ask.net, { maxLoops: 1, sleep: async () => {} });
    expect(ask.calls.filter((c) => c.method === 'answerCallbackQuery')).toHaveLength(1);
    expect(ask.calls.filter((c) => c.method === 'editMessageReplyMarkup')).toEqual([]);
    const question = ask.calls.find((c) => c.method === 'sendMessage')!;
    expect(String(question.body.text)).toContain('Отвязать устройство 1 (aaaaaaaa…)?');

    const yes = harness(f.state, [cq('12', 'y1:' + codeId + ':aaaaaaaa'), cq('13', 'y1:' + codeId + ':aaaaaaaa')]);
    await pollBot(yes.file, yes.net, { maxLoops: 1, sleep: async () => {} });
    const answers = yes.calls.filter((c) => c.method === 'answerCallbackQuery').map((c) => c.body.text);
    expect(answers).toEqual(['Отвязано', 'Устройство уже отвязано или сменилось.']);
    expect(yes.calls.filter((c) => c.method === 'editMessageReplyMarkup')).toHaveLength(2);
    const after = readState(yes.file);
    expect(after.codes.find((c: { id: string }) => c.id === codeId).deviceId).toBe('');
    expect(after.subscriptions[0].swaps).toHaveLength(1);

    // A button pressed by someone else in a forwarded message, or in a group, changes nothing.
    const foreign = harness(f.state, [{ update_id: 20, callback_query: { id: '20', data: 'ya:x', from: { id: 77 }, message: { message_id: 1, chat: { id: 42, type: 'private' } } } }]);
    await pollBot(foreign.file, foreign.net, { maxLoops: 1, sleep: async () => {} });
    expect(foreign.calls.filter((c) => c.method === 'sendMessage')).toEqual([]);
    expect(foreign.calls.filter((c) => c.method === 'answerCallbackQuery')).toHaveLength(1);
  });
});

describe('«Устройства» from the device registry', () => {
  type Info = (codeId: string) => { name: string; lastSeenAt: number } | null;
  const devicesText = (state: State, now: number, info?: Info) => String(say(state, 'Устройства', now, info ? { info } : {}).messages[0].text);

  it('shows the device name and when it was last online; without the registry, the binding date', () => {
    const f = setup({ bound: 2 });
    const idA = f.state.codes.find((c: { deviceId: string }) => c.deviceId === DEV_A).id;
    const seen = NOW + 30 * MIN;
    const info: Info = (id) => (id === idA ? { name: 'Pixel 8', lastSeenAt: seen } : null);
    const text = devicesText(f.state, NOW + 2 * 60 * MIN, info);
    expect(text).toContain('1) Pixel 8 aaaaaaaa… · в сети ' + mskDateTime(seen));
    expect(text).toContain('2) bbbbbbbb… · привязано ');
    expect(devicesText(f.state, NOW + 2 * 60 * MIN)).not.toContain('в сети');
  });

  it('says why an over-limit phone does not work: lapsed extra slot vs the limit itself', () => {
    const f = setup({ bound: 3, extras: 1 });
    const lapsed = { ...f.state, subscriptions: f.state.subscriptions.map((s: object) => ({ ...s, extraUntil: NOW + DAY })) };
    const view = subscriptionView(lapsed, f.account, NOW + 5 * DAY);
    expect(view.devices.map((d: { overReason: string }) => d.overReason)).toEqual(['', '', 'extra_expired']);
    expect(devicesText(lapsed, NOW + 5 * DAY)).toContain('3) cccccccc… · не работает: доп. устройство не продлено');

    const cut = { ...f.state, subscriptions: f.state.subscriptions.map((s: object) => ({ ...s, limitOverride: 1, extraSlots: 0, extraUntil: 0 })) };
    expect(subscriptionView(cut, f.account, NOW).devices.map((d: { overReason: string }) => d.overReason)).toEqual(['', 'device_limit', 'device_limit']);
    expect(devicesText(cut, NOW)).toContain('2) bbbbbbbb… · не работает: сверх лимита устройств');
  });

  it('the polling bot reads name and last seen from billing.db', async () => {
    const f = setup({ bound: 1 });
    const file = join(mkdtempSync(join(tmpdir(), 'omp-ux-reg-')), 'billing.db');
    f.state.settings.botToken = 'poll-token';
    f.state.settings.adminNotify = false;
    writeState(file, f.state);
    const codeId = f.state.codes.find((c: { deviceId: string }) => c.deviceId === DEV_A).id;
    const db = registryDb(file);
    const row = activeRowForCode(db, codeId);
    const seen = Date.now() - 5 * MIN;
    db.prepare('UPDATE devices SET name = ? WHERE id = ?').run('Kitchen phone', row.id);
    touchRow(db, row.id, { ip: '', now: seen, force: true });
    const sent: string[] = [];
    let served = false;
    const net = async (url: string, init: { body?: string }) => {
      const method = url.split('/').pop()!.split('?')[0];
      const body = init && init.body ? JSON.parse(init.body) : {};
      if (method === 'sendMessage') sent.push(String(body.text));
      if (method === 'getUpdates') {
        const result = served ? [] : [{ update_id: 1, message: { message_id: 1, chat: { id: 42, type: 'private' }, from: { id: 42 }, text: 'Устройства' } }];
        served = true;
        return { ok: true, status: 200, json: async () => ({ ok: true, result }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 7 } }) };
    };
    await pollBot(file, net, { maxLoops: 1, sleep: async () => {} });
    expect(sent.join('\n')).toContain('1) Kitchen phone aaaaaaaa… · в сети ' + mskDateTime(seen));
  });
});

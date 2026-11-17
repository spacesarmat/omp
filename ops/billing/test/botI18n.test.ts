import { describe, expect, it } from 'vitest';
import {
  CATALOG,
  bodyFor,
  normalizeLang,
  pickVariant,
  sampleVars,
  str,
  stringIds,
  templateById,
  variablesIn,
} from '../src/botCopy.mjs';
import {
  botReply,
  grantUserMessage,
  mainKeyboard,
  paymentUserMessage,
  pendingUserText,
  rejectUserText,
  reminderMessage,
} from '../src/bot.mjs';
import {
  activate,
  applyPayment,
  createSubscription,
  deviceCode,
  ensureTelegramAccount,
  quotePurchase,
} from '../src/logic.mjs';
import { emptyState } from '../src/state.mjs';

const NOW = Date.UTC(2026, 9, 19, 9, 0, 0); // 19.10.2026 12:00 MSK
const DAY = 24 * 60 * 60 * 1000;
const DEV_A = 'a'.repeat(32);

type State = ReturnType<typeof emptyState>;

/** An account with a 30-day subscription and one bound phone. `lang` is stored on the account. */
function setup(lang: string) {
  let state: State = emptyState();
  Object.assign(state.settings, { priceRub: 150, extraDeviceRub: 50, periodDays: 30, yoomoneyWallet: '4100', publicOrigin: 'https://billing.example.test' });
  const opened = ensureTelegramAccount(state, '42', NOW);
  state = { ...opened.state, accounts: opened.state.accounts.map((a: { id: string }) => ({ ...a, lang })) };
  const created = createSubscription(state, { accountId: opened.account.id, now: NOW, days: 30 });
  state = created.state;
  const sub = created.result.subscriptionId as string;
  const slot = deviceCode(state, sub, NOW);
  const act = activate(slot.state, { code: slot.code, deviceId: DEV_A, now: NOW });
  state = act.state;
  return { state, sub, account: opened.account.id as string };
}

function pay(state: State, label: string, amount: string, now: number, op: string) {
  return applyPayment(state, { operationId: op, label, amount, currency: '643', now });
}

describe('bilingual catalog completeness', () => {
  it('every template has a non-empty RU and EN body with the same variables', () => {
    expect(CATALOG.length).toBeGreaterThan(50);
    for (const row of CATALOG) {
      expect(row.body.trim(), row.id).not.toBe('');
      expect(row.bodyEn.trim(), row.id).not.toBe('');
      expect(variablesIn(row.bodyEn).sort(), row.id).toEqual(variablesIn(row.body).sort());
    }
  });

  it('every plain UI string has a non-empty RU and EN value', () => {
    const ids = stringIds();
    expect(ids.length).toBeGreaterThan(100);
    for (const id of ids) {
      expect(str(id, '').trim(), id).not.toBe('');
      expect(str(id, 'en').trim(), id).not.toBe('');
    }
  });

  it('keeps RU and EN texts free of em and en dashes', () => {
    const blob = JSON.stringify(CATALOG) + stringIds().map((id) => str(id, '') + str(id, 'en')).join('');
    expect(blob).not.toContain('\u2014');
    expect(blob).not.toContain('\u2013');
  });

  it('bodyFor picks EN for en and RU for ru, absent or unsupported language', () => {
    const tpl = templateById('pay.received_new')!;
    expect(bodyFor(tpl, 'en')).toBe(tpl.bodyEn);
    expect(bodyFor(tpl, 'ru')).toBe(tpl.body);
    expect(bodyFor(tpl, '')).toBe(tpl.body);
    expect(bodyFor(tpl, 'de')).toBe(tpl.body);
  });

  it('sampleVars localizes the preview samples for en', () => {
    const tpl = templateById('cabinet.home')!;
    expect(sampleVars(tpl, 'en').status).toContain('MSK');
    expect(sampleVars(tpl, '').status).toContain('МСК');
    expect(sampleVars(tpl, 'en').name).toBe('Ann');
  });
});

describe('strict language default is preserved', () => {
  it('normalizeLang still maps only ru/en, everything else to empty', () => {
    expect(normalizeLang('en-US')).toBe('en');
    expect(normalizeLang('ru')).toBe('ru');
    expect(normalizeLang('uk')).toBe('');
    expect(normalizeLang('de')).toBe('');
  });

  it('an unsupported language uses only the default variant, never a state-only one', () => {
    const rows = [
      { subState: '', lang: '', body: 'default' },
      { subState: 'active', lang: '', body: 'active-default-lang' },
      { subState: '', lang: 'ru', body: 'ru' },
    ];
    expect(pickVariant(rows, 'active', normalizeLang('uk'))?.body).toBe('default');
    expect(pickVariant(rows, 'active', '')?.body).toBe('default');
    expect(pickVariant(rows, 'active', 'ru')?.body).toBe('ru');
  });

  it('str falls back to RU for an unsupported or absent language', () => {
    expect(str('btn.pay', 'en')).toBe('Pay');
    expect(str('btn.pay', 'ru')).toBe('Оплатить');
    expect(str('btn.pay', '')).toBe('Оплатить');
    expect(str('btn.pay', 'uk')).toBe('Оплатить');
  });
});

describe('EN payment and service messages', () => {
  it('renders a new-subscription payment in EN with the code and MSK date', () => {
    const f = setup('en');
    const fresh = { ...f.state, subscriptions: [], codes: [] };
    const q = quotePurchase(fresh, { kind: 'new', accountId: f.account, now: NOW });
    const paid = pay(q.state, q.result.label, '150', NOW, 'op-new');
    const note = paymentUserMessage(paid.state, paid.result)!;
    expect(note.text).toContain('✅ Payment received. Subscription until 18.11.2026 12:00 MSK, up to 2 phones.');
    expect(note.text).toMatch(/Subscription code: `[A-Z0-9]{4}-[A-Z0-9]{4}`/);
    expect(note.text).toContain('The TV does not need a subscription.');
    expect(note.text).not.toContain('МСК');
    expect(note.keyboard.keyboard.flat().map((b: { text: string }) => b.text)).toContain('Pay');
  });

  it('renders a renewal in EN', () => {
    const f = setup('en');
    const q = quotePurchase(f.state, { kind: 'sub', accountId: f.account, subscriptionId: f.sub, now: NOW });
    const paid = pay(q.state, q.result.label, '150', NOW, 'op-renew');
    const note = paymentUserMessage(paid.state, paid.result)!;
    expect(note.text).toContain('✅ Payment received. Subscription renewed until 18.12.2026 12:00 MSK.');
    expect(note.text).toContain('Linked devices keep working - there is nothing to enter.');
  });

  it('renders a credit after the end in EN', () => {
    const f = setup('en');
    const dev = quotePurchase(f.state, { kind: 'dev', accountId: f.account, subscriptionId: f.sub, now: NOW });
    const paid = pay(dev.state, dev.result.label, '48.50', NOW + 40 * DAY, 'op-late');
    const note = paymentUserMessage(paid.state, paid.result)!;
    expect(note.text).toContain('✅ Payment of 50 ₽ received, but the subscription has already ended.');
    expect(note.text).toContain('We credited 50 ₽: the sum will be deducted from the next renewal. Press "Pay".');
  });

  it('renders a repeat-discount credit in EN', () => {
    const f = setup('en');
    const note = paymentUserMessage(
      f.state,
      { kind: 'credit', reason: 'repeat_discount', credit: 150, creditTotal: 150, paidUntil: NOW + 30 * DAY, subscriptionId: f.sub },
      'en',
    )!;
    expect(note.text).toContain('kept as credit: the referral discount is one-time');
    expect(note.text).toContain('will be deducted from the next renewal. Subscription until 18.11.2026 12:00 MSK.');
  });

  it('renders pending and rejected payments in EN', () => {
    expect(pendingUserText('150.00', 'en')).toBe(
      '⏳ Payment 150.00 ₽ received and awaiting confirmation. The subscription will renew on its own - there is no need to pay again.\nIf something is wrong - "Support".',
    );
    expect(rejectUserText('150.00', 'en')).toContain('Payment 150.00 ₽ was not confirmed - the subscription was not renewed.');
    expect(rejectUserText('150.00', 'en')).toContain('write to "Support".');
  });

  it('renders a grant in EN', () => {
    const note = grantUserMessage('https://billing.example.test', { days: 30, paidUntil: NOW + 60 * DAY, code: 'ABCD-EF12' }, 'en');
    expect(note.text).toContain('You were granted 30 days. Subscription until 18.12.2026 12:00 MSK.');
    expect(note.text).toMatch(/Code for a new device: `[A-Z0-9]{4}-[A-Z0-9]{4}`/);
  });

  it('RU messages stay identical when no language is given', () => {
    const f = setup('');
    const dev = quotePurchase(f.state, { kind: 'dev', accountId: f.account, subscriptionId: f.sub, now: NOW });
    const paid = pay(dev.state, dev.result.label, '48.50', NOW + 40 * DAY, 'op-late');
    expect(paymentUserMessage(paid.state, paid.result)!.text).toBe(
      '✅ Оплата 50 ₽ получена, но подписка уже закончилась.\n' +
        'Доп. устройство можно купить только вместе с активной подпиской.\n' +
        'Мы зачли 50 ₽: сумма вычтется из следующего продления. Нажмите «Оплатить».',
    );
    expect(pendingUserText('150.00')).toContain('⏳ Платёж 150.00 ₽ получен и ждёт подтверждения.');
  });
});

describe('EN reminders and keyboards', () => {
  it('renders a 3-day reminder in EN for an EN account', () => {
    const f = setup('en');
    const row = { subscriptionId: f.sub, accountId: f.account, telegramId: '42', kind: 'd3', paidUntil: NOW + 30 * DAY };
    const msg = reminderMessage(f.state, row, NOW + 27 * DAY);
    expect(msg.text).toContain('⚠️ Your OMP subscription ends in 3 days - 18.11.2026 at 12:00 MSK.');
    expect(msg.text).toContain('Press "Pay" - the payment link will arrive in this chat.');
    expect(msg.inline.inline_keyboard[0][0].text).toBe('Pay');
    expect(msg.keyboard.keyboard.flat().map((b: { text: string }) => b.text)).toContain('Account');
  });

  it('renders a grace-end notice in EN', () => {
    const f = setup('en');
    const row = { subscriptionId: f.sub, accountId: f.account, telegramId: '42', kind: 'end', paidUntil: NOW + 30 * DAY };
    const msg = reminderMessage(f.state, row, NOW + 40 * DAY);
    expect(msg.text).toContain('⚠️ The grace period has ended - OMP search is disabled.');
    expect(msg.text).toContain('Press "Pay"');
  });

  it('RU reminder stays identical for a RU account', () => {
    const f = setup('');
    const row = { subscriptionId: f.sub, accountId: f.account, telegramId: '42', kind: 'd3', paidUntil: NOW + 30 * DAY };
    const msg = reminderMessage(f.state, row, NOW + 27 * DAY);
    expect(msg.text).toContain('⚠️ Подписка OMP заканчивается через 3 дня - 18.11.2026 в 12:00 МСК.');
    expect(msg.inline.inline_keyboard[0][0].text).toBe('Оплатить');
  });

  it('mainKeyboard localizes labels and keeps RU by default', () => {
    expect(mainKeyboard('en').keyboard.flat().map((b: { text: string }) => b.text)).toEqual([
      'Account', 'Pay', 'Devices', 'Promo code', 'Prices', 'Support', 'Support the project',
    ]);
    expect(mainKeyboard().keyboard.flat().map((b: { text: string }) => b.text)).toEqual([
      'Кабинет', 'Оплатить', 'Устройства', 'Промокод', 'Цены', 'Поддержка', 'Поддержать проект',
    ]);
  });
});

describe('EN base fallback without a saved template', () => {
  it('an EN subscriber gets the EN in-code cabinet and pay screen (no saved variant)', () => {
    const f = setup('en');
    const cab = botReply(f.state, { chatId: '42', text: 'Account', now: NOW, from: { lang: 'en-US' } });
    expect(cab.messages[0].text).toContain('Account');
    expect(cab.messages[0].text).toContain('Subscription until 18.11.2026 12:00 MSK');
    expect(cab.messages[0].text).toContain('Devices: 1 of 2');
    expect(cab.messages[0].text).not.toContain('МСК');
    const price = botReply(f.state, { chatId: '42', text: 'Prices', now: NOW, from: { lang: 'en-US' } });
    expect(price.messages[0].text).toContain('OMP subscription - 150 ₽ for 30 days, up to 2 phones: search in Jackett and JacRed.');
    expect(price.messages[0].text).toContain('The subscription is only needed on the phone - the TV does not need it.');
  });

  it('an unsupported language falls back to the RU cabinet', () => {
    const f = setup('uk');
    const cab = botReply(f.state, { chatId: '42', text: 'Кабинет', now: NOW, from: { lang: 'uk' } });
    expect(cab.messages[0].text).toContain('Личный кабинет');
    expect(cab.messages[0].text).toContain('Подписка до 18.11.2026 12:00 МСК');
    expect(cab.messages[0].keyboard.keyboard.flat().map((b: { text: string }) => b.text)).toContain('Кабинет');
  });
});
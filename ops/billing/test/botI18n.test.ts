import { describe, expect, it } from 'vitest';
import {
  CATALOG,
  LANG_CODES,
  bodyFor,
  normalizeLang,
  pickVariant,
  renderBody,
  sampleVars,
  str,
  stringIds,
  stringRow,
  templateById,
  variablesIn,
} from '../src/botCopy.mjs';
import { LANG_PACKS } from '../src/botCopyLangs/index.mjs';
import {
  botCallback,
  botReply,
  daysText,
  grantUserMessage,
  mainKeyboard,
  parseAction,
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
  it('normalizeLang maps ru/en prefixes and unsupported codes to empty', () => {
    expect(normalizeLang('en-US')).toBe('en');
    expect(normalizeLang('ru')).toBe('ru');
    expect(normalizeLang('de')).toBe('');
    expect(normalizeLang('fr')).toBe('');
  });

  it('an unsupported language uses only the default variant, never a state-only one', () => {
    const rows = [
      { subState: '', lang: '', body: 'default' },
      { subState: 'active', lang: '', body: 'active-default-lang' },
      { subState: '', lang: 'ru', body: 'ru' },
    ];
    expect(pickVariant(rows, 'active', normalizeLang('de'))?.body).toBe('default');
    expect(pickVariant(rows, 'active', '')?.body).toBe('default');
    expect(pickVariant(rows, 'active', 'ru')?.body).toBe('ru');
  });

  it('str falls back to RU for an unsupported or absent language', () => {
    expect(str('btn.pay', 'en')).toBe('Pay');
    expect(str('btn.pay', 'ru')).toBe('Оплатить');
    expect(str('btn.pay', '')).toBe('Оплатить');
    expect(str('btn.pay', 'de')).toBe('Оплатить');
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
    const f = setup('de');
    const cab = botReply(f.state, { chatId: '42', text: 'Кабинет', now: NOW, from: { lang: 'de' } });
    expect(cab.messages[0].text).toContain('Личный кабинет');
    expect(cab.messages[0].text).toContain('Подписка до 18.11.2026 12:00 МСК');
    expect(cab.messages[0].keyboard.keyboard.flat().map((b: { text: string }) => b.text)).toContain('Кабинет');
  });
});

describe('donate pay button matches the chosen method', () => {
  function donateState(lang: string) {
    const opened = ensureTelegramAccount(emptyState(), '42', NOW);
    const state = opened.state;
    state.settings.yoomoneyWallet = '410011111111111';
    state.settings.donate = { enabled: true, amounts: '100', minRub: 50, maxRub: 15000, yoomoney: true };
    state.accounts = state.accounts.map((a: { id: string }) => ({ ...a, lang }));
    return state;
  }

  function lock(lang: string, method: string) {
    const from = lang === 'en' ? { lang: 'en-US' } : { firstName: 'Анна' };
    const menu = botReply(donateState(lang), { chatId: '42', text: '/donate', now: NOW, from });
    const picked = botCallback(menu.state, { chatId: '42', data: 'dn:a:100', now: NOW, lang: from.lang });
    const draft = picked.state.donations.find((d: { amountRub: number }) => d.amountRub === 100);
    const skipped = botCallback(picked.state, { chatId: '42', data: 'dn:s:' + draft.id, now: NOW, lang: from.lang });
    const named = botCallback(skipped.state, { chatId: '42', data: 'dn:n:' + draft.id + ':0', now: NOW, lang: from.lang });
    return botCallback(named.state, { chatId: '42', data: 'dn:p:' + draft.id + ':' + method, now: NOW, lang: from.lang });
  }

  it('RU: AC gives a card button and message, PC gives wallet', () => {
    const ac = lock('', 'AC');
    expect(ac.messages[0].text).toContain('Карта - ');
    expect(ac.messages[0].inline.inline_keyboard[0][0].text).toContain('Карта - ');
    expect(ac.messages[0].inline.inline_keyboard[0][0].url).toContain('paymentType=AC');
    const pc = lock('', 'PC');
    expect(pc.messages[0].text).toContain('Кошелёк - ');
    expect(pc.messages[0].inline.inline_keyboard[0][0].text).toContain('Кошелёк - ');
  });

  it('EN: AC gives Card (not Wallet), PC gives Wallet', () => {
    const ac = lock('en', 'AC');
    expect(ac.messages[0].text).toContain('Card - ');
    expect(ac.messages[0].inline.inline_keyboard[0][0].text).toContain('Card - ');
    expect(ac.messages[0].text).not.toContain('Wallet');
    const pc = lock('en', 'PC');
    expect(pc.messages[0].text).toContain('Wallet - ');
    expect(pc.messages[0].inline.inline_keyboard[0][0].text).toContain('Wallet - ');
  });
});

describe('support notice to admins stays RU', () => {
  it('an EN subscriber support message notifies admins in RU with RU buttons', () => {
    let state = emptyState();
    state.settings.adminTelegramIds = '99';
    const opened = ensureTelegramAccount(state, '42', NOW);
    state = { ...opened.state, accounts: opened.state.accounts.map((a: { id: string }) => ({ ...a, lang: 'en' })) };
    const out = botReply(state, { chatId: '42', text: '/support hello', now: NOW, from: { lang: 'en-US' } });
    const toAdmin = out.messages.find((m: { chatId: string }) => m.chatId === '99')!;
    expect(toAdmin.text).toContain('Поддержка · ');
    expect(toAdmin.text).toContain('Ответьте на это сообщение');
    const keys = toAdmin.keyboard.keyboard.flat().map((b: { text: string }) => b.text);
    expect(keys).toContain('Сводка');
    expect(keys).not.toContain('Summary');
    // The subscriber's own confirmation keeps their language.
    const toUser = out.messages.find((m: { chatId: string }) => m.chatId === '42')!;
    expect(toUser.text).toContain('The message was passed to the administrator');
  });
});

describe('admin find localizes the limit breakdown and code label', () => {
  function findState() {
    let state = emptyState();
    state.settings.adminTelegramIds = '99';
    Object.assign(state.settings, { priceRub: 150, periodDays: 30 });
    const opened = ensureTelegramAccount(state, '42', NOW);
    const created = createSubscription(opened.state, { accountId: opened.account.id, now: NOW, days: 30 });
    state = created.state;
    const sub = created.result.subscriptionId as string;
    state = { ...state, subscriptions: state.subscriptions.map((s: { id: string }) => (s.id === sub ? { ...s, limitOverride: 3 } : s)) };
    state = deviceCode(state, sub, NOW).state; // a free code with a plain value, so the card reveals it
    return state;
  }

  it('EN admin finds a custom-limit account: EN limit text and EN free-code HTML', () => {
    const out = botReply(findState(), { chatId: '99', text: '/find 42', now: NOW, from: { lang: 'en-US' }, pad: 'admin' });
    const msg = out.messages[0];
    expect(msg.text).toContain('(custom limit)');
    expect(msg.text).not.toContain('индивидуальный лимит');
    expect(msg.text).toContain('Free code: ');
    expect(msg.copy.vars.code).toContain('Free code: <code>');
  });

  it('RU admin find keeps the RU limit text and code label unchanged', () => {
    const out = botReply(findState(), { chatId: '99', text: '/find 42', now: NOW, pad: 'admin' });
    const msg = out.messages[0];
    expect(msg.text).toContain('(индивидуальный лимит)');
    expect(msg.text).not.toContain('custom limit');
    expect(msg.text).toContain('Свободный код: ');
    expect(msg.copy.vars.code).toContain('Свободный код: <code>');
  });
});

describe('referral notice words follow the selected template language', () => {
  it('daysText declines in RU by default and uses day/days in EN', () => {
    expect(daysText(1, '')).toBe('1 день');
    expect(daysText(3, '')).toBe('3 дня');
    expect(daysText(7, 'ru')).toBe('7 дней');
    expect(daysText(1, 'en')).toBe('1 day');
    expect(daysText(3, 'en')).toBe('3 days');
    expect(daysText(7, 'en')).toBe('7 days');
  });

  // Mirrors sendReferralNotices: pick the variant for the recipient, then render {days} in the
  // language of the SELECTED template (a RU default stays RU even for an EN recipient).
  function renderNotice(rows: { subState: string; lang: string; body: string }[], recipientLang: string, days: number) {
    const picked = pickVariant(rows, '', recipientLang);
    const tplLang = picked ? normalizeLang(picked.lang) : recipientLang;
    return renderBody(picked ? picked.body : '', { days: daysText(days, tplLang) });
  }

  it('EN recipient with only a RU default template gets RU day words (strict default)', () => {
    const rows = [{ subState: '', lang: '', body: 'FRIEND +{days}' }];
    expect(renderNotice(rows, 'en', 3)).toBe('FRIEND +3 дня');
  });

  it('RU recipient with the RU default template gets RU day words', () => {
    const rows = [{ subState: '', lang: '', body: 'REFERRER +{days}' }];
    expect(renderNotice(rows, 'ru', 7)).toBe('REFERRER +7 дней');
  });

  it('EN recipient with an EN template gets EN day words', () => {
    const rows = [
      { subState: '', lang: '', body: 'FRIEND +{days}' },
      { subState: '', lang: 'en', body: 'FRIEND +{days}' },
    ];
    expect(renderNotice(rows, 'en', 3)).toBe('FRIEND +3 days');
  });

  it('an unsupported language still picks the RU default and renders RU words', () => {
    const rows = [
      { subState: '', lang: '', body: 'FRIEND +{days}' },
      { subState: 'active', lang: '', body: 'ACTIVE +{days}' },
    ];
    expect(renderNotice(rows, normalizeLang('de'), 3)).toBe('FRIEND +3 дня');
  });
});

describe('CIS language packs completeness', () => {
  const packs = LANG_PACKS as Record<string, { catalog: Record<string, string>; strings: Record<string, string>; samples: Record<string, string> }>;
  const codes = LANG_CODES.filter((c) => c !== 'ru' && c !== 'en');

  it('every pack carries raw non-empty entries with RU variable parity', () => {
    expect(codes.length).toBe(11);
    for (const code of codes) {
      const pack = packs[code];
      expect(pack, code).toBeTruthy();
      for (const row of CATALOG) {
        const raw = pack.catalog[row.id];
        expect(typeof raw === 'string' && raw.trim() !== '', code + ' catalog ' + row.id).toBe(true);
        expect(variablesIn(raw).sort(), code + ' catalog ' + row.id).toEqual(variablesIn(row.body).sort());
      }
      for (const id of stringIds()) {
        const raw = pack.strings[id];
        expect(typeof raw === 'string' && raw.trim() !== '', code + ' string ' + id).toBe(true);
        expect(variablesIn(raw).sort(), code + ' string ' + id).toEqual(variablesIn(stringRow(id).ru).sort());
      }
      for (const key of Object.keys(pack.samples)) expect(String(pack.samples[key] || '').trim(), code + ' sample ' + key).not.toBe('');
      for (const row of CATALOG) {
        const sv = sampleVars(row, code);
        const ru = sampleVars(row, '');
        for (const key of Object.keys(ru)) {
          if (String(ru[key] ?? '').trim() === '') continue;
          expect(String(sv[key] ?? '').trim(), code + ' preview ' + row.id + ' ' + key).not.toBe('');
        }
      }
    }
  });

  it('pack texts stay free of em and en dashes', () => {
    const blob = JSON.stringify(packs);
    expect(blob).not.toContain('\u2014');
    expect(blob).not.toContain('\u2013');
  });

  it('regional and uppercase codes normalize to the pack code', () => {
    for (const code of codes) {
      expect(normalizeLang(code + '-UA')).toBe(code);
      expect(normalizeLang(code.toUpperCase())).toBe(code);
    }
    expect(normalizeLang('de-DE')).toBe('');
  });

  it('main keyboard labels of every language parse back to actions', () => {
    for (const code of LANG_CODES) {
      const kb = mainKeyboard(code) as { keyboard: { text: string }[][] };
      const labels = kb.keyboard.flat().map((b) => b.text);
      expect(labels.length, code).toBeGreaterThan(3);
      for (const label of labels) expect(parseAction(label), code + ' label ' + label).toBeTruthy();
    }
  });
});
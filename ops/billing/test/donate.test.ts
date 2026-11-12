import { describe, expect, it } from 'vitest';
import { botCallback, botReply, mainKeyboard } from '../src/bot.mjs';
import {
  accountSupported,
  applyDonation,
  donateCryptoLinkLive,
  donateCsv,
  donateNoticeText,
  donateReport,
  confirmDonateHold,
  hideDonateField,
  markDonateRefund,
  normalizeDonateSettings,
  publicThanks,
  rememberDonateInvoice,
  starsForRub,
  validateDonateAmount,
  validateDonateComment,
} from '../src/donate.mjs';
import { ensureTelegramAccount, settleReferrals, subscriptionView } from '../src/logic.mjs';
import { emptyState } from '../src/state.mjs';
import { grossUp } from '../src/yoomoney.mjs';

const NOW = Date.UTC(2026, 10, 12, 9, 0, 0);

function on() {
  const opened = ensureTelegramAccount(emptyState(), '42', NOW);
  const state = opened.state;
  state.settings.yoomoneyWallet = '410011111111111';
  state.settings.cryptoRateUsdt = 100;
  state.settings.donate = {
    enabled: true,
    amounts: '100,300,500,1000',
    minRub: 50,
    maxRub: 15000,
    commentMax: 20,
    thanksText: 'Спасибо за поддержку OMP.',
    yoomoney: true,
    stars: true,
    crypto: true,
    rubPerStar: 2,
    notifyAll: false,
    notifyMin: 300,
    showAmounts: false,
  };
  state.settings.referral = { enabled: true, referrerDays: 7, friendDays: 3, delayDays: 0 };
  state.referralBinds = [{ friendId: opened.account.id, referrerId: 'ref-1', code: 'OMP1', boundAt: NOW - 10 * 86400000 }];
  state.referralJournal = [];
  return { state, account: opened.account };
}

describe('donate settings', () => {
  it('stays off until an admin turns the flag on', () => {
    const fresh = normalizeDonateSettings(undefined);
    expect(fresh.enabled).toBe(false);
    expect(fresh.yoomoney).toBe(false);
    expect(fresh.stars).toBe(false);
    expect(fresh.crypto).toBe(false);
    expect(fresh.notifyAll).toBe(false);
    expect(fresh.showAmounts).toBe(false);
    expect(fresh.amounts).toBe('100,300,500,1000');
    expect(fresh.thanksText).toContain('Спасибо');
  });

  it('rejects a custom amount outside the admin limits and a comment that is too long', () => {
    const settings = normalizeDonateSettings({ minRub: 50, maxRub: 1000, commentMax: 20 });
    expect(validateDonateAmount(settings, '10').ok).toBe(false);
    expect(validateDonateAmount(settings, '150').ok).toBe(true);
    expect(validateDonateAmount(settings, '150').rub).toBe(150);
    expect(validateDonateAmount(settings, '150.5').ok).toBe(false);
    expect(validateDonateComment(settings, 'x'.repeat(21)).ok).toBe(false);
    expect(validateDonateComment(settings, '  спасибо  ').comment).toBe('спасибо');
  });

  it('turns rubles into whole stars by the admin rate', () => {
    expect(starsForRub(100, 2)).toBe(50);
    expect(starsForRub(100, 1.5)).toBe(67);
    expect(starsForRub(100, 0)).toBe(0);
  });
});

describe('donate bot', () => {
  it('puts Поддержать проект on the main keyboard and explains when the flag is off', () => {
    expect(mainKeyboard().keyboard.flat().map((b) => b.text)).toContain('Поддержать проект');
    const opened = ensureTelegramAccount(emptyState(), '42', NOW);
    const out = botReply(opened.state, { chatId: '42', text: '/donate', now: NOW });
    expect(out.messages[0].text).toContain('выключена');
    expect(out.state.donations || []).toHaveLength(0);
    expect(out.state.subscriptions).toEqual(opened.state.subscriptions);
  });

  it('walks amount, comment, hidden name and a YooMoney card link with the same fee text as a payment', () => {
    const start = on();
    const menu = botReply(start.state, {
      chatId: '42',
      text: 'Поддержать проект',
      now: NOW,
      from: { firstName: 'Анна', lastName: 'К' },
    });
    const buttons = JSON.stringify(menu.messages[0].inline);
    expect(buttons).toContain('dn:a:100');
    expect(buttons).toContain('dn:c');
    const picked = botCallback(menu.state, { chatId: '42', data: 'dn:a:100', now: NOW });
    expect(picked.messages[0].text.toLowerCase()).toContain('коммент');
    const draft = picked.state.donations.find((d) => d.amountRub === 100 && d.status === 'draft');
    expect(draft).toBeTruthy();
    const named = botReply(picked.state, { chatId: '42', text: 'на сервер', now: NOW + 1 });
    expect(named.messages[0].text).toContain('имя');
    const hidden = botCallback(named.state, { chatId: '42', data: 'dn:n:' + draft.id + ':0', now: NOW + 2 });
    const fee = grossUp(100, 'AC');
    expect(hidden.messages[0].text).toContain('Комиссия ЮMoney');
    expect(hidden.messages[0].text).toContain('Карта:');
    const pay = botCallback(hidden.state, { chatId: '42', data: 'dn:p:' + draft.id + ':AC', now: NOW + 3 });
    const row = pay.state.donations.find((d) => d.id === draft.id);
    expect(row.status).toBe('pending');
    expect(row.method).toBe('AC');
    expect(row.showName).toBe(false);
    expect(row.comment).toBe('на сервер');
    expect(row.gross).toBe(fee.gross);
    expect(pay.messages[0].inline.inline_keyboard[0][0].url).toContain('yoomoney.ru');
    expect(pay.messages[0].inline.inline_keyboard[0][0].url).toContain('paymentType=AC');
    expect(pay.state.payments).toEqual(start.state.payments);
  });

  it('sends a Stars invoice for the ruble amount divided by the admin rate', () => {
    const start = on();
    const menu = botReply(start.state, { chatId: '42', text: '/donate', now: NOW, from: { firstName: 'Анна' } });
    const picked = botCallback(menu.state, { chatId: '42', data: 'dn:a:100', now: NOW });
    const draft = picked.state.donations.find((d) => d.amountRub === 100);
    const skipped = botCallback(picked.state, { chatId: '42', data: 'dn:s:' + draft.id, now: NOW });
    const hidden = botCallback(skipped.state, { chatId: '42', data: 'dn:n:' + draft.id + ':0', now: NOW });
    const pay = botCallback(hidden.state, { chatId: '42', data: 'dn:p:' + draft.id + ':XTR', now: NOW });
    expect(pay.messages[0].invoice.currency).toBe('XTR');
    expect(pay.messages[0].invoice.prices[0].amount).toBe(50);
    expect(pay.messages[0].invoice.payload).toBe('don:' + draft.id);
    const row = pay.state.donations.find((d) => d.id === draft.id);
    const paid = applyDonation(pay.state, {
      operationId: 'stars:charge-1',
      label: 'don:' + draft.id,
      amount: '50',
      currency: 'XTR',
      now: NOW + 1000,
    });
    expect(paid.result.kind).toBe('donate');
    expect(paid.state.donations.find((d) => d.id === row.id).status).toBe('paid');
    expect(paid.state.payments || []).toHaveLength(0);
  });

  it('asks again when the custom amount is outside the limits', () => {
    const start = on();
    const menu = botReply(start.state, { chatId: '42', text: '/donate', now: NOW });
    const custom = botCallback(menu.state, { chatId: '42', data: 'dn:c', now: NOW });
    const bad = botReply(custom.state, { chatId: '42', text: '10', now: NOW + 1 });
    expect(bad.messages[0].text).toContain('50');
    expect(bad.state.donations.some((d) => d.status === 'pending')).toBe(false);
  });
});

describe('donate settlement', () => {
  function pendingCard() {
    const start = on();
    const menu = botReply(start.state, {
      chatId: '42',
      text: '/donate',
      now: NOW,
      from: { firstName: 'Анна' },
    });
    const picked = botCallback(menu.state, { chatId: '42', data: 'dn:a:300', now: NOW });
    const draft = picked.state.donations.find((d) => d.amountRub === 300);
    const skipped = botCallback(picked.state, { chatId: '42', data: 'dn:s:' + draft.id, now: NOW });
    const named = botCallback(skipped.state, { chatId: '42', data: 'dn:n:' + draft.id + ':1', now: NOW });
    const pay = botCallback(named.state, { chatId: '42', data: 'dn:p:' + draft.id + ':AC', now: NOW });
    return { state: pay.state, row: pay.state.donations.find((d) => d.id === draft.id) };
  }

  it('marks one donation paid, does not extend a subscription and does not create a referral payment', () => {
    const { state, row } = pendingCard();
    const beforeUntil = subscriptionView(state, row.accountId, NOW);
    const paid = applyDonation(state, {
      operationId: 'op-don-1',
      label: 'don:' + row.id,
      amount: String(row.amountRub),
      currency: '643',
      withdrawAmount: row.gross,
      notificationType: 'card-incoming',
      requireWithdraw: true,
      unaccepted: 'false',
      now: NOW + 1000,
    });
    expect(paid.result.kind).toBe('donate');
    expect(paid.result.error).toBeUndefined();
    const saved = paid.state.donations.find((d) => d.id === row.id);
    expect(saved.status).toBe('paid');
    expect(saved.operationId).toBe('op-don-1');
    expect(paid.state.payments).toEqual(state.payments || []);
    expect(subscriptionView(paid.state, row.accountId, NOW)).toEqual(beforeUntil);
    expect(paid.state.referralJournal || []).toEqual([]);
    expect(settleReferrals(paid.state, NOW + 1000).granted).toBe(0);
    const again = applyDonation(paid.state, {
      operationId: 'op-don-1',
      label: 'don:' + row.id,
      amount: String(row.amountRub),
      currency: '643',
      withdrawAmount: row.gross,
      notificationType: 'card-incoming',
      requireWithdraw: true,
      now: NOW + 2000,
    });
    expect(again.result.duplicate).toBe(true);
    expect(again.state.donations.filter((d) => d.status === 'paid')).toHaveLength(1);
    const short = applyDonation(state, {
      operationId: 'op-short',
      label: 'don:' + row.id,
      amount: '1.00',
      currency: '643',
      withdrawAmount: '1.00',
      notificationType: 'card-incoming',
      requireWithdraw: true,
      now: NOW + 500,
    });
    expect(short.result.error).toBe('amount');
    expect(short.state.donations.find((d) => d.id === row.id).status).toBe('pending');
  });

  it('lists only consented names, hides a refund, and notifies only above the threshold', () => {
    const { state, row } = pendingCard();
    const paid = applyDonation(state, {
      operationId: 'op-don-2',
      label: 'don:' + row.id,
      amount: String(row.amountRub),
      currency: '643',
      withdrawAmount: row.gross,
      notificationType: 'card-incoming',
      requireWithdraw: true,
      now: NOW + 1000,
    });
    expect(accountSupported(paid.state, row.accountId)).toBe(true);
    const names = publicThanks(paid.state);
    expect(names.showAmounts).toBe(false);
    expect(names.names.map((n) => n.name)).toEqual(['Анна']);
    expect(names.names[0].amount).toBeUndefined();
    expect(donateNoticeText(paid.state.settings, paid.state.donations.find((d) => d.id === row.id))).toContain('300');
    const quiet = { ...paid.state, settings: { ...paid.state.settings, donate: { ...paid.state.settings.donate, notifyMin: 1000 } } };
    expect(donateNoticeText(quiet.settings, quiet.donations.find((d) => d.id === row.id))).toBe('');
    const hidden = hideDonateField(paid.state, { id: row.id, field: 'name' });
    expect(publicThanks(hidden).names).toEqual([]);
    expect(accountSupported(hidden, row.accountId)).toBe(true);
    const back = markDonateRefund(hidden, { id: row.id, now: NOW + 5000 });
    expect(accountSupported(back, row.accountId)).toBe(false);
    const report = donateReport(back, NOW + 5000, {});
    expect(report.summary.month.sum).toBe(0);
    const csv = donateCsv(paid.state, {});
    expect(csv).toContain('Анна');
    expect(csv).toContain('300');
    expect(csv).not.toContain('secret');
  });

  it('keeps a held YooMoney transfer on the donation and confirms it without a subscription payment', () => {
    const { state, row } = pendingCard();
    const held = applyDonation(state, {
      operationId: 'op-held',
      label: 'don:' + row.id,
      amount: String(row.amountRub),
      currency: '643',
      withdrawAmount: row.gross,
      notificationType: 'card-incoming',
      requireWithdraw: true,
      unaccepted: 'true',
      now: NOW + 1000,
    });
    const saved = held.state.donations.find((d) => d.id === row.id);
    expect(saved.status).toBe('pending');
    expect(saved.held).toBe(true);
    expect(saved.operationId).toBe('op-held');
    expect(saved.withdrawAmount).toBe(row.gross);
    expect(saved.notificationType).toBe('card-incoming');
    expect(held.state.payments || []).toEqual([]);
    const again = applyDonation(held.state, {
      operationId: 'op-held',
      label: 'don:' + row.id,
      amount: String(row.amountRub),
      currency: '643',
      withdrawAmount: row.gross,
      notificationType: 'card-incoming',
      requireWithdraw: true,
      unaccepted: 'true',
      now: NOW + 1500,
    });
    expect(again.result.duplicate).toBe(true);
    const confirmed = confirmDonateHold(held.state, { id: row.id, now: NOW + 2000 });
    expect(confirmed.result.kind).toBe('donate');
    expect(confirmed.result.error).toBeUndefined();
    expect(confirmed.state.donations.find((d) => d.id === row.id).status).toBe('paid');
    expect(confirmed.state.payments || []).toEqual([]);
    expect(confirmed.state.subscriptions).toEqual(state.subscriptions);
    const report = donateReport(held.state, NOW + 1500, {});
    expect(report.rows.find((r) => r.id === row.id).held).toBe(true);
  });
});

describe('donate crypto invoice', () => {
  it('keeps a live Crypto Pay link and replaces it after 24 hours', () => {
    const row = { id: 'd1', payUrl: 'https://old', webUrl: 'https://old', invoiceId: '1', invoiceExpiresAt: NOW + 1000 };
    const state = { donations: [row] };
    expect(donateCryptoLinkLive(row, NOW)).toBe(true);
    expect(donateCryptoLinkLive(row, NOW + 1000)).toBe(false);
    expect(donateCryptoLinkLive({ id: 'd1', payUrl: 'https://old' }, NOW)).toBe(false);
    const kept = rememberDonateInvoice(state, 'd1', { invoiceId: '2', botUrl: 'https://new', webUrl: 'https://new' }, NOW);
    expect(kept.donations[0].invoiceId).toBe('1');
    const next = rememberDonateInvoice(state, 'd1', { invoiceId: '2', botUrl: 'https://new', webUrl: 'https://new' }, NOW + 1000);
    expect(next.donations[0].invoiceId).toBe('2');
    expect(next.donations[0].payUrl).toBe('https://new');
    expect(next.donations[0].invoiceExpiresAt).toBe(NOW + 1000 + 24 * 60 * 60 * 1000);
    expect(next.donations[0].invoiceIds).toContain('1');
    expect(next.donations[0].invoiceIds).toContain('2');
    const live = { id: 'd2', payUrl: 'https://pay.crypt.bot/i/1', webUrl: 'https://pay.crypt.bot/i/1', invoiceId: '1', invoiceExpiresAt: NOW + 1000 };
    expect(donateCryptoLinkLive(live, NOW, false)).toBe(true);
    expect(donateCryptoLinkLive(live, NOW, true)).toBe(false);
    const switched = rememberDonateInvoice({ donations: [live] }, 'd2', { invoiceId: '9', botUrl: 'https://t.me/CryptoTestnetBot?start=inv9', webUrl: 'https://testnet-pay.crypt.bot/i/9' }, NOW, true);
    expect(switched.donations[0].cryptoTestnet).toBe(true);
    expect(switched.donations[0].invoiceId).toBe('9');
    expect(switched.donations[0].invoiceIds).toContain('1');
    expect(donateCryptoLinkLive(switched.donations[0], NOW, true)).toBe(true);
    expect(donateCryptoLinkLive(switched.donations[0], NOW, false)).toBe(false);
    const pending = {
      ...next.donations[0],
      status: 'pending',
      method: 'crypto',
      asset: 'USDT',
      payAmount: '3.00',
      amountRub: 300,
      accountId: 'acc',
    };
    const paid = applyDonation({ donations: [pending], payments: [], subscriptions: [] }, {
      operationId: 'crypto:1',
      label: 'don:d1',
      amount: '3.00',
      currency: 'USDT',
      now: NOW + 2000,
    });
    expect(paid.result.kind).toBe('donate');
    expect(paid.result.error).toBeUndefined();
    expect(paid.state.donations[0].status).toBe('paid');
  });
});

describe('donate checkout retry', () => {
  it('sends the same frozen YooMoney link again when the first message did not go out', () => {
    const start = on();
    const menu = botReply(start.state, { chatId: '42', text: '/donate', now: NOW, from: { firstName: 'Анна' } });
    const picked = botCallback(menu.state, { chatId: '42', data: 'dn:a:100', now: NOW });
    const draft = picked.state.donations.find((d) => d.amountRub === 100);
    const skipped = botCallback(picked.state, { chatId: '42', data: 'dn:s:' + draft.id, now: NOW });
    const hidden = botCallback(skipped.state, { chatId: '42', data: 'dn:n:' + draft.id + ':0', now: NOW });
    const pay = botCallback(hidden.state, { chatId: '42', data: 'dn:p:' + draft.id + ':AC', now: NOW });
    const again = botCallback(pay.state, { chatId: '42', data: 'dn:p:' + draft.id + ':AC', now: NOW + 5000 });
    expect(again.answer).not.toContain('устарела');
    expect(again.messages[0].inline.inline_keyboard[0][0].url).toBe(pay.messages[0].inline.inline_keyboard[0][0].url);
    expect(again.state.donations.filter((d) => d.status !== 'cancelled')).toHaveLength(1);
    expect(again.state.donations.find((d) => d.id === draft.id).gross).toBe(pay.state.donations.find((d) => d.id === draft.id).gross);
  });
});

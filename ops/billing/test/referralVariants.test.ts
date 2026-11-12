import { describe, expect, it } from 'vitest';
import { applyPayment, phoneBill, quotePurchase, redeemReferralCode, settleReferrals } from '../src/logic.mjs';
import { renewalText } from '../src/bot.mjs';
import { nextTierFriends } from '../admin/src/lib/nextTierFriends';
import { applyReferralPost, claimReferralNotices, normalizeReferralSettings, referralCodeFor, restoreReferralNotices } from '../src/referralAdmin.mjs';
import { grossUp } from '../src/yoomoney.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 15);

function world(referral: Record<string, unknown> = {}) {
  return {
    settings: {
      priceRub: 200,
      periodDays: 30,
      referral: {
        enabled: true,
        referrerDays: 7,
        friendDays: 0,
        delayDays: 0,
        yearlyCap: 12,
        ...referral,
      },
    },
    accounts: [
      { id: 'ref', telegramId: '1' },
      { id: 'friend', telegramId: '2' },
    ],
    subscriptions: [
      { id: 's-ref', accountId: 'ref', product: 'jackett', paidUntil: NOW + 100 * DAY, extraSlots: 0, creditRub: 0 },
      { id: 's-friend', accountId: 'friend', product: 'jackett', paidUntil: NOW + 10 * DAY, extraSlots: 0, creditRub: 0 },
    ],
    codes: [] as { subscriptionId: string; deviceId: string; revoked?: boolean }[],
    payments: [] as Record<string, unknown>[],
    purchases: [] as Record<string, unknown>[],
    referralBinds: [{ friendId: 'friend', referrerId: 'ref', code: 'OMP-X', boundAt: NOW - DAY, deviceId: 'dev-friend' }],
    referralJournal: [] as Record<string, unknown>[],
    audit: [] as Record<string, unknown>[],
  };
}

function pay(state: ReturnType<typeof world>, at = NOW - DAY) {
  return { ...state, payments: [{ accountId: 'friend', at, amount: '200.00' }] };
}

function row(state: { referralJournal?: { variant?: string; friendId?: string }[] }, variant: string, friendId = 'friend') {
  return (state.referralJournal || []).find((item) => item.friendId === friendId && (variant === 'days' ? !item.variant || item.variant === 'days' : item.variant === variant));
}

function sub(state: { subscriptions: { id: string; paidUntil: number; creditRub?: number }[] }, id: string) {
  return state.subscriptions.find((item) => item.id === id)!;
}

describe('referral variants', () => {
  it('keeps the four variants off and does not pay them until each one is enabled', () => {
    const fresh = normalizeReferralSettings({});
    expect(fresh.balance).toBe(false);
    expect(fresh.tiers).toBe(false);
    expect(fresh.friendDiscount).toBe(false);
    expect(fresh.retention).toBe(false);
    expect(fresh.balancePercent).toBe(0);
    expect(fresh.tierList).toEqual([]);
    expect(normalizeReferralSettings({ tierList: [{ friends: 3, days: 14, percent: 10 }, { friends: 3, days: 7, percent: 0 }] }).tierList).toEqual([{ friends: 3, days: 14, percent: 10 }]);
    expect(nextTierFriends([3, 5])).toBe(1);
    expect(nextTierFriends([1, 2, 3])).toBe(4);
    expect(fresh.delayDays).toBe(7);
    expect(fresh.yearlyCap).toBe(12);
    expect(normalizeReferralSettings({ delayDays: 400, yearlyCap: -3, referrerDays: 40 }).delayDays).toBe(365);
    expect(normalizeReferralSettings({ yearlyCap: 500 }).yearlyCap).toBe(120);
    expect(normalizeReferralSettings({ delayDays: 0 }).delayDays).toBe(0);

    const settled = settleReferrals(pay(world({ balancePercent: 50, tiers: true, friendDiscount: true, retention: true })), NOW);
    expect(sub(settled.state, 's-ref').creditRub).toBe(0);
    expect(sub(settled.state, 's-ref').paidUntil).toBe(NOW + 100 * DAY + 7 * DAY);
    expect(row(settled.state, 'balance')).toBeUndefined();
    expect(row(settled.state, 'retention')).toBeUndefined();
    const quote = quotePurchase(settled.state, { kind: 'sub', accountId: 'friend', subscriptionId: 's-friend', now: NOW });
    expect(quote.result.price).toBe(200);
    expect(quote.result.referralOff || 0).toBe(0);
  });

  it('credits a percent of the friend payment, capped per payment and per month', () => {
    const once = settleReferrals(pay(world({ balance: true, balancePercent: 10, balanceMax: 30, balanceMonthlyCap: 100 })), NOW);
    expect(sub(once.state, 's-ref').creditRub).toBe(20);
    expect(row(once.state, 'balance')).toMatchObject({ status: 'granted', credit: 20, variant: 'balance' });
    const again = settleReferrals(once.state, NOW + DAY);
    expect(again.granted).toBe(0);
    expect(sub(again.state, 's-ref').creditRub).toBe(20);

    const capped = settleReferrals(pay(world({ balance: true, balancePercent: 50, balanceMax: 30 })), NOW);
    expect(sub(capped.state, 's-ref').creditRub).toBe(30);

    const stars = pay(world({ balance: true, balancePercent: 10 }));
    stars.payments = [{ accountId: 'friend', at: NOW - DAY, provider: 'stars', amount: '150', rub: 200 }];
    expect(sub(settleReferrals(stars, NOW).state, 's-ref').creditRub).toBe(20);

    const first = settleReferrals(pay(world({ balance: true, balancePercent: 10, balanceMonthlyCap: 20 })), NOW);
    const second = {
      ...first.state,
      accounts: first.state.accounts.concat([{ id: 'other', telegramId: '3' }]),
      subscriptions: first.state.subscriptions.concat([{ id: 's-other', accountId: 'other', product: 'jackett', paidUntil: NOW + DAY, extraSlots: 0, creditRub: 0 }]),
      referralBinds: first.state.referralBinds.concat([{ friendId: 'other', referrerId: 'ref', code: 'OMP-Y', boundAt: NOW - DAY }]),
      payments: first.state.payments.concat([{ accountId: 'other', at: NOW - DAY, amount: '200.00' }]),
    };
    const held = settleReferrals(second, NOW);
    expect(row(held.state, 'balance', 'other')).toMatchObject({ status: 'waiting', reason: 'month', credit: 0 });
    expect(sub(held.state, 's-ref').creditRub).toBe(20);
    const later = settleReferrals(held.state, NOW + 32 * DAY);
    expect(row(later.state, 'balance', 'other')).toMatchObject({ status: 'granted', credit: 20 });
    expect(sub(later.state, 's-ref').creditRub).toBe(40);
  });

  it('raises days and percent by the highest tier the referrer has reached, still at most 14 days', () => {
    const raised = settleReferrals(
      pay(world({ tiers: true, tierList: [{ friends: 1, days: 40, percent: 10 }] })),
      NOW,
    );
    expect(row(raised.state, 'days')).toMatchObject({ status: 'granted', days: 14, variant: 'days' });
    expect(sub(raised.state, 's-ref').paidUntil).toBe(NOW + 100 * DAY + 14 * DAY);
    expect(sub(raised.state, 's-ref').creditRub).toBe(20);

    const base = settleReferrals(pay(world({ tiers: true, tierList: [{ friends: 2, days: 14, percent: 0 }] })), NOW);
    expect(row(base.state, 'days')!.days).toBe(7);
  });

  it('freezes a first-payment friend discount into the order, the bot and the phone price', () => {
    const state = world({ friendDiscount: true, friendDiscountPercent: 10, friendDiscountRub: 5, friendDiscountDays: 30 });
    const quote = quotePurchase(state, { kind: 'sub', accountId: 'friend', subscriptionId: 's-friend', now: NOW, method: 'AC' });
    expect(quote.result.referralOff).toBe(25);
    expect(quote.result.price).toBe(175);
    expect(quote.result.fee).toBe(grossUp(175, 'AC')!.fee);
    const stored = quote.state.purchases[quote.state.purchases.length - 1];
    expect(stored).toMatchObject({ price: 175, referralOff: 25 });
    const changed = quotePurchase(
      { ...quote.state, settings: { ...quote.state.settings, referral: { ...quote.state.settings.referral, friendDiscountPercent: 50 } } },
      { kind: 'sub', accountId: 'friend', subscriptionId: 's-friend', now: NOW, method: 'AC' },
    );
    expect(changed.state.purchases.find((item: { id: string }) => item.id === quote.result.id).price).toBe(175);
    const card = grossUp(175, 'AC')!;
    const notice = { currency: '643', withdrawAmount: card.gross, notificationType: 'card-incoming', requireWithdraw: true, now: NOW };
    const short = applyPayment(quote.state, { operationId: 'op-short', label: quote.result.label, amount: '100.00', ...notice });
    expect(short.result.error).toBe('amount');
    const full = grossUp(200, 'AC')!;
    const oldPrice = applyPayment(quote.state, {
      operationId: 'op-full',
      label: quote.result.label,
      amount: full.net,
      ...notice,
      withdrawAmount: full.gross,
    });
    expect(oldPrice.result.error).toBe('amount');
    const paid = applyPayment(quote.state, { operationId: 'op-ok', label: quote.result.label, amount: card.net, ...notice });
    expect(paid.result.error).toBeUndefined();
    const dev = quotePurchase(state, { kind: 'dev', accountId: 'friend', subscriptionId: 's-friend', now: NOW });
    expect(dev.result.referralOff || 0).toBe(0);

    const late = world({ friendDiscount: true, friendDiscountPercent: 10, friendDiscountDays: 3 });
    late.referralBinds[0].boundAt = NOW - 10 * DAY;
    expect(quotePurchase(late, { kind: 'sub', accountId: 'friend', subscriptionId: 's-friend', now: NOW }).result.price).toBe(200);

    const idle = world({ friendDiscount: true, friendDiscountPercent: 10 });
    idle.subscriptions[0].paidUntil = NOW - 10 * DAY;
    expect(quotePurchase(idle, { kind: 'sub', accountId: 'friend', subscriptionId: 's-friend', now: NOW }).result.price).toBe(200);

    const spent = pay(world({ friendDiscount: true, friendDiscountPercent: 10 }));
    expect(quotePurchase(spent, { kind: 'sub', accountId: 'friend', subscriptionId: 's-friend', now: NOW }).result.price).toBe(200);

    expect(phoneBill(state, 'friend', NOW).priceRub).toBe(175);
    expect(renewalText(state, state.subscriptions[1], { active: true, paidUntil: NOW + 10 * DAY }, NOW).text).toContain('скидка по приглашению');
  });

  it('grants retention days after consecutive paid months and caps them at 14', () => {
    const settings = { retention: true, retentionMonths: 3, retentionDays: 20, referrerDays: 0 };
    const gaps = [NOW - 90 * DAY, NOW - 60 * DAY, NOW - 30 * DAY];
    const ready = world(settings);
    ready.referralBinds[0].boundAt = NOW - 100 * DAY;
    ready.payments = gaps.map((at) => ({ accountId: 'friend', at, amount: '200.00' }));
    const granted = settleReferrals(ready, NOW);
    expect(row(granted.state, 'retention')).toMatchObject({ status: 'granted', days: 14, variant: 'retention' });
    expect(sub(granted.state, 's-ref').paidUntil).toBe(NOW + 100 * DAY + 14 * DAY);
    expect(settleReferrals(granted.state, NOW + DAY).state.subscriptions.find((item: { id: string }) => item.id === 's-ref')!.paidUntil).toBe(sub(granted.state, 's-ref').paidUntil);

    const early = world({ ...settings, delayDays: 7 });
    early.referralBinds[0].boundAt = NOW - 100 * DAY;
    early.payments = gaps.map((at) => ({ accountId: 'friend', at, amount: '200.00' }));
    expect(row(settleReferrals(early, NOW - 30 * DAY + 2 * DAY).state, 'retention')!.reason).toBe('delay');

    const broken = world(settings);
    broken.referralBinds[0].boundAt = NOW - 100 * DAY;
    broken.payments = [NOW - 90 * DAY, NOW - 60 * DAY, NOW].map((at) => ({ accountId: 'friend', at, amount: '200.00' }));
    expect(row(settleReferrals(broken, NOW).state, 'retention')).toBeUndefined();
  });

  it('runs several variants on one payment and still waits out the delay and the year cap', () => {
    const settings = {
      balance: true,
      balancePercent: 10,
      tiers: true,
      tierList: [{ friends: 1, days: 14, percent: 25 }],
      friendDiscount: true,
      friendDiscountPercent: 10,
      retention: true,
      retentionMonths: 3,
      retentionDays: 5,
      delayDays: 7,
    };
    const waiting = settleReferrals(pay(world(settings), NOW), NOW + 2 * DAY);
    expect(waiting.granted).toBe(0);
    expect(row(waiting.state, 'days')).toMatchObject({ status: 'waiting', reason: 'delay' });
    expect(row(waiting.state, 'balance')).toMatchObject({ status: 'waiting', reason: 'delay' });
    expect(sub(waiting.state, 's-ref').creditRub).toBe(0);

    const done = settleReferrals(pay(world(settings), NOW), NOW + 8 * DAY);
    expect(row(done.state, 'days')).toMatchObject({ status: 'granted', days: 14, variant: 'days' });
    expect(row(done.state, 'balance')).toMatchObject({ status: 'granted', credit: 50, variant: 'balance' });
    expect(row(done.state, 'retention')).toBeUndefined();
    expect(sub(done.state, 's-ref').creditRub).toBe(50);
    expect(quotePurchase(world(settings), { kind: 'sub', accountId: 'friend', subscriptionId: 's-friend', now: NOW }).result.price).toBe(180);

    const blocked = world({ ...settings, delayDays: 0, yearlyCap: 1, balance: false, friendDiscount: false, retention: false, tiers: false });
    blocked.referralJournal = [{ id: 'old', friendId: 'past', referrerId: 'ref', status: 'granted', days: 30, reason: 'paid', grantedAt: NOW, variant: 'days' }];
    const year = settleReferrals(pay(blocked), NOW);
    expect(row(year.state, 'days')).toMatchObject({ status: 'waiting', reason: 'year' });
    expect(sub(year.state, 's-ref').paidUntil).toBe(NOW + 100 * DAY);
  });

  it('cancels a pending row, reverses a grant, and does not apply either twice', () => {
    const pending = settleReferrals(pay(world({ balance: true, balancePercent: 10, delayDays: 7 }), NOW), NOW + 2 * DAY);
    const daysId = String(row(pending.state, 'days')!.id);
    const balanceId = String(row(pending.state, 'balance')!.id);
    const dropped = applyReferralPost({ cancelId: daysId, settings: pending.state.settings.referral }, pending.state, {
      now: NOW,
      actor: { kind: 'admin', id: '9', label: '9' },
    });
    expect(dropped.journal.find((item) => item.id === daysId)!.status).toBe('cancelled');
    expect(dropped.journal.find((item) => item.id === balanceId)!.status).toBe('cancelled');
    expect(dropped.binds).toEqual([]);
    expect(sub(dropped.state, 's-ref').paidUntil).toBe(NOW + 100 * DAY);
    expect(dropped.note).toContain('ещё не выдан');
    expect(dropped.state.audit[0]).toMatchObject({ action: 'referral_cancel', actor: { kind: 'admin', id: '9', label: '9' } });
    expect(dropped.state.audit[0].detail).toContain('15.01.2026 03:00 МСК');

    const granted = settleReferrals(pay(world({ balance: true, balancePercent: 10, friendDays: 3 })), NOW);
    const grantDays = String(row(granted.state, 'days')!.id);
    const grantBalance = String(row(granted.state, 'balance')!.id);
    expect(sub(granted.state, 's-friend').paidUntil).toBe(NOW + 10 * DAY + 3 * DAY);
    const undone = applyReferralPost({ cancelId: grantDays, settings: granted.state.settings.referral }, granted.state, {
      now: NOW,
      actor: { kind: 'admin', id: '9', label: '9' },
    });
    expect(sub(undone.state, 's-ref').paidUntil).toBe(NOW + 100 * DAY);
    expect(sub(undone.state, 's-friend').paidUntil).toBe(NOW + 10 * DAY);
    expect(undone.binds).toEqual([]);
    const twice = applyReferralPost({ cancelId: grantDays, settings: undone.state.settings.referral }, undone.state, { now: NOW + DAY, actor: { kind: 'admin', id: '9', label: '9' } });
    expect(sub(twice.state, 's-ref').paidUntil).toBe(NOW + 100 * DAY);
    expect(twice.state.audit.filter((item: { action?: string }) => item.action === 'referral_cancel')).toHaveLength(1);

    const spent = {
      ...granted.state,
      subscriptions: granted.state.subscriptions.map((item) => (item.id === 's-ref' ? { ...item, paidUntil: NOW + 3 * DAY, creditRub: 5 } : item)),
    };
    const partial = applyReferralPost({ cancelId: grantBalance, settings: spent.settings.referral }, spent, { now: NOW, actor: { kind: 'admin', id: '9', label: '9' } });
    expect(sub(partial.state, 's-ref').creditRub).toBe(0);
    expect(partial.note).toContain('Не снято: 15 ₽');
    expect(partial.journal.find((item) => item.id === grantBalance)!.shortfall).toContain('15 ₽');
    expect(partial.binds).toHaveLength(1);

    const cut = applyReferralPost({ cancelId: grantDays, settings: spent.settings.referral }, spent, { now: NOW, actor: { kind: 'admin', id: '9', label: '9' } });
    expect(sub(cut.state, 's-ref').paidUntil).toBe(NOW);
    expect(cut.note).toContain('Не снято: 4 дн.');
  });

  it('notifies once and refuses a second telegram or a second device', () => {
    const granted = settleReferrals(pay(world({ balance: true, balancePercent: 10, friendDays: 3 })), NOW);
    const first = claimReferralNotices(granted.state);
    const text = first.messages.map((item) => item.text).join('\n');
    expect(text).toContain('7 дн.');
    expect(text).toContain('20 ₽');
    expect(first.messages.map((item) => item.chatId)).toContain('1');
    expect(first.messages.map((item) => item.chatId)).toContain('2');
    const second = claimReferralNotices(first.state);
    expect(second.messages).toEqual([]);
    expect(second.state).toBe(first.state);
    const restored = restoreReferralNotices(first.state, first.messages.flatMap((item) => item.restore || []));
    expect(claimReferralNotices(restored).messages.length).toBeGreaterThan(0);
    let cur = granted.state;
    for (let i = 0; i < 3; i++) {
      const claimed = claimReferralNotices(cur);
      expect(claimed.messages.length).toBeGreaterThan(0);
      cur = restoreReferralNotices(claimed.state, claimed.messages.flatMap((item) => item.restore || []));
    }
    expect(claimReferralNotices(cur).messages).toEqual([]);

    const src = world();
    src.referralBinds = [];
    const bound = redeemReferralCode(src, { code: referralCodeFor('ref'), accountId: 'friend', deviceId: 'dev-1', now: NOW });
    const other = {
      ...bound!.state,
      accounts: bound!.state.accounts.concat([{ id: 'clone', telegramId: '2' }]),
    };
    expect(redeemReferralCode(other, { code: referralCodeFor('ref'), accountId: 'clone', deviceId: 'dev-2', now: NOW })!.result.error).toBe('already');
    const device = {
      ...bound!.state,
      accounts: bound!.state.accounts.concat([{ id: 'next', telegramId: '4' }]),
    };
    expect(redeemReferralCode(device, { code: referralCodeFor('ref'), accountId: 'next', deviceId: 'dev-1', now: NOW })!.result.error).toBe('bad_promo');
  });

  it('scales stars and crypto by the referral discount and keeps the ruble reference', () => {
    const state = world({ friendDiscount: true, friendDiscountPercent: 10 });
    state.settings.starsEnabled = true;
    state.settings.starsPrice = 100;
    state.settings.cryptoUsdt = 2;
    const stars = quotePurchase(state, { kind: 'sub', accountId: 'friend', subscriptionId: 's-friend', now: NOW, method: 'stars' });
    expect(stars.result.price).toBe(180);
    expect(stars.result.payAmount).toBe('90');
    const crypto = quotePurchase(state, { kind: 'sub', accountId: 'friend', subscriptionId: 's-friend', now: NOW, method: 'crypto', asset: 'USDT' });
    expect(crypto.result.payAmount).toBe('1.80');
  });

  it('anchors retention on the payment that first reached the month count', () => {
    const settings = { retention: true, retentionMonths: 3, retentionDays: 7, referrerDays: 0, delayDays: 31 };
    const ready = world(settings);
    ready.referralBinds[0].boundAt = NOW - 200 * DAY;
    const third = NOW - 30 * DAY;
    ready.payments = [NOW - 90 * DAY, NOW - 60 * DAY, third, NOW].map((at) => ({ accountId: 'friend', at, amount: '200.00', label: 'sub:s-friend' }));
    const granted = settleReferrals(ready, third + 31 * DAY);
    expect(row(granted.state, 'retention')).toMatchObject({ status: 'granted', days: 7 });
  });

  it('does not count a device purchase as a paid month or as the first subscription', () => {
    const settings = { retention: true, retentionMonths: 2, retentionDays: 7, referrerDays: 0, friendDiscount: true, friendDiscountPercent: 10 };
    const slots = world(settings);
    slots.referralBinds[0].boundAt = NOW - 100 * DAY;
    slots.purchases = [{ id: 'dev1', kind: 'dev', price: 50 }];
    slots.payments = [NOW - 60 * DAY, NOW - 30 * DAY].map((at, i) => ({ accountId: 'friend', at, amount: '50.00', label: 'buy:dev1', id: 'd' + i }));
    expect(row(settleReferrals(slots, NOW).state, 'retention')).toBeUndefined();
    const quote = quotePurchase(slots, { kind: 'sub', accountId: 'friend', subscriptionId: 's-friend', now: NOW });
    expect(quote.result.price).toBe(180);

    const prior = world({ friendDiscount: true, friendDiscountPercent: 10 });
    prior.payments = [{ accountId: 'friend', at: NOW - 40 * DAY, amount: '200.00', label: 'sub:s-friend' }];
    expect(quotePurchase(prior, { kind: 'sub', accountId: 'friend', subscriptionId: 's-friend', now: NOW }).result.price).toBe(200);
  });

  it('credits each later subscription payment once and stops a second discounted order', () => {
    const first = settleReferrals(pay(world({ balance: true, balancePercent: 10, balanceMonthlyCap: 100 })), NOW);
    const again = {
      ...first.state,
      payments: first.state.payments.concat([{ id: 'p2', accountId: 'friend', at: NOW + 40 * DAY, amount: '200.00', label: 'sub:s-friend' }]),
    };
    const second = settleReferrals(again, NOW + 41 * DAY);
    expect(second.state.referralJournal.filter((item) => item.variant === 'balance' && item.status === 'granted')).toHaveLength(2);
    expect(sub(second.state, 's-ref').creditRub).toBe(40);
    expect(sub(settleReferrals(second.state, NOW + 42 * DAY).state, 's-ref').creditRub).toBe(40);

    const priced = world({ friendDiscount: true, friendDiscountPercent: 10 });
    const card = quotePurchase(priced, { kind: 'sub', accountId: 'friend', subscriptionId: 's-friend', now: NOW, method: 'AC' });
    const wallet = quotePurchase(card.state, { kind: 'sub', accountId: 'friend', subscriptionId: 's-friend', now: NOW, method: 'PC' });
    expect(card.result.referralOff).toBeGreaterThan(0);
    expect(wallet.result.referralOff).toBeGreaterThan(0);
    const up = grossUp(card.result.price, 'AC')!;
    const paid = applyPayment(wallet.state, {
      operationId: 'op-card',
      label: card.result.label,
      amount: up.net,
      currency: '643',
      withdrawAmount: up.gross,
      notificationType: 'card-incoming',
      requireWithdraw: true,
      now: NOW,
    });
    expect(paid.result.error).toBeUndefined();
    const other = grossUp(wallet.result.price, 'PC')!;
    const secondPay = applyPayment(paid.state, {
      operationId: 'op-wallet',
      label: wallet.result.label,
      amount: other.net,
      currency: '643',
      withdrawAmount: other.gross,
      notificationType: 'p2p-incoming',
      requireWithdraw: true,
      now: NOW + 1,
    });
    expect(secondPay.result.error).toBe('amount');
  });

  it('shows the same capped discount as checkout and does not announce a cancelled gift', () => {
    const state = world({ friendDiscount: true, friendDiscountRub: 20 });
    state.subscriptions[1].creditRub = 190;
    expect(phoneBill(state, 'friend', NOW).priceRub).toBe(1);
    expect(quotePurchase(state, { kind: 'sub', accountId: 'friend', subscriptionId: 's-friend', now: NOW }).result.price).toBe(1);
    expect(renewalText(state, state.subscriptions[1], { active: true, paidUntil: NOW + 10 * DAY }, NOW).text).toContain('1');

    const gifted = world({ friendDays: 0, referrerDays: 7 });
    gifted.referralJournal = [{ id: 'old', friendId: 'friend', referrerId: 'ref', status: 'granted', days: 7, friendGranted: true, variant: 'days', reason: 'paid' }];
    const undone = applyReferralPost({ cancelId: 'old', settings: gifted.settings.referral }, gifted, { now: NOW, actor: { kind: 'admin', id: '9', label: '9' } });
    expect(undone.note).toContain('дни друга не записаны');
    expect(sub(undone.state, 's-friend').paidUntil).toBe(NOW + 10 * DAY);

    const granted = settleReferrals(pay(world({ referrerDays: 7, friendDays: 0 })), NOW);
    const claimed = claimReferralNotices(granted.state);
    const back = restoreReferralNotices(claimed.state, claimed.messages.flatMap((item) => item.restore || []));
    const daysId = String(row(back, 'days')!.id);
    const cancelled = applyReferralPost({ cancelId: daysId, settings: back.settings.referral }, back, { now: NOW, actor: { kind: 'admin', id: '9', label: '9' } });
    expect(claimReferralNotices(cancelled.state).messages).toEqual([]);
  });
});

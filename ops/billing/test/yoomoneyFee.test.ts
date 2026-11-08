import { describe, expect, it } from 'vitest';
import { confirmPendingPayment } from '../src/deviceAdmin.mjs';
import { applyPayment, createSubscription, openAccount, quotePurchase } from '../src/logic.mjs';
import { emptyState } from '../src/state.mjs';
import { grossUp, kopOf, netKop, rubOf, settledCovers } from '../src/yoomoney.mjs';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function shop() {
  const opened = openAccount(emptyState(), { telegramId: '42', email: '', now: NOW });
  opened.state.settings.priceRub = 150;
  opened.state.settings.extraDeviceRub = 50;
  opened.state.settings.periodDays = 30;
  opened.state.settings.yoomoneyWallet = '410011111111111';
  const created = createSubscription(opened.state, { accountId: opened.account.id, now: NOW, days: 30 });
  return { state: created.state, account: opened.account.id, sub: created.result.subscriptionId as string, until: created.result.paidUntil as number };
}

describe('documented YooMoney fee', () => {
  it('reproduces the published 1000 RUB examples in kopecks', () => {
    expect(netKop(100000, 'PC')).toBe(99009);
    expect(rubOf(netKop(100000, 'PC'))).toBe('990.09');
    expect(netKop(100000, 'AC')).toBe(97000);
    expect(rubOf(netKop(100000, 'AC'))).toBe('970.00');
    expect(netKop(100000, 'XX')).toBeNaN();
  });

  it('grosses the charged sum up so the wallet still receives the subscription price', () => {
    const wallet = grossUp(300, 'PC');
    const card = grossUp(300, 'AC');
    expect(wallet).toMatchObject({ method: 'PC', base: '300.00', fee: '3.00', gross: '303.00', net: '300.00' });
    expect(card).toMatchObject({ method: 'AC', base: '300.00', fee: '9.28', gross: '309.28', net: '300.00' });
    expect(grossUp(150, 'PC')).toMatchObject({ fee: '1.50', gross: '151.50', net: '150.00' });
    expect(grossUp(150, 'AC')).toMatchObject({ fee: '4.64', gross: '154.64', net: '150.00' });
    expect(grossUp(0, 'PC')).toBeNull();
    expect(grossUp(-5, 'AC')).toBeNull();
    expect(grossUp(150, 'XX')).toBeNull();
    expect(grossUp(150, '')).toBeNull();
    expect(grossUp(0.01, 'PC')).toMatchObject({ base: '0.01', net: '0.01' });
    expect(grossUp(0.01, 'AC')!.net).toBe('0.01');
    for (const base of [1, 33, 50, 149, 200, 250, 1000]) {
      for (const method of ['PC', 'AC'] as const) {
        const up = grossUp(base, method)!;
        expect(netKop(kopOf(up.gross), method)).toBe(kopOf(up.base));
        expect(kopOf(up.fee) + kopOf(up.base)).toBe(kopOf(up.gross));
      }
    }
  });

  it('freezes base, method, fee and gross on the server and rejects an unknown method', () => {
    const s = shop();
    const bad = quotePurchase(s.state, { kind: 'sub', accountId: s.account, subscriptionId: s.sub, now: NOW, method: 'QR' });
    expect(bad.result.error).toBe('bad_method');
    expect(bad.state.purchases || []).toHaveLength(0);
    const q = quotePurchase(s.state, { kind: 'sub', accountId: s.account, subscriptionId: s.sub, now: NOW, method: 'PC' });
    expect(q.result).toMatchObject({ price: 150, method: 'PC', fee: '1.50', gross: '151.50' });
    expect(q.state.purchases[0].gross).toBe('151.50');
    const again = quotePurchase(q.state, { kind: 'sub', accountId: s.account, subscriptionId: s.sub, now: NOW + 1000, method: 'PC' });
    expect(again.state.purchases).toHaveLength(1);
    const legacy = quotePurchase(s.state, { kind: 'sub', accountId: s.account, subscriptionId: s.sub, now: NOW });
    expect(legacy.result.method || '').toBe('');
    expect(legacy.result.gross || '').toBe('');
    expect(legacy.result.price).toBe(150);
  });
});

describe('held confirmation uses the same amount rules', () => {
  it('rejects the reviewed underpayment on the direct path and on admin confirm', () => {
    const s = shop();
    const q = quotePurchase(s.state, { kind: 'sub', accountId: s.account, subscriptionId: s.sub, now: NOW });
    const fields = {
      operationId: 'op-short',
      label: q.result.label as string,
      amount: '146.53',
      currency: '643',
      withdrawAmount: '148.00',
      notificationType: 'p2p-incoming',
      requireWithdraw: true,
      now: NOW + DAY,
    };
    const direct = applyPayment(q.state, { ...fields, unaccepted: false });
    expect(direct.result.error).toBe('amount');
    expect(direct.state.subscriptions[0].paidUntil).toBe(s.until);
    const held = applyPayment(q.state, { ...fields, unaccepted: true });
    expect(held.result.pending).toBe(true);
    expect(held.state.subscriptions[0].paidUntil).toBe(s.until);
    expect(held.state.payments[0]).toMatchObject({ withdrawAmount: '148.00', notificationType: 'p2p-incoming', requireWithdraw: true, pending: true });
    const confirmed = confirmPendingPayment(held.state, { operationId: 'op-short', now: NOW + DAY + 1, actor: { kind: 'admin', id: '1', label: '1' } });
    expect(confirmed.result.error).toBe('amount');
    expect(confirmed.result.confirmed).toBe(false);
    expect(confirmed.state.subscriptions[0].paidUntil).toBe(s.until);
  });

  it('confirms a frozen wallet order once and rejects a short, duplicate or other method', () => {
    const s = shop();
    const q = quotePurchase(s.state, { kind: 'sub', accountId: s.account, subscriptionId: s.sub, now: NOW, method: 'PC' });
    const label = q.result.label as string;
    const held = applyPayment(q.state, {
      operationId: 'op-ok',
      label,
      amount: '150.00',
      currency: '643',
      withdrawAmount: '151.50',
      notificationType: 'p2p-incoming',
      requireWithdraw: true,
      unaccepted: true,
      now: NOW + DAY,
    });
    expect(held.state.subscriptions[0].paidUntil).toBe(s.until);
    const confirmed = confirmPendingPayment(held.state, { operationId: 'op-ok', now: NOW + DAY + 1, actor: { kind: 'admin', id: '1', label: '1' } });
    expect(confirmed.result.confirmed).toBe(true);
    expect(confirmed.state.subscriptions[0].paidUntil).toBe(s.until + 30 * DAY);
    const twice = confirmPendingPayment(confirmed.state, { operationId: 'op-ok', now: NOW + DAY + 2, actor: { kind: 'admin', id: '1', label: '1' } });
    expect(twice.result.error).toBe('already');
    const replay = applyPayment(confirmed.state, {
      operationId: 'op-ok',
      label,
      amount: '150.00',
      currency: '643',
      withdrawAmount: '151.50',
      notificationType: 'p2p-incoming',
      requireWithdraw: true,
      now: NOW + DAY + 3,
    });
    expect(replay.result.duplicate).toBe(true);
    expect(replay.state.subscriptions[0].paidUntil).toBe(s.until + 30 * DAY);

    const card = applyPayment(q.state, {
      operationId: 'op-card',
      label,
      amount: '146.96',
      currency: '643',
      withdrawAmount: '151.50',
      notificationType: 'card-incoming',
      requireWithdraw: true,
      now: NOW + DAY,
    });
    expect(card.result.error).toBe('amount');
    const missing = applyPayment(q.state, {
      operationId: 'op-miss',
      label,
      amount: '150.00',
      currency: '643',
      notificationType: 'p2p-incoming',
      requireWithdraw: true,
      now: NOW + DAY,
    });
    expect(missing.result.error).toBe('amount');
    expect(settledCovers('150.00', '643', q.state.purchases[0], { withdrawAmount: '151.50', notificationType: 'p2p-incoming' })).toBe(true);
    expect(settledCovers('149.98', '643', q.state.purchases[0], { withdrawAmount: '151.50', notificationType: 'p2p-incoming' })).toBe(false);
  });

  it('keeps an old hold that has no charged sum on the previous net check', () => {
    const s = shop();
    const q = quotePurchase(s.state, { kind: 'sub', accountId: s.account, subscriptionId: s.sub, now: NOW });
    const hold = (amount: string, op: string) =>
      applyPayment(q.state, { operationId: op, label: q.result.label as string, amount, currency: '643', unaccepted: true, now: NOW + DAY });
    const ok = confirmPendingPayment(hold('150.00', 'op-old').state, { operationId: 'op-old', now: NOW + DAY + 1, actor: { kind: 'admin', id: '1', label: '1' } });
    expect(ok.result.confirmed).toBe(true);
    const slack = confirmPendingPayment(hold('146.53', 'op-slack').state, { operationId: 'op-slack', now: NOW + DAY + 1, actor: { kind: 'admin', id: '1', label: '1' } });
    expect(slack.result.confirmed).toBe(true);
    const low = confirmPendingPayment(hold('140.00', 'op-low').state, { operationId: 'op-low', now: NOW + DAY + 1, actor: { kind: 'admin', id: '1', label: '1' } });
    expect(low.result.error).toBe('amount');
    expect(low.result.confirmed).toBe(false);
  });
});

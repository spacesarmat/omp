import { describe, expect, it } from 'vitest';
import { phoneBill, setAutoRenew } from '../src/logic.mjs';
import { emptyState } from '../src/state.mjs';

describe('phone bill', () => {
  it('quotes the card total and lists only this account', () => {
    const state = emptyState();
    state.settings.priceRub = 200;
    state.accounts.push({ id: 'a1', autoRenew: true });
    state.subscriptions.push({ id: 's1', accountId: 'a1', product: 'jackett', paidUntil: Date.now() + 86400000, extraSlots: 0 });
    state.payments.push({ accountId: 'a1', at: 5, amount: '194', withdrawAmount: '200', label: 'sub' });
    state.payments.push({ accountId: 'a2', at: 6, amount: '9', label: 'other' });
    state.payments.push({ accountId: 'a1', at: 7, amount: '1', error: 'amount', label: 'bad' });
    const bill = phoneBill(state, 'a1', Date.now());
    expect(bill.priceRub).toBe(200);
    expect(bill.feeRub).toBe(6);
    expect(bill.totalRub).toBe(206);
    expect(bill.autoRenew).toBe(true);
    expect(bill.payments).toEqual([{ at: 5, amount: '200', title: 'sub' }]);
    const off = setAutoRenew(state, 'a1', false);
    expect(off.result).toEqual({ ok: true, autoRenew: false });
    expect(phoneBill(off.state, 'a1', Date.now()).autoRenew).toBe(false);
    expect(setAutoRenew(state, 'missing', false).result).toEqual({ error: 'not_linked' });
  });
});

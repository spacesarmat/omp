import { describe, expect, it } from 'vitest';
import { redeemReferralCode, settleReferrals } from '../src/logic.mjs';
import { referralCodeFor } from '../src/referralAdmin.mjs';

const now = 1_700_000_000_000;

function base() {
  return {
    settings: { referral: { enabled: true, friendDays: 3 } },
    accounts: [
      { id: 'ref', telegramId: '1' },
      { id: 'friend', telegramId: '2' },
    ],
    subscriptions: [{ id: 's1', accountId: 'friend', product: 'jackett', paidUntil: now, extraSlots: 0 }],
    codes: [],
    referralBinds: [],
  };
}

describe('referral code on the account screen', () => {
  it('saves the invitation in the journal and does not add days yet', () => {
    const src = base();
    const out = redeemReferralCode(src, { code: referralCodeFor('ref'), accountId: 'friend', now });
    expect(out && out.result.days).toBe(0);
    expect(out && out.state.referralBinds[0].referrerId).toBe('ref');
    expect(out && out.state.referralJournal[0]).toMatchObject({ friendId: 'friend', referrerId: 'ref', status: 'waiting', days: 0, reason: 'bind' });
    expect(out && out.state.referralJournal[0].id).toBeTruthy();
    expect(out && out.state.subscriptions[0].paidUntil).toBe(src.subscriptions[0].paidUntil);
  });

  it('accepts the code without the hyphen', () => {
    const compact = referralCodeFor('ref').replace(/-/g, '');
    const out = redeemReferralCode(base(), { code: compact, accountId: 'friend', now });
    expect(out && out.result.kind).toBe('referral');
  });

  it('rejects the referrer, the same Telegram, a second use, and a switched-off program', () => {
    const own = redeemReferralCode(base(), { code: referralCodeFor('ref'), accountId: 'ref', now });
    expect(own && own.result.error).toBe('bad_promo');
    const same = base();
    same.accounts[1].telegramId = '1';
    expect(redeemReferralCode(same, { code: referralCodeFor('ref'), accountId: 'friend', now })!.result.error).toBe('bad_promo');
    const once = redeemReferralCode(base(), { code: referralCodeFor('ref'), accountId: 'friend', now });
    expect(redeemReferralCode(once!.state, { code: referralCodeFor('ref'), accountId: 'friend', now })!.result.error).toBe('already');
    const off = base();
    off.settings.referral.enabled = false;
    expect(redeemReferralCode(off, { code: referralCodeFor('ref'), accountId: 'friend', now })!.result.error).toBe('bad_promo');
  });

  it('does not steal an ordinary promo code', () => {
    expect(redeemReferralCode(base(), { code: 'SALE50', accountId: 'friend', now })).toBeNull();
  });

  it('grants days only after the friend paid and the delay passed', () => {
    const bound = redeemReferralCode(base(), { code: referralCodeFor('ref'), accountId: 'friend', now });
    const state = bound!.state;
    state.accounts = state.accounts;
    state.subscriptions.push({ id: 's-ref', accountId: 'ref', product: 'jackett', paidUntil: now + 40 * 86400000, extraSlots: 0 });
    state.settings.referral.referrerDays = 7;
    state.settings.referral.delayDays = 7;
    const early = settleReferrals(state, now + 3 * 86400000);
    expect(early.granted).toBe(0);
    expect(early.state.subscriptions.find((s) => s.id === 's-ref')!.paidUntil).toBe(now + 40 * 86400000);
    const paidAt = now + 86400000;
    const withPay = {
      ...state,
      payments: [{ accountId: 'friend', at: paidAt }],
    };
    const soon = settleReferrals(withPay, paidAt + 2 * 86400000);
    expect(soon.granted).toBe(0);
    expect(soon.state.referralJournal.find((row) => row.friendId === 'friend')!.reason).toBe('delay');
    const later = settleReferrals(withPay, paidAt + 8 * 86400000);
    expect(later.granted).toBe(1);
    const referrer = later.state.subscriptions.find((s) => s.id === 's-ref')!;
    expect(referrer.paidUntil).toBeGreaterThan(now + 40 * 86400000);
    const again = settleReferrals(later.state, paidAt + 9 * 86400000);
    expect(again.granted).toBe(0);
    expect(again.state.subscriptions.find((s) => s.id === 's-ref')!.paidUntil).toBe(referrer.paidUntil);
  });
});

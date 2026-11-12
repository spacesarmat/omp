import { describe, expect, it } from 'vitest';
import { redeemReferralCode } from '../src/logic.mjs';
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
  it('saves the invitation and adds the friend bonus', () => {
    const out = redeemReferralCode(base(), { code: referralCodeFor('ref'), accountId: 'friend', now });
    expect(out && out.result.days).toBe(3);
    expect(out && out.state.referralBinds[0].referrerId).toBe('ref');
    expect(out && out.state.subscriptions[0].paidUntil).toBeGreaterThan(now);
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
});

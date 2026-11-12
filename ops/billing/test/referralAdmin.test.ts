import { describe, it, expect } from 'vitest';
import { applyReferralPost, normalizeReferralSettings, publicReferral, referralCodeFor } from '../src/referralAdmin.mjs';

describe('referral admin', () => {
  it('starts off and caps bonus days at 14', () => {
    const s = normalizeReferralSettings({});
    expect(s.enabled).toBe(false);
    expect(s.delayDays).toBe(7);
    expect(s.yearlyCap).toBe(12);
    expect(normalizeReferralSettings({ referrerDays: 40, friendDays: 99, enabled: true }).referrerDays).toBe(14);
    expect(normalizeReferralSettings({ friendDays: 20 }).friendDays).toBe(14);
  });

  it('keeps six independent options and cancels a journal row', () => {
    const s = normalizeReferralSettings({
      enabled: false,
      referrerDays: 7,
      friendDays: 3,
      balancePercent: 10,
      tiers: true,
      friendDiscount: true,
      retention: true,
    });
    expect(s.tiers).toBe(true);
    expect(s.friendDiscount).toBe(true);
    expect(s.retention).toBe(true);
    expect(s.balancePercent).toBe(10);
    const out = applyReferralPost(
      { settings: s, cancelId: 'a' },
      [{ id: 'a', friendId: 'friend', status: 'granted', days: 7 }],
      [{ friendId: 'friend', referrerId: 'ref' }],
    );
    expect(out.journal[0].status).toBe('cancelled');
    expect(out.binds).toEqual([]);
    expect(out.settings.enabled).toBe(false);
  });

  it('hides the code while the program is off and counts one referrer', () => {
    expect(publicReferral({}, 'acc-1', []).enabled).toBe(false);
    expect(publicReferral({}, 'acc-1', []).code).toBe('');
    const on = publicReferral({ enabled: true, referrerDays: 7 }, 'acc-1', [
      { referrerId: 'acc-1', status: 'granted', days: 7 },
      { referrerId: 'acc-2', status: 'granted', days: 7 },
      { referrerId: 'acc-1', status: 'cancelled', days: 7 },
    ]);
    expect(on.enabled).toBe(true);
    expect(on.code).toBe(referralCodeFor('acc-1'));
    expect(on.friends).toBe(1);
    expect(on.noticeDays).toBe(7);
    expect(referralCodeFor('acc-1')).toBe(referralCodeFor('acc-1'));
  });
});

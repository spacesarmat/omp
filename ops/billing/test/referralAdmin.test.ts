import { describe, it, expect } from 'vitest';
import { applyReferralPost, normalizeReferralSettings } from '../src/referralAdmin.mjs';

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
    const out = applyReferralPost({ settings: s, cancelId: 'a' }, [{ id: 'a', status: 'granted', days: 7 }]);
    expect(out.journal[0].status).toBe('cancelled');
    expect(out.settings.enabled).toBe(false);
  });
});

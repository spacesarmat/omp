import { describe, it, expect } from 'vitest';
import { REFERRAL_OFF, accrueReferral, clampBonusDays, type ReferralConfig } from '../../src/lib/referral';

const on: ReferralConfig = {
  ...REFERRAL_OFF,
  enabled: true,
  referrerDays: 7,
  monthlyCap: 30,
  yearlyCap: 90,
};

const base = {
  config: on,
  referrerActive: true,
  friendPaid: true,
  selfReferral: false,
  sameDevice: false,
  paymentsToday: 1,
  grantedThisMonth: 0,
  grantedThisYear: 0,
  refunded: false,
};

describe('referral accrual', () => {
  it('stays off until the master flag is on', () => {
    expect(accrueReferral({ ...base, config: REFERRAL_OFF }).status).toBe('rejected');
  });

  it('grants days only when the referrer is active and the friend paid', () => {
    expect(accrueReferral(base)).toEqual({ status: 'granted', days: 7, reason: 'paid' });
    expect(accrueReferral({ ...base, referrerActive: false }).reason).toBe('inactive');
    expect(accrueReferral({ ...base, friendPaid: false }).reason).toBe('inactive');
  });

  it('caps bonus days at 14', () => {
    expect(clampBonusDays(40)).toBe(14);
    expect(accrueReferral({ ...base, config: { ...on, referrerDays: 30 } }).days).toBe(14);
  });

  it('rejects self referral, a shared device and a refund inside the delay', () => {
    expect(accrueReferral({ ...base, selfReferral: true }).reason).toBe('self');
    expect(accrueReferral({ ...base, sameDevice: true }).reason).toBe('self');
    expect(accrueReferral({ ...base, refunded: true }).reason).toBe('refund');
  });

  it('sends more than 5 payments a day to review and keeps over-cap accruals', () => {
    expect(accrueReferral({ ...base, paymentsToday: 6 }).status).toBe('review');
    expect(accrueReferral({ ...base, grantedThisMonth: 30 }).reason).toBe('month');
    expect(accrueReferral({ ...base, grantedThisYear: 90 }).status).toBe('waiting');
  });
});

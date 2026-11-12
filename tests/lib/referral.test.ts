import { describe, it, expect } from 'vitest';
import { REFERRAL_OFF, accrueReferral, cancelReferral, clampBonusDays, inviteView, referralNotice, type ReferralConfig, type ReferralJournalRow } from '../../src/lib/referral';

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

  it('waits seven days, rejects the same Telegram, and stops after twelve months', () => {
    expect(accrueReferral({ ...base, paidDaysAgo: 3 }).reason).toBe('delay');
    expect(accrueReferral({ ...base, paidDaysAgo: 7 }).status).toBe('granted');
    expect(accrueReferral({ ...base, sameTelegram: true }).reason).toBe('telegram');
    expect(accrueReferral({ ...base, grantedMonthsThisYear: 12 }).reason).toBe('year');
    expect(REFERRAL_OFF.enabled).toBe(false);
    expect(REFERRAL_OFF.yearlyCap).toBe(12);
    expect(REFERRAL_OFF.delayDays).toBe(7);
  });

  it('cancels a journal row and writes a notice only after a grant', () => {
    const rows: ReferralJournalRow[] = [{ id: 'a', friendId: 'f', status: 'granted', days: 7, reason: 'paid' }];
    expect(cancelReferral(rows, 'a')[0].status).toBe('cancelled');
    expect(cancelReferral(rows, 'a')[0].reason).toBe('manual');
    expect(referralNotice(rows[0])).toEqual({ days: 7 });
    expect(referralNotice(cancelReferral(rows, 'a')[0])).toBeNull();
  });

  it('hides the invite while the program is off', () => {
    expect(inviteView({ enabled: false, code: 'OMP-1', friends: 4 }).link).toBe('');
    const onCard = inviteView({ enabled: true, code: 'OMP-1', friends: 4 });
    expect(onCard.link).toBe('https://omp-player.online/r/OMP-1');
    expect(onCard.friends).toBe(4);
  });
});

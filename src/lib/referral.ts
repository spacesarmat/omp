// Referral accrual rules. The master switch is off until an admin turns the program on.
// Several options may be on at once. A bonus is granted only when the referrer still has
// an active subscription and the friend has paid.

export const REFERRAL_BONUS_DAYS_MAX = 14;
export const REFERRAL_DELAY_DAYS = 7;
export const REFERRAL_DAILY_REVIEW = 5;

export interface ReferralConfig {
  enabled: boolean;
  referrerDays: number;
  friendDays: number;
  balancePercent: number;
  tiers: boolean;
  friendDiscount: boolean;
  retention: boolean;
  stack: boolean;
  delayDays: number;
  monthlyCap: number;
  yearlyCap: number;
}

export const REFERRAL_OFF: ReferralConfig = {
  enabled: false,
  referrerDays: 0,
  friendDays: 0,
  balancePercent: 0,
  tiers: false,
  friendDiscount: false,
  retention: false,
  stack: false,
  delayDays: REFERRAL_DELAY_DAYS,
  monthlyCap: 0,
  yearlyCap: 0,
};

export type AccrualStatus = 'granted' | 'waiting' | 'rejected' | 'review';

export interface AccrualInput {
  config: ReferralConfig;
  referrerActive: boolean;
  friendPaid: boolean;
  selfReferral: boolean;
  sameDevice: boolean;
  paymentsToday: number;
  grantedThisMonth: number;
  grantedThisYear: number;
  refunded: boolean;
}

export interface Accrual {
  status: AccrualStatus;
  days: number;
  reason: string;
}

export function clampBonusDays(days: number): number {
  if (!isFinite(days) || days <= 0) return 0;
  return Math.min(REFERRAL_BONUS_DAYS_MAX, Math.floor(days));
}

/** One paid friend, one accrual. Over the cap it is kept as waiting or rejected, never dropped. */
export function accrueReferral(input: AccrualInput): Accrual {
  const cfg = input.config;
  if (!cfg.enabled) return { status: 'rejected', days: 0, reason: 'off' };
  if (input.selfReferral || input.sameDevice) return { status: 'rejected', days: 0, reason: 'self' };
  if (input.refunded) return { status: 'rejected', days: 0, reason: 'refund' };
  if (!input.referrerActive || !input.friendPaid) return { status: 'rejected', days: 0, reason: 'inactive' };
  if (input.paymentsToday > REFERRAL_DAILY_REVIEW) return { status: 'review', days: 0, reason: 'daily' };
  const days = clampBonusDays(cfg.referrerDays);
  if (cfg.monthlyCap > 0 && input.grantedThisMonth >= cfg.monthlyCap) {
    return { status: 'rejected', days: 0, reason: 'month' };
  }
  if (cfg.yearlyCap > 0 && input.grantedThisYear >= cfg.yearlyCap) {
    return { status: 'waiting', days, reason: 'year' };
  }
  return { status: 'granted', days, reason: 'paid' };
}

// Referral accrual rules. The master switch is off until an admin turns the program on.
// Several options may be on at once. A bonus is granted only when the referrer still has
// an active subscription and the friend has paid.

export const REFERRAL_BONUS_DAYS_MAX = 14;
export const REFERRAL_DELAY_DAYS = 7;
export const REFERRAL_DAILY_REVIEW = 5;
/** A referrer can receive at most twelve months of bonus in one year. */
export const REFERRAL_YEAR_MONTHS = 12;

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
  yearlyCap: REFERRAL_YEAR_MONTHS,
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
  /** Months of bonus already granted this year. Absent means zero. */
  grantedMonthsThisYear?: number;
  /** Days since the friend's payment. Absent means the delay has already passed. */
  paidDaysAgo?: number;
  /** The same Telegram account as the referrer. */
  sameTelegram?: boolean;
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
  if (input.sameTelegram) return { status: 'rejected', days: 0, reason: 'telegram' };
  if (input.refunded) return { status: 'rejected', days: 0, reason: 'refund' };
  if (!input.referrerActive || !input.friendPaid) return { status: 'rejected', days: 0, reason: 'inactive' };
  const waited = input.paidDaysAgo === undefined ? cfg.delayDays : input.paidDaysAgo;
  if (waited < cfg.delayDays) return { status: 'waiting', days: 0, reason: 'delay' };
  if (input.paymentsToday > REFERRAL_DAILY_REVIEW) return { status: 'review', days: 0, reason: 'daily' };
  const days = clampBonusDays(cfg.referrerDays);
  if ((input.grantedMonthsThisYear || 0) >= REFERRAL_YEAR_MONTHS) return { status: 'waiting', days: 0, reason: 'year' };
  if (cfg.monthlyCap > 0 && input.grantedThisMonth >= cfg.monthlyCap) {
    return { status: 'rejected', days: 0, reason: 'month' };
  }
  if (cfg.yearlyCap > 0 && input.grantedThisYear >= cfg.yearlyCap) {
    return { status: 'waiting', days, reason: 'year' };
  }
  return { status: 'granted', days, reason: 'paid' };
}

export type JournalStatus = AccrualStatus | 'cancelled';

export interface ReferralJournalRow {
  id: string;
  friendId: string;
  status: JournalStatus;
  days: number;
  reason: string;
}

/** Manual cancel. The row stays in the journal. */
export function cancelReferral(rows: ReferralJournalRow[], id: string): ReferralJournalRow[] {
  return rows.map((row) => (row.id === id && row.status !== 'cancelled' ? { ...row, status: 'cancelled', reason: 'manual' } : row));
}

/** Days to announce. Copy lives in the dictionaries. */
export function referralNotice(row: ReferralJournalRow): { days: number } | null {
  if (row.status !== 'granted' || row.days <= 0) return null;
  return { days: row.days };
}

export interface InviteView {
  enabled: boolean;
  code: string;
  link: string;
  friends: number;
}

/** Invite card. Empty when the master flag is off. */
export function inviteView(o: { enabled: boolean; code: string; friends: number }): InviteView {
  const code = o.enabled ? (o.code || '').trim() : '';
  return {
    enabled: o.enabled,
    code,
    link: code ? 'https://omp-player.online/r/' + encodeURIComponent(code) : '',
    friends: o.enabled ? o.friends : 0,
  };
}

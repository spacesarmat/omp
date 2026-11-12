/** Admin-side referral settings. The master flag starts off. Bonus days never exceed 14. */

export const REFERRAL_BONUS_MAX = 14;
export const REFERRAL_YEAR_MONTHS = 12;

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function flag(v) {
  return v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
}

export function normalizeReferralSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: flag(src.enabled),
    referrerDays: Math.min(REFERRAL_BONUS_MAX, num(src.referrerDays, 0)),
    friendDays: Math.min(REFERRAL_BONUS_MAX, num(src.friendDays, 0)),
    balancePercent: Math.min(100, num(src.balancePercent, 0)),
    tiers: flag(src.tiers),
    friendDiscount: flag(src.friendDiscount),
    retention: flag(src.retention),
    stack: flag(src.stack),
    delayDays: src.delayDays === undefined ? 7 : num(src.delayDays, 7),
    monthlyCap: num(src.monthlyCap, 0),
    yearlyCap: src.yearlyCap === undefined ? REFERRAL_YEAR_MONTHS : num(src.yearlyCap, REFERRAL_YEAR_MONTHS),
  };
}

export function cancelReferralRow(rows, id) {
  return (rows || []).map((row) => (row.id === id ? { ...row, status: 'cancelled', reason: 'manual' } : row));
}

/** POST /admin/referral. Does not talk to Telegram. */
export function applyReferralPost(body, journal) {
  const src = body && typeof body === 'object' ? body : {};
  const settings = normalizeReferralSettings(src.settings || src);
  const next = src.cancelId ? cancelReferralRow(journal, String(src.cancelId)) : journal || [];
  return { settings, journal: next };
}

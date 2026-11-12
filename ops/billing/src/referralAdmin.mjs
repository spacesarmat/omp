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

/** Stable invite code for one account. The same id always gets the same code. */
export function referralCodeFor(accountId) {
  const id = String(accountId || '');
  let n = 2166136261;
  for (let i = 0; i < id.length; i++) {
    n ^= id.charCodeAt(i);
    n = Math.imul(n, 16777619);
  }
  return 'OMP-' + (n >>> 0).toString(36).toUpperCase();
}

/**
 * What /v1/me tells the phone. Off until the master flag is on.
 * Friends are journal rows of this referrer that were not cancelled or rejected.
 */
export function publicReferral(settings, accountId, journal, binds) {
  const s = normalizeReferralSettings(settings);
  if (!s.enabled || !accountId) return { enabled: false, code: '', friends: 0, noticeDays: 0 };
  let friends = 0;
  let noticeDays = 0;
  if (Array.isArray(binds)) {
    for (let i = 0; i < binds.length; i++) if (binds[i] && binds[i].referrerId === accountId) friends++;
  }
  const rows = journal || [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.referrerId !== accountId) continue;
    if (row.status === 'cancelled' || row.status === 'rejected') continue;
    if (!Array.isArray(binds)) friends++;
    if (row.status === 'granted' && row.days > 0) noticeDays = row.days;
  }
  return { enabled: true, code: referralCodeFor(accountId), friends, noticeDays };
}

/** POST /admin/referral. Does not talk to Telegram. Cancelling a row also drops that friend's bind. */
export function applyReferralPost(body, journal, binds) {
  const src = body && typeof body === 'object' ? body : {};
  const settings = normalizeReferralSettings(src.settings || src);
  const list = journal || [];
  const next = src.cancelId ? cancelReferralRow(list, String(src.cancelId)) : list;
  let nextBinds = binds || [];
  if (src.cancelId) {
    const row = list.find((item) => item && item.id === String(src.cancelId));
    if (row && row.friendId) nextBinds = nextBinds.filter((item) => !item || item.friendId !== row.friendId);
  }
  return { settings, journal: next, binds: nextBinds };
}

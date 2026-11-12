/** Admin-side referral settings. The master flag starts off. Bonus days never exceed 14. */
import { randomId } from './crypto.mjs';

export const REFERRAL_BONUS_MAX = 14;
export const REFERRAL_YEAR_MONTHS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
const MSK_OFFSET = 3 * 60 * 60 * 1000;
const MONTH_MIN = 27 * DAY_MS;
const MONTH_MAX = 45 * DAY_MS;

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function cap(v, fallback, max) {
  return Math.min(max, num(v, fallback));
}

function flag(v) {
  return v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
}

function tierListOf(src) {
  const raw = Array.isArray(src.tierList) ? src.tierList : [];
  const out = [];
  for (let i = 0; i < raw.length && out.length < 12; i++) {
    const row = raw[i];
    if (!row || typeof row !== 'object') continue;
    const friends = num(row.friends, 0);
    if (friends < 1) continue;
    out.push({
      friends: Math.min(10000, friends),
      days: Math.min(REFERRAL_BONUS_MAX, num(row.days, 0)),
      percent: Math.min(100, num(row.percent, 0)),
    });
  }
  out.sort((a, b) => a.friends - b.friends);
  const uniq = [];
  for (let i = 0; i < out.length; i++) {
    if (uniq.length && uniq[uniq.length - 1].friends === out[i].friends) uniq[uniq.length - 1] = out[i];
    else uniq.push(out[i]);
  }
  return uniq;
}

export function normalizeReferralSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: flag(src.enabled),
    referrerDays: Math.min(REFERRAL_BONUS_MAX, num(src.referrerDays, 0)),
    friendDays: Math.min(REFERRAL_BONUS_MAX, num(src.friendDays, 0)),
    balance: flag(src.balance),
    balancePercent: Math.min(100, num(src.balancePercent, 0)),
    balanceMax: cap(src.balanceMax, 0, 1000000),
    balanceMonthlyCap: cap(src.balanceMonthlyCap, 0, 1000000),
    tiers: flag(src.tiers),
    tierList: tierListOf(src),
    friendDiscount: flag(src.friendDiscount),
    friendDiscountPercent: Math.min(100, num(src.friendDiscountPercent, 0)),
    friendDiscountRub: cap(src.friendDiscountRub, 0, 1000000),
    friendDiscountDays: cap(src.friendDiscountDays, 0, 3650),
    retention: flag(src.retention),
    retentionMonths: cap(src.retentionMonths, 3, 36),
    retentionDays: Math.min(REFERRAL_BONUS_MAX, num(src.retentionDays, 0)),
    stack: flag(src.stack),
    delayDays: src.delayDays === undefined ? 7 : cap(src.delayDays, 7, 365),
    monthlyCap: num(src.monthlyCap, 0),
    yearlyCap: src.yearlyCap === undefined ? REFERRAL_YEAR_MONTHS : cap(src.yearlyCap, REFERRAL_YEAR_MONTHS, 120),
  };
}

/** Highest tier whose friend threshold is already reached. */
export function tierFor(list, paidFriends) {
  const n = Math.floor(Number(paidFriends) || 0);
  let best = null;
  const rows = Array.isArray(list) ? list : [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.friends > n) continue;
    if (!best || row.friends >= best.friends) best = row;
  }
  return best;
}

export function offerDays(settings, paidFriends) {
  const s = normalizeReferralSettings(settings);
  let days = Math.min(REFERRAL_BONUS_MAX, s.referrerDays);
  if (s.tiers) {
    const tier = tierFor(s.tierList, paidFriends);
    if (tier && tier.days > days) days = tier.days;
  }
  return days;
}

export function offerPercent(settings, paidFriends) {
  const s = normalizeReferralSettings(settings);
  let percent = s.balance ? s.balancePercent : 0;
  if (s.tiers) {
    const tier = tierFor(s.tierList, paidFriends);
    if (tier && tier.percent > percent) percent = tier.percent;
  }
  return percent;
}

/** Rub off the subscription base. 0 unless the friend discount is on and still open. */
export function referralDiscountRub(settings, opts) {
  const s = normalizeReferralSettings(settings);
  if (!s.enabled || !s.friendDiscount) return 0;
  if (!opts || !opts.referrerActive || opts.alreadyPaid) return 0;
  const base = Math.floor(Number(opts.baseRub) || 0);
  if (base <= 1) return 0;
  const boundAt = Number(opts.boundAt) || 0;
  const now = Number(opts.now) || 0;
  if (s.friendDiscountDays > 0 && boundAt > 0 && now > boundAt + s.friendDiscountDays * DAY_MS) return 0;
  let off = 0;
  if (s.friendDiscountPercent > 0) off += Math.floor((base * s.friendDiscountPercent) / 100);
  if (s.friendDiscountRub > 0) off += s.friendDiscountRub;
  return Math.max(0, Math.min(off, base - 1));
}

/** Payments at least 27 and at most 45 days apart count as consecutive months. */
export function retentionStreak(times, boundAt) {
  const from = Number(boundAt) || 0;
  const list = (times || []).map((t) => Number(t) || 0).filter((t) => t >= from).sort((a, b) => a - b);
  let streak = 0;
  let prev = 0;
  let at = 0;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!prev) {
      streak = 1;
      prev = t;
      at = t;
      continue;
    }
    const gap = t - prev;
    if (gap < MONTH_MIN) continue;
    if (gap > MONTH_MAX) {
      streak = 1;
      prev = t;
      at = t;
      continue;
    }
    streak += 1;
    prev = t;
    at = t;
  }
  return { count: streak, at };
}

export function mskMonthStart(ms) {
  const d = new Date(Number(ms) + MSK_OFFSET);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - MSK_OFFSET;
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/** 15.01.2026 03:00 МСК. Same clock as logic.mjs mskDateTime. */
export function referralMsk(ms) {
  const d = new Date(Number(ms) + MSK_OFFSET);
  return pad2(d.getUTCDate()) + '.' + pad2(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear() + ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ' МСК';
}

function variantName(v) {
  if (v === 'balance') return 'баланс';
  if (v === 'retention') return 'удержание';
  return 'дни';
}

function daysVariant(row) {
  return !row.variant || row.variant === 'days';
}

function shrinkDays(sub, days, now) {
  const have = Number(sub && sub.paidUntil) || 0;
  const cut = Math.max(0, Math.floor(Number(days) || 0)) * DAY_MS;
  if (!sub || cut <= 0) return { sub, removed: 0, short: 0 };
  const removable = Math.max(0, have - now);
  const taken = Math.min(cut, removable);
  const short = Math.ceil((cut - taken) / DAY_MS);
  const removed = Math.max(0, Math.floor(Number(days) || 0) - short);
  return { sub: { ...sub, paidUntil: have - taken }, removed, short };
}

function pushAudit(state, row) {
  const audit = (state.audit || []).concat([row]).slice(-200);
  return { ...state, audit };
}

/**
 * One journal cancel. A pending row is only marked. A granted row gives days and balance back.
 * What no longer exists is named in `note` and on the row.
 */
export function reverseReferralRow(state, id, now, actor) {
  const when = now || Date.now();
  const list = (state.referralJournal || []).slice();
  const idx = list.findIndex((row) => row && row.id === id);
  if (idx < 0) return { state, note: 'Начисление не найдено', changed: false };
  const row = list[idx];
  if (row.status === 'cancelled') return { state, note: '', changed: false };
  const variant = row.variant || 'days';
  let subscriptions = (state.subscriptions || []).slice();
  let binds = (state.referralBinds || []).slice();
  const bits = ['Отмена ' + variantName(variant) + '.'];
  const missing = [];
  if (row.status !== 'granted') {
    bits.push('Бонус ещё не выдан.');
    if (daysVariant(row) && row.friendId) {
      binds = binds.filter((item) => !item || item.friendId !== row.friendId);
      for (let i = 0; i < list.length; i++) {
        const other = list[i];
        if (!other || other.id === row.id || other.friendId !== row.friendId || other.referrerId !== row.referrerId) continue;
        if (other.status === 'waiting' || other.status === 'rejected') list[i] = { ...other, status: 'cancelled', reason: 'manual' };
      }
    }
  } else {
    const removed = [];
    const takeDays = (accountId, days) => {
      const n = Math.max(0, Math.floor(Number(days) || 0));
      if (!n) return;
      const sub = subscriptions.find((item) => item && item.accountId === accountId && item.product === 'jackett');
      if (!sub) {
        missing.push(n + ' дн. (нет подписки)');
        return;
      }
      const out = shrinkDays(sub, n, when);
      subscriptions = subscriptions.map((item) => (item.id === sub.id ? out.sub : item));
      if (out.removed > 0) removed.push(out.removed + ' дн.');
      if (out.short > 0) missing.push(out.short + ' дн. (уже использованы)');
    };
    takeDays(row.referrerId, row.days);
    if (row.friendGranted) takeDays(row.friendId, row.friendDays);
    const credit = Math.max(0, Math.floor(Number(row.credit) || 0));
    if (credit > 0) {
      const sub = subscriptions.find((item) => item && item.accountId === row.referrerId && item.product === 'jackett');
      const have = Math.max(0, Math.floor(Number(sub && sub.creditRub) || 0));
      if (!sub) missing.push(credit + ' ₽ (нет подписки)');
      else {
        const take = Math.min(have, credit);
        subscriptions = subscriptions.map((item) => (item.id === sub.id ? { ...item, creditRub: have - take } : item));
        if (take > 0) removed.push(take + ' ₽');
        if (credit > take) missing.push(credit - take + ' ₽ (уже потрачены)');
      }
    }
    if (removed.length) bits.push('Снято ' + removed.join(' и ') + '.');
    if (daysVariant(row) && row.friendId) binds = binds.filter((item) => !item || item.friendId !== row.friendId);
  }
  const shortfall = missing.join(', ');
  if (shortfall) bits.push('Не снято: ' + shortfall + '.');
  bits.push(referralMsk(when));
  const note = bits.join(' ');
  list[idx] = { ...row, status: 'cancelled', reason: 'manual', reversedAt: when, shortfall };
  const who = actor && actor.kind ? actor : { kind: 'admin', id: '', label: 'панель' };
  const next = pushAudit(
    { ...state, referralJournal: list, referralBinds: binds, subscriptions },
    { id: randomId(), at: when, action: 'referral_cancel', detail: note, actor: who, accountId: row.referrerId || '' },
  );
  return { state: next, note, changed: true };
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
  if (!s.enabled || !accountId) return { enabled: false, code: '', friends: 0, noticeDays: 0, noticeCredit: 0 };
  let friends = 0;
  let noticeDays = 0;
  let noticeCredit = 0;
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
    if (row.status === 'granted' && row.credit > 0) noticeCredit = row.credit;
  }
  return { enabled: true, code: referralCodeFor(accountId), friends, noticeDays, noticeCredit };
}

/** One bot message per referrer, plus the friend's own day gift. A second call is empty. */
export function claimReferralNotices(state) {
  const rows = state.referralJournal || [];
  let pending = false;
  for (let i = 0; i < rows.length; i++) if (rows[i] && (rows[i].noticePending || rows[i].friendNoticePending)) pending = true;
  if (!pending) return { state, messages: [] };
  const byRef = new Map();
  const journal = rows.map((row) => {
    if (!row || (!row.noticePending && !row.friendNoticePending)) return row;
    const next = {
      ...row,
      noticePending: false,
      friendNoticePending: false,
      noticeTries: (Number(row.noticeTries) || 0) + 1,
    };
    if (row.noticePending) {
      const bucket = byRef.get(row.referrerId) || { days: 0, credit: 0, retention: 0, restore: [] };
      if (row.variant === 'balance') bucket.credit += Math.max(0, Math.floor(Number(row.credit) || 0));
      else if (row.variant === 'retention') bucket.retention += Math.max(0, Math.floor(Number(row.days) || 0));
      else bucket.days += Math.max(0, Math.floor(Number(row.days) || 0));
      bucket.restore.push({ id: row.id, noticePending: true, friendNoticePending: false });
      byRef.set(row.referrerId, bucket);
    }
    return next;
  });
  const accounts = state.accounts || [];
  const chatOf = (id) => {
    const acc = accounts.find((item) => item && item.id === id);
    return acc && acc.telegramId ? String(acc.telegramId) : '';
  };
  const messages = [];
  for (const [id, bucket] of byRef) {
    const chatId = chatOf(id);
    const parts = [];
    if (bucket.days) parts.push(bucket.days + ' дн.');
    if (bucket.retention) parts.push('удержание ' + bucket.retention + ' дн.');
    if (bucket.credit) parts.push(bucket.credit + ' ₽ на баланс');
    if (chatId && parts.length) {
      messages.push({ chatId, text: 'Друг оплатил подписку. Вам начислено ' + parts.join(' и ') + '.', restore: bucket.restore });
    }
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.friendNoticePending || !(row.friendDays > 0)) continue;
    const chatId = chatOf(row.friendId);
    if (chatId) {
      messages.push({
        chatId,
        text: 'По приглашению вам начислено ' + row.friendDays + ' дн.',
        restore: [{ id: row.id, noticePending: false, friendNoticePending: true }],
      });
    }
  }
  return { state: { ...state, referralJournal: journal }, messages };
}

/** Telegram did not take the notice. Put it back until three tries are used. */
export function restoreReferralNotices(state, restore) {
  const back = new Map();
  const list = restore || [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item || !item.id) continue;
    const prev = back.get(item.id) || { noticePending: false, friendNoticePending: false };
    back.set(item.id, {
      id: item.id,
      noticePending: prev.noticePending || !!item.noticePending,
      friendNoticePending: prev.friendNoticePending || !!item.friendNoticePending,
    });
  }
  if (!back.size) return state;
  let changed = false;
  const journal = (state.referralJournal || []).map((row) => {
    const item = row && back.get(row.id);
    if (!item || (Number(row.noticeTries) || 0) >= 3) return row;
    changed = true;
    return { ...row, noticePending: !!item.noticePending, friendNoticePending: !!item.friendNoticePending };
  });
  return changed ? { ...state, referralJournal: journal } : state;
}

/** POST /admin/referral. Does not talk to Telegram. Cancelling a granted row reverses it. */
export function applyReferralPost(body, stateOrJournal, bindsOrCtx) {
  const legacy = Array.isArray(stateOrJournal);
  const state = legacy
    ? { referralJournal: stateOrJournal || [], referralBinds: bindsOrCtx || [], settings: {}, subscriptions: [], accounts: [], audit: [] }
    : stateOrJournal && typeof stateOrJournal === 'object'
      ? stateOrJournal
      : {};
  const ctx = legacy || !bindsOrCtx || Array.isArray(bindsOrCtx) ? {} : bindsOrCtx;
  const src = body && typeof body === 'object' ? body : {};
  const settings = normalizeReferralSettings(src.settings || src);
  let next = {
    ...state,
    settings: { ...(state.settings || {}), referral: settings },
    referralJournal: (state.referralJournal || []).slice(),
    referralBinds: (state.referralBinds || []).slice(),
    subscriptions: (state.subscriptions || []).slice(),
  };
  let note = '';
  if (src.cancelId) {
    const rev = reverseReferralRow(next, String(src.cancelId), ctx.now || Date.now(), ctx.actor);
    next = rev.state;
    next.settings = { ...(next.settings || {}), referral: settings };
    note = rev.note || '';
  }
  return { settings, journal: next.referralJournal, binds: next.referralBinds, state: next, note };
}

/** Fill the arrays the store writes, and the NOT NULL journal columns. */
export function normalizeReferralState(state) {
  if (!state || typeof state !== 'object') return state;
  const journal = Array.isArray(state.referralJournal) ? state.referralJournal : [];
  const binds = Array.isArray(state.referralBinds) ? state.referralBinds : [];
  return {
    ...state,
    referralJournal: journal.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const at = Number(row.at);
      const days = Number(row.days);
      const next = {
        ...row,
        id: typeof row.id === 'string' && row.id ? row.id : randomId(),
        at: Number.isSafeInteger(at) ? at : Number.isFinite(at) ? Math.floor(at) : 0,
        days: Number.isSafeInteger(days) ? days : Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 0,
        status: typeof row.status === 'string' ? row.status : 'waiting',
        reason: typeof row.reason === 'string' ? row.reason : '',
      };
      if (row.credit != null) {
        const credit = Number(row.credit);
        next.credit = Number.isSafeInteger(credit) ? credit : Math.max(0, Math.floor(credit) || 0);
      }
      return next;
    }),
    referralBinds: binds.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const boundAt = Number(row.boundAt);
      return {
        ...row,
        code: typeof row.code === 'string' ? row.code : '',
        boundAt: Number.isSafeInteger(boundAt) ? boundAt : Number.isFinite(boundAt) ? Math.floor(boundAt) : 0,
      };
    }),
  };
}

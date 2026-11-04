// Is the OMP subscription on for this phone? Read synchronously from localStorage, so the app and the background
// check page (another JS context) agree without a request. /v1/me (fetchBillingAccount) is the only confirmation.
//
// Rules:
// - No cached answer for this session: not subscribed. A paidUntil on the session is not enough, and the old
//   3 days after paidUntil are not added.
// - active with accessUntil in the future: subscribed until that server date (the server already included its
//   grace). A later paidUntil stored from the server (a token refresh) counts until that date too, with no
//   extra days on top.
// - active but accessUntil is 0 (the server sent no end date): subscribed only until the session paidUntil.
//   Nothing is added after that date.
// - active false, or the date has passed: not subscribed.
//
// Paid sources at startup use a confirmation from the last PREMIUM_FRESH_MS only. Older than that, they stay
// off until /v1/me answers again. Ads and the monitoring cap keep a server date while offline (a failed recheck
// does not wipe it). Chromium 53 safe.
import { isObject, loadJson, saveJson } from '../store/storage';
import { billingSession, sessionKey } from './session';

export const ACCESS_KEY = 'tsp.billingAccess';
/** How long a /v1/me answer may turn paid sources on before the next answer. Also the steady recheck gap. */
export const PREMIUM_FRESH_MS = 6 * 60 * 60 * 1000;
/** On resume, skip /v1/me when the last answer is newer than this. */
export const PREMIUM_RESUME_MIN_MS = 15 * 60 * 1000;
/**
 * Monitoring subscriptions kept without a premium confirmation. /v1/me `monitorMax` uses the same number.
 * 0 from the server means no cap. The rows themselves stay on the phone.
 */
export const MONITOR_FREE_MAX = 10;

export interface AccessInput {
  active: boolean;
  /** /v1/me accessUntil, unix ms. 0 or omitted: the server did not send a date. */
  accessUntil?: number;
  /** When this answer was saved, unix ms. Omitted: now. */
  checkedAt?: number;
  jackett?: boolean;
  jacred?: boolean;
  /** 0: no monitoring cap. Omitted: this answer did not say. */
  monitorMax?: number;
}

interface AccessRecord {
  /** Key of the session the answer is for (sessionKey): a new code or a cleared session ignores an old answer. */
  token: string;
  /** /v1/me `active`: paid or in grace, and not over the device limit. */
  active: boolean;
  /** /v1/me `accessUntil` (unix ms). 0: the server did not send a date. */
  accessUntil: number;
  /** When /v1/me was saved (unix ms). 0: a cache written before this field existed. */
  checkedAt: number;
  jackett?: boolean;
  jacred?: boolean;
  monitorMax?: number;
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

function parseAccess(v: unknown): AccessRecord | null {
  if (!isObject(v)) return null;
  if (typeof v.token !== 'string' || typeof v.active !== 'boolean' || typeof v.accessUntil !== 'number') return null;
  const checked = finite(v.checkedAt);
  const rec: AccessRecord = {
    token: v.token,
    active: v.active,
    accessUntil: v.accessUntil,
    checkedAt: checked !== null && checked > 0 ? checked : 0,
  };
  if (v.jackett === true || v.jackett === false) rec.jackett = v.jackett;
  if (v.jacred === true || v.jacred === false) rec.jacred = v.jacred;
  const cap = finite(v.monitorMax);
  if (cap !== null && cap >= 0 && cap <= 10000) rec.monitorMax = Math.floor(cap);
  return rec;
}

function loadAccess(): AccessRecord | null {
  const raw = loadJson<unknown>(ACCESS_KEY, null, (v) => v === null || parseAccess(v) !== null);
  return parseAccess(raw);
}

function accessForSession(): { sessionPaid: number; rec: AccessRecord } | null {
  const session = billingSession();
  if (!session) return null;
  const rec = loadAccess();
  if (!rec || rec.token !== sessionKey(session)) return null;
  return { sessionPaid: session.paidUntil || 0, rec };
}

/** Remembers the answer of /v1/me for the current session (null forgets it). */
export function saveBillingAccess(acc: AccessInput | null): void {
  const session = billingSession();
  if (!acc || !session) {
    saveJson(ACCESS_KEY, null);
    return;
  }
  const row: AccessRecord = {
    token: sessionKey(session),
    active: !!acc.active,
    accessUntil: acc.accessUntil && acc.accessUntil > 0 ? acc.accessUntil : 0,
    checkedAt: acc.checkedAt && acc.checkedAt > 0 ? acc.checkedAt : Date.now(),
  };
  if (acc.jackett === true || acc.jackett === false) row.jackett = acc.jackett;
  if (acc.jacred === true || acc.jacred === false) row.jacred = acc.jacred;
  if (typeof acc.monitorMax === 'number' && isFinite(acc.monitorMax) && acc.monitorMax >= 0) row.monitorMax = Math.floor(acc.monitorMax);
  saveJson(ACCESS_KEY, row);
}

/**
 * True when this /v1/me answer would not change what ads, the cap or paid sources already use.
 * `checkedAt` alone does not count: saving a newer stamp must not notify the account screen.
 */
export function billingAccessMatches(acc: AccessInput): boolean {
  const row = accessForSession();
  if (!row) return false;
  const rec = row.rec;
  const until = acc.accessUntil && acc.accessUntil > 0 ? acc.accessUntil : 0;
  if (rec.active !== !!acc.active || rec.accessUntil !== until) return false;
  if ((acc.jackett === true || acc.jackett === false) && rec.jackett !== acc.jackett) return false;
  if ((acc.jacred === true || acc.jacred === false) && rec.jacred !== acc.jacred) return false;
  if (typeof acc.monitorMax === 'number' && isFinite(acc.monitorMax) && rec.monitorMax !== Math.floor(acc.monitorMax)) return false;
  return true;
}

/**
 * True while this phone's OMP subscription is confirmed.
 * No answer for this session: false. No accessUntil: only until session.paidUntil, with no added grace days.
 */
export function ompSubscribed(now?: number): boolean {
  const row = accessForSession();
  if (!row || !row.rec.active) return false;
  const at = now === undefined ? Date.now() : now;
  if (row.rec.accessUntil > 0) return at < Math.max(row.rec.accessUntil, row.sessionPaid);
  return row.sessionPaid > 0 && at < row.sessionPaid;
}

/** Unix ms of the cached /v1/me for this session, or 0 when there is none. */
export function premiumCheckedAt(): number {
  const row = accessForSession();
  return row ? row.rec.checkedAt : 0;
}

/**
 * Jackett/JacRed flags from a /v1/me that is still inside PREMIUM_FRESH_MS.
 * Null: do not turn paid sources on (no confirmation, or it is older than the window).
 * A fresh active answer that did not name sources turns both on, matching an old server.
 */
export function freshPremiumSources(now?: number): { jackett: boolean; jacred: boolean } | null {
  const at = now === undefined ? Date.now() : now;
  if (!ompSubscribed(at)) return null;
  const row = accessForSession();
  if (!row || !row.rec.checkedAt) return null;
  if (row.rec.checkedAt > at + 60000) return null;
  if (at - row.rec.checkedAt > PREMIUM_FRESH_MS) return null;
  if (row.rec.jackett !== true && row.rec.jackett !== false && row.rec.jacred !== true && row.rec.jacred !== false) {
    return { jackett: true, jacred: true };
  }
  return { jackett: row.rec.jackett === true, jacred: row.rec.jacred === true };
}

/**
 * Monitoring cap from the last /v1/me for this session.
 * 0: no cap (premium, or a server that said so). MONITOR_FREE_MAX when premium is not confirmed.
 * A positive monitorMax is used even while premium is on, so a later server cap is honoured.
 */
export function monitorMax(now?: number): number {
  const at = now === undefined ? Date.now() : now;
  const row = accessForSession();
  if (ompSubscribed(at)) {
    if (row && typeof row.rec.monitorMax === 'number') return row.rec.monitorMax;
    return 0;
  }
  if (row && typeof row.rec.monitorMax === 'number' && row.rec.monitorMax > 0) return row.rec.monitorMax;
  return MONITOR_FREE_MAX;
}

/** Legacy token just moved to a pair id. Same login, new key. */
let movedFrom = '';
let movedTo = '';

/** Keeps the cached /v1/me answer when a session gets a new key (the one-time move off the legacy token). */
export function rekeyBillingAccess(from: string, to: string): void {
  if (from && to && from !== to) {
    movedFrom = from;
    movedTo = to;
  }
  const rec = loadAccess();
  if (!rec || !from || rec.token !== from) return;
  const next: AccessRecord = {
    token: to,
    active: rec.active,
    accessUntil: rec.accessUntil,
    checkedAt: rec.checkedAt,
  };
  if (rec.jackett === true || rec.jackett === false) next.jackett = rec.jackett;
  if (rec.jacred === true || rec.jacred === false) next.jacred = rec.jacred;
  if (typeof rec.monitorMax === 'number') next.monitorMax = rec.monitorMax;
  saveJson(ACCESS_KEY, next);
}

/**
 * True when `now` is the login `started` captured, including the one-time move off the legacy token.
 * No token on both sides is the same request (Telegram linked, no code). A code that appeared or
 * went away while the request ran is a different login.
 */
export function sameLogin(started: string, now: string): boolean {
  if (started === now) return true;
  if (!started || !now) return false;
  return started === movedFrom && now === movedTo;
}

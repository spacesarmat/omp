// Is the OMP subscription on for this phone? Read synchronously from localStorage, so the app and the background check
// page (another JS context) agree without a request. The grace period counts as active; a phone over the device limit
// does not. /v1/me (fetchBillingAccount) refreshes the cached answer; without one the session date plus the default
// grace is used. Chromium 53 safe.
import { isObject, loadJson, saveJson } from '../store/storage';
import { billingSession } from './session';

export const ACCESS_KEY = 'tsp.billingAccess';
/** Grace period of the billing server by default (days after paidUntil while search still works). */
export const DEFAULT_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

interface AccessRecord {
  /** The session token the answer is for: a new code or a cleared session ignores an old answer. */
  token: string;
  /** /v1/me `active`: paid or in grace, and not over the device limit. */
  active: boolean;
  /** /v1/me `accessUntil` (unix ms), 0 when the server does not say. */
  accessUntil: number;
}

function isRecord(v: unknown): boolean {
  return isObject(v) && typeof v.token === 'string' && typeof v.active === 'boolean' && typeof v.accessUntil === 'number';
}

/** Remembers the answer of /v1/me for the current session (null forgets it). */
export function saveBillingAccess(acc: { active: boolean; accessUntil?: number } | null): void {
  const session = billingSession();
  if (!acc || !session) {
    saveJson(ACCESS_KEY, null);
    return;
  }
  const row: AccessRecord = { token: session.token, active: !!acc.active, accessUntil: acc.accessUntil && acc.accessUntil > 0 ? acc.accessUntil : 0 };
  saveJson(ACCESS_KEY, row);
}

/** True while the OMP subscription works on this phone (grace included). */
export function ompSubscribed(now?: number): boolean {
  const session = billingSession();
  if (!session) return false;
  const at = now === undefined ? Date.now() : now;
  const fallback = session.paidUntil > 0 ? session.paidUntil + DEFAULT_GRACE_MS : 0;
  const rec = loadJson<AccessRecord | null>(ACCESS_KEY, null, (v) => v === null || isRecord(v));
  if (!rec || rec.token !== session.token) return at < fallback;
  if (!rec.active) return false;
  // a renewal seen later (a newer paidUntil in the session) still counts until /v1/me answers again
  return at < Math.max(rec.accessUntil || fallback, session.paidUntil);
}

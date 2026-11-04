// Monitoring without a confirmed OMP subscription: at most FREE_SUBS_MAX subscriptions (or the cap from the last
// /v1/me, monitorMax). Adding one more is refused; the ones already saved above the cap stay, but only the oldest
// `cap` (by createdAt) are checked, the rest are paused until the cap lifts. cap <= 0 means no limit. Shared by
// the app and the background page; Chromium 53 safe.
import { monitorMax } from '../billing/entitlement';
import { isObject, loadJson, saveJson } from '../store/storage';
import { forgetSeen, FREE_SUBS_MAX, loadSubs } from './subs';
import type { Subscription } from './types';

export { FREE_SUBS_MAX };

/** Oldest first; equal stamps keep the stored order. */
function oldestFirst(list: Subscription[]): Subscription[] {
  return list
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.createdAt || 0) - (b.s.createdAt || 0) || a.i - b.i)
    .map((x) => x.s);
}

/**
 * Ids of the paused subscriptions of `list`.
 * `cap` <= 0: no cap (premium). Otherwise only the `cap` oldest stay active.
 */
export function pausedSubIds(list: Subscription[], cap: number): { [id: string]: true } {
  const out: { [id: string]: true } = {};
  if (cap <= 0) return out;
  oldestFirst(list)
    .slice(cap)
    .forEach((s) => (out[s.id] = true));
  return out;
}

/** The subscriptions that are checked, in the order of `list`. */
export function activeSubs(list: Subscription[], cap: number): Subscription[] {
  const paused = pausedSubIds(list, cap);
  return list.filter((s) => !paused[s.id]);
}

/** One more subscription may be added. `cap` <= 0: always. */
export function canAddSub(list: Subscription[], cap: number): boolean {
  return cap <= 0 || list.length < cap;
}

/** «7 из 10» under a cap; null when there is no cap. */
export function subsQuota(list: Subscription[], cap: number): { used: number; max: number } | null {
  return cap <= 0 ? null : { used: list.length, max: cap };
}

// --- the same against the saved list and the cached billing state

/** Ids paused at the last check gate: a subscription leaving the pause gets a quiet first check. */
export const PAUSED_KEY = 'tsp.subsPaused';

/**
 * Remembers which subscriptions are paused now. One that was paused and no longer is forgets its seen results, so its
 * next check only records what is there (like the very first one) instead of reporting everything that came out
 * during the pause. Called by every check gate (isSubPaused, checkedSubs) before a check can run.
 */
export function syncPaused(list: Subscription[], cap: number): { [id: string]: true } {
  const now = pausedSubIds(list, cap);
  const before = loadJson<{ [id: string]: true }>(PAUSED_KEY, {}, isObject);
  let changed = false;
  Object.keys(before).forEach((id) => {
    if (now[id]) return;
    changed = true;
    if (list.some((s) => s.id === id)) forgetSeen(id);
  });
  Object.keys(now).forEach((id) => {
    if (!before[id]) changed = true;
  });
  if (changed) saveJson(PAUSED_KEY, now);
  return now;
}

export function subsLimitReached(now?: number): boolean {
  return !canAddSub(loadSubs(), monitorMax(now));
}

export function isSubPaused(id: string, now?: number): boolean {
  return syncPaused(loadSubs(), monitorMax(now))[id] === true;
}

/** The saved subscriptions the checks may run (all when monitorMax is 0). */
export function checkedSubs(now?: number): Subscription[] {
  const list = loadSubs();
  const paused = syncPaused(list, monitorMax(now));
  return list.filter((s) => !paused[s.id]);
}

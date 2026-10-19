// Monitoring without the OMP subscription: at most FREE_SUBS_MAX subscriptions. Adding one more is refused; the ones
// already saved above the cap stay, but only the FREE_SUBS_MAX oldest (by createdAt) are checked, the rest are paused
// until the subscription is on again. Shared by the app and the background page; Chromium 53 safe.
import { ompSubscribed } from '../billing/entitlement';
import { FREE_SUBS_MAX, loadSubs } from './subs';
import type { Subscription } from './types';

export { FREE_SUBS_MAX };

/** Oldest first; equal stamps keep the stored order. */
function oldestFirst(list: Subscription[]): Subscription[] {
  return list
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.createdAt || 0) - (b.s.createdAt || 0) || a.i - b.i)
    .map((x) => x.s);
}

/** Ids of the paused subscriptions of `list` (none with the subscription on). */
export function pausedSubIds(list: Subscription[], subscribed: boolean): { [id: string]: true } {
  const out: { [id: string]: true } = {};
  if (subscribed) return out;
  oldestFirst(list)
    .slice(FREE_SUBS_MAX)
    .forEach((s) => (out[s.id] = true));
  return out;
}

/** The subscriptions that are checked, in the order of `list`. */
export function activeSubs(list: Subscription[], subscribed: boolean): Subscription[] {
  const paused = pausedSubIds(list, subscribed);
  return list.filter((s) => !paused[s.id]);
}

/** One more subscription may be added. */
export function canAddSub(list: Subscription[], subscribed: boolean): boolean {
  return subscribed || list.length < FREE_SUBS_MAX;
}

/** «7 из 10» without the subscription; null with it (no limit). */
export function subsQuota(list: Subscription[], subscribed: boolean): { used: number; max: number } | null {
  return subscribed ? null : { used: list.length, max: FREE_SUBS_MAX };
}

// --- the same against the saved list and the cached billing state

export function subsLimitReached(now?: number): boolean {
  return !canAddSub(loadSubs(), ompSubscribed(now));
}

export function isSubPaused(id: string, now?: number): boolean {
  return pausedSubIds(loadSubs(), ompSubscribed(now))[id] === true;
}

/** The saved subscriptions the checks may run (all with the subscription on). */
export function checkedSubs(now?: number): Subscription[] {
  return activeSubs(loadSubs(), ompSubscribed(now));
}

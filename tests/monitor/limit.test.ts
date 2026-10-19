import { describe, it, expect, beforeEach } from 'vitest';
import { ACCESS_KEY, DEFAULT_GRACE_MS, ompSubscribed, saveBillingAccess } from '../../src/billing/entitlement';
import { saveBillingSession } from '../../src/billing/session';
import { activeSubs, canAddSub, checkedSubs, FREE_SUBS_MAX, isSubPaused, pausedSubIds, subsLimitReached, subsQuota } from '../../src/monitor/limit';
import { addSubscription, loadSubs, removeSubscription, saveSubs } from '../../src/monitor/subs';
import { clearBilling } from '../../src/sources/ompJackett';
import type { Subscription } from '../../src/monitor/types';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const sub = (i: number, createdAt: number): Subscription => ({ id: 's' + i, query: 'Запрос ' + i, quality: '', sources: null, notify: true, createdAt });

/** n subscriptions, created 1..n (s1 the oldest). */
function many(n: number): Subscription[] {
  const out: Subscription[] = [];
  for (let i = 1; i <= n; i++) out.push(sub(i, i));
  return out;
}

const subscribe = (paidUntil = NOW + 10 * DAY) => saveBillingSession({ token: 'tok', paidUntil });

beforeEach(() => localStorage.clear());

describe('the cap without the OMP subscription', () => {
  it('pauses all but the FREE_SUBS_MAX oldest, by createdAt and not by the stored order', () => {
    expect(FREE_SUBS_MAX).toBe(10);
    const list = many(12).reverse(); // newest stored first
    expect(Object.keys(pausedSubIds(list, false)).sort()).toEqual(['s11', 's12']);
    expect(activeSubs(list, false).map((s) => s.id)).toEqual(['s10', 's9', 's8', 's7', 's6', 's5', 's4', 's3', 's2', 's1']);
    expect(pausedSubIds(many(10), false)).toEqual({});
  });

  it('equal stamps keep the stored order', () => {
    const list = many(11).map((s) => ({ ...s, createdAt: 5 }));
    expect(Object.keys(pausedSubIds(list, false))).toEqual(['s11']);
  });

  it('with the subscription nothing is paused and there is no limit', () => {
    const list = many(25);
    expect(pausedSubIds(list, true)).toEqual({});
    expect(activeSubs(list, true)).toHaveLength(25);
    expect(canAddSub(list, true)).toBe(true);
    expect(subsQuota(list, true)).toBeNull();
  });

  it('allows the 10th, refuses the 11th; the quota reads «N из 10»', () => {
    expect(canAddSub(many(9), false)).toBe(true);
    expect(canAddSub(many(10), false)).toBe(false);
    expect(canAddSub(many(14), false)).toBe(false);
    expect(subsQuota(many(7), false)).toEqual({ used: 7, max: 10 });
    expect(subsQuota(many(12), false)).toEqual({ used: 12, max: 10 });
  });

  it('addSubscription refuses the 11th without the subscription and accepts it with one', () => {
    for (let i = 0; i < 10; i++) expect(addSubscription({ query: 'Q' + i, quality: '', sources: null, notify: true }, NOW + i)).not.toBeNull();
    expect(subsLimitReached(NOW)).toBe(true);
    expect(addSubscription({ query: 'Одиннадцатая', quality: '', sources: null, notify: true }, NOW + 20)).toBeNull();
    expect(loadSubs()).toHaveLength(10);
    subscribe();
    expect(subsLimitReached(NOW)).toBe(false);
    expect(addSubscription({ query: 'Одиннадцатая', quality: '', sources: null, notify: true }, NOW + 20)).not.toBeNull();
    expect(loadSubs()).toHaveLength(11);
  });

  it('deleting one frees a slot and unpauses the next oldest', () => {
    saveSubs(many(12));
    expect(isSubPaused('s11', NOW)).toBe(true);
    removeSubscription('s3');
    expect(isSubPaused('s11', NOW)).toBe(false);
    expect(isSubPaused('s12', NOW)).toBe(true);
  });
});

describe('entitlement switching', () => {
  it('checks 10 without the subscription, all with it, and 10 again after it ends; nothing is deleted', () => {
    saveSubs(many(12));
    expect(checkedSubs(NOW)).toHaveLength(10);
    subscribe();
    expect(checkedSubs(NOW)).toHaveLength(12);
    expect(isSubPaused('s12', NOW)).toBe(false);
    clearBilling();
    expect(checkedSubs(NOW)).toHaveLength(10);
    expect(isSubPaused('s12', NOW)).toBe(true);
    expect(loadSubs()).toHaveLength(12);
  });

  it('no session: not subscribed', () => {
    expect(ompSubscribed(NOW)).toBe(false);
  });

  it('without /v1/me: paidUntil plus the default 3-day grace', () => {
    subscribe(NOW - DAY);
    expect(DEFAULT_GRACE_MS).toBe(3 * DAY);
    expect(ompSubscribed(NOW)).toBe(true); // in grace
    expect(ompSubscribed(NOW + 2 * DAY - 1)).toBe(true);
    expect(ompSubscribed(NOW + 2 * DAY)).toBe(false);
  });

  it('/v1/me answer: active until accessUntil (grace counts), inactive (over the device limit) is off', () => {
    subscribe(NOW - DAY);
    saveBillingAccess({ active: true, accessUntil: NOW + DAY });
    expect(ompSubscribed(NOW)).toBe(true);
    expect(ompSubscribed(NOW + DAY)).toBe(false);
    saveBillingAccess({ active: false, accessUntil: NOW + DAY });
    expect(ompSubscribed(NOW)).toBe(false);
  });

  it('a renewal seen in the session counts before /v1/me answers again', () => {
    subscribe(NOW - DAY);
    saveBillingAccess({ active: true, accessUntil: NOW + DAY });
    subscribe(NOW + 30 * DAY);
    expect(ompSubscribed(NOW + 10 * DAY)).toBe(true);
  });

  it('an answer for another session (a new code) is ignored; clearBilling forgets it', () => {
    subscribe();
    saveBillingAccess({ active: false, accessUntil: 0 });
    expect(ompSubscribed(NOW)).toBe(false);
    saveBillingSession({ token: 'new', paidUntil: NOW + 30 * DAY });
    expect(ompSubscribed(NOW)).toBe(true);
    clearBilling();
    expect(localStorage.getItem(ACCESS_KEY)).toBe('null');
    expect(ompSubscribed(NOW)).toBe(false);
  });
});

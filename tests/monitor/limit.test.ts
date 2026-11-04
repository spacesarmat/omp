import { describe, it, expect, beforeEach } from 'vitest';
import { ACCESS_KEY, MONITOR_FREE_MAX, ompSubscribed, saveBillingAccess } from '../../src/billing/entitlement';
import { saveBillingSession } from '../../src/billing/session';
import { activeSubs, canAddSub, checkedSubs, FREE_SUBS_MAX, isSubPaused, PAUSED_KEY, pausedSubIds, subsLimitReached, subsQuota, syncPaused } from '../../src/monitor/limit';
import { addSubscription, loadSubs, rememberSeen, removeSubscription, saveSubs, seenKeys } from '../../src/monitor/subs';
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
/** A server-confirmed premium answer (accessUntil, no monitoring cap). */
const confirm = (accessUntil = NOW + 10 * DAY) => saveBillingAccess({ active: true, accessUntil, monitorMax: 0, checkedAt: NOW });

beforeEach(() => localStorage.clear());

describe('the cap without the OMP subscription', () => {
  it('pauses all but the FREE_SUBS_MAX oldest, by createdAt and not by the stored order', () => {
    expect(FREE_SUBS_MAX).toBe(10);
    const list = many(12).reverse(); // newest stored first
    expect(Object.keys(pausedSubIds(list, FREE_SUBS_MAX)).sort()).toEqual(['s11', 's12']);
    expect(activeSubs(list, FREE_SUBS_MAX).map((s) => s.id)).toEqual(['s10', 's9', 's8', 's7', 's6', 's5', 's4', 's3', 's2', 's1']);
    expect(pausedSubIds(many(10), FREE_SUBS_MAX)).toEqual({});
  });

  it('equal stamps keep the stored order', () => {
    const list = many(11).map((s) => ({ ...s, createdAt: 5 }));
    expect(Object.keys(pausedSubIds(list, FREE_SUBS_MAX))).toEqual(['s11']);
  });

  it('with the subscription nothing is paused and there is no limit', () => {
    const list = many(25);
    expect(pausedSubIds(list, 0)).toEqual({});
    expect(activeSubs(list, 0)).toHaveLength(25);
    expect(canAddSub(list, 0)).toBe(true);
    expect(subsQuota(list, 0)).toBeNull();
  });

  it('allows the 10th, refuses the 11th; the quota reads «N из 10»', () => {
    expect(canAddSub(many(9), FREE_SUBS_MAX)).toBe(true);
    expect(canAddSub(many(10), FREE_SUBS_MAX)).toBe(false);
    expect(canAddSub(many(14), FREE_SUBS_MAX)).toBe(false);
    expect(subsQuota(many(7), FREE_SUBS_MAX)).toEqual({ used: 7, max: 10 });
    expect(subsQuota(many(12), FREE_SUBS_MAX)).toEqual({ used: 12, max: 10 });
  });

  it('addSubscription refuses the 11th without the subscription and accepts it with one', () => {
    for (let i = 0; i < 10; i++) expect(addSubscription({ query: 'Q' + i, quality: '', sources: null, notify: true }, NOW + i)).not.toBeNull();
    expect(subsLimitReached(NOW)).toBe(true);
    expect(addSubscription({ query: 'Одиннадцатая', quality: '', sources: null, notify: true }, NOW + 20)).toBeNull();
    expect(loadSubs()).toHaveLength(10);
    subscribe();
    confirm();
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
    confirm();
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

  it('without /v1/me there is no subscription and no 3-day grace', () => {
    subscribe(NOW + 10 * DAY);
    expect(ompSubscribed(NOW)).toBe(false);
    subscribe(NOW - DAY);
    expect(ompSubscribed(NOW)).toBe(false);
    expect(ompSubscribed(NOW - DAY + 1000)).toBe(false);
    expect(MONITOR_FREE_MAX).toBe(10);
  });

  it('active with no accessUntil lasts only until paidUntil, with no added days', () => {
    subscribe(NOW + DAY);
    saveBillingAccess({ active: true, accessUntil: 0, checkedAt: NOW });
    expect(ompSubscribed(NOW)).toBe(true);
    expect(ompSubscribed(NOW + DAY)).toBe(false);
    subscribe(NOW - DAY);
    saveBillingAccess({ active: true, accessUntil: 0, checkedAt: NOW });
    expect(ompSubscribed(NOW)).toBe(false);
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
    expect(ompSubscribed(NOW)).toBe(false);
    saveBillingAccess({ active: true, accessUntil: NOW + 30 * DAY, checkedAt: NOW });
    expect(ompSubscribed(NOW)).toBe(true);
    clearBilling();
    expect(localStorage.getItem(ACCESS_KEY)).toBe('null');
    expect(ompSubscribed(NOW)).toBe(false);
  });
});

describe('leaving the pause: a quiet first check', () => {
  it('a subscription that was paused forgets its seen results when the pause ends; the others keep theirs', () => {
    saveSubs(many(11));
    rememberSeen('s1', ['a'], ['rutor']);
    rememberSeen('s11', ['b'], ['rutor']);
    expect(checkedSubs(NOW).map((s) => s.id)).not.toContain('s11'); // the gate records the pause
    expect(JSON.parse(localStorage.getItem(PAUSED_KEY)!)).toEqual({ s11: true });
    expect(seenKeys('s11')).toEqual(['b']);
    subscribe();
    confirm();
    expect(isSubPaused('s11', NOW)).toBe(false);
    expect(seenKeys('s11')).toBeNull(); // the next check is silent, like the very first
    expect(seenKeys('s1')).toEqual(['a']);
    expect(JSON.parse(localStorage.getItem(PAUSED_KEY)!)).toEqual({});
  });

  it('only a recorded pause counts: a subscription never seen paused keeps its results', () => {
    saveSubs(many(11));
    rememberSeen('s11', ['b'], ['rutor']);
    subscribe();
    confirm();
    expect(checkedSubs(NOW)).toHaveLength(11);
    expect(seenKeys('s11')).toEqual(['b']);
  });

  it('deleting an older one unpauses the next quietly too; a deleted paused one is just dropped', () => {
    saveSubs(many(12));
    rememberSeen('s11', ['b'], ['rutor']);
    syncPaused(loadSubs(), FREE_SUBS_MAX);
    removeSubscription('s12');
    removeSubscription('s1');
    expect(isSubPaused('s11', NOW)).toBe(false);
    expect(seenKeys('s11')).toBeNull();
    expect(JSON.parse(localStorage.getItem(PAUSED_KEY)!)).toEqual({});
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MONITOR_FREE_MAX,
  PREMIUM_FRESH_MS,
  PREMIUM_RESUME_MIN_MS,
  freshPremiumSources,
  monitorMax,
  ompSubscribed,
  saveBillingAccess,
} from '../../src/billing/entitlement';
import { nextRecheckDelay, premiumRecheckDue, recheckPremium, startPremiumRecheck } from '../../src/billing/recheck';
import { saveBillingSession } from '../../src/billing/session';
import { OMP_JACRED_ID, OMP_JACKETT_ID, syncOmpJackett } from '../../src/sources/ompJackett';
import { getSource, unregisterSource } from '../../src/sources/registry';
import type { HttpResponse } from '../../src/sources/types';
import { fakeSite, page } from '../sources/fakeSite';

const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  localStorage.clear();
  unregisterSource(OMP_JACKETT_ID);
  unregisterSource(OMP_JACRED_ID);
});

afterEach(() => {
  unregisterSource(OMP_JACKETT_ID);
  unregisterSource(OMP_JACRED_ID);
});

describe('premium confirmation', () => {
  it('turns paid sources on only from a /v1/me inside the last 6 hours', () => {
    const now = Date.now();
    saveBillingSession({ token: 'tok', paidUntil: now + 30 * 24 * HOUR });
    syncOmpJackett();
    expect(getSource(OMP_JACKETT_ID)).toBeUndefined();
    expect(freshPremiumSources(now)).toBeNull();

    saveBillingAccess({ active: true, accessUntil: now + 10 * 24 * HOUR, jackett: true, jacred: false, checkedAt: now - HOUR, monitorMax: 0 });
    expect(freshPremiumSources(now)).toEqual({ jackett: true, jacred: false });
    syncOmpJackett();
    expect(getSource(OMP_JACKETT_ID)?.id).toBe(OMP_JACKETT_ID);
    expect(getSource(OMP_JACRED_ID)).toBeUndefined();

    const paidUntil = now + 30 * 24 * HOUR;
    const accessUntil = now + 10 * 24 * HOUR;
    saveBillingSession(null);
    syncOmpJackett();
    saveBillingSession({ token: 'tok', paidUntil });
    saveBillingAccess({ active: true, accessUntil, jackett: true, jacred: true, checkedAt: now - PREMIUM_FRESH_MS - 1, monitorMax: 0 });
    expect(ompSubscribed(now)).toBe(true);
    expect(freshPremiumSources(now)).toBeNull();
    syncOmpJackett();
    // still subscribed on the server date, but this process has no fresh confirmation, so sources stay off
    expect(getSource(OMP_JACKETT_ID)).toBeUndefined();
    expect(getSource(OMP_JACRED_ID)).toBeUndefined();
  });

  it('uses monitorMax from the server, and 10 when premium is not confirmed', () => {
    const now = Date.now();
    expect(monitorMax(now)).toBe(MONITOR_FREE_MAX);
    saveBillingSession({ token: 'tok', paidUntil: now + 10 * 24 * HOUR });
    expect(monitorMax(now)).toBe(10);
    saveBillingAccess({ active: true, accessUntil: now + 10 * 24 * HOUR, monitorMax: 0, checkedAt: now });
    expect(monitorMax(now)).toBe(0);
    saveBillingAccess({ active: true, accessUntil: now + 10 * 24 * HOUR, monitorMax: 8, checkedAt: now });
    expect(monitorMax(now)).toBe(8);
    expect(ompSubscribed(now)).toBe(true);
    saveBillingAccess({ active: false, accessUntil: now + 10 * 24 * HOUR, monitorMax: 8, checkedAt: now });
    expect(ompSubscribed(now)).toBe(false);
    expect(monitorMax(now)).toBe(8);
  });

  it('asks /v1/me on resume after 15 minutes and every 6 hours, and keeps sources when the network fails', async () => {
    const now = Date.now();
    saveBillingSession({ token: 'tok', paidUntil: now + 30 * 24 * HOUR });
    saveBillingAccess({ active: true, accessUntil: now + 10 * 24 * HOUR, jackett: true, jacred: true, monitorMax: 0, checkedAt: now - 10 * 60 * 1000 });
    syncOmpJackett();
    expect(premiumRecheckDue(now, 'resume')).toBe(false);
    expect(premiumRecheckDue(now, 'interval')).toBe(false);
    expect(premiumRecheckDue(now + PREMIUM_RESUME_MIN_MS, 'resume')).toBe(true);
    expect(premiumRecheckDue(now + PREMIUM_FRESH_MS, 'interval')).toBe(true);

    const offline = fakeSite(() => Promise.reject(new Error('offline')));
    await recheckPremium(offline.ctx, 'resume', now + PREMIUM_RESUME_MIN_MS);
    expect(offline.calls.some((c) => c.url.indexOf('/v1/me') > 0)).toBe(true);
    expect(ompSubscribed()).toBe(true);
    expect(getSource(OMP_JACKETT_ID)?.id).toBe(OMP_JACKETT_ID);

    const quiet = fakeSite((c) => page('{}', c.url));
    await recheckPremium(quiet.ctx, 'resume', now);
    expect(quiet.calls).toEqual([]);
  });

  it('a due recheck that says the subscription ended turns sources off and applies the free cap', async () => {
    const now = Date.now();
    saveBillingSession({ token: 'tok', paidUntil: now + 10 * 24 * HOUR });
    saveBillingAccess({ active: true, accessUntil: now + 10 * 24 * HOUR, jackett: true, jacred: true, monitorMax: 0, checkedAt: now - PREMIUM_FRESH_MS - 1 });
    syncOmpJackett({ jackett: true, jacred: true });
    const site = fakeSite((c) =>
      page(JSON.stringify({ active: false, paidUntil: now - 1000, accessUntil: now - 1000, monitorMax: 10, sources: { jackett: false, jacred: false } }), c.url),
    );
    await recheckPremium(site.ctx, 'interval', now);
    expect(ompSubscribed(now)).toBe(false);
    expect(monitorMax(now)).toBe(10);
    expect(getSource(OMP_JACKETT_ID)).toBeUndefined();
    expect(getSource(OMP_JACRED_ID)).toBeUndefined();
  });

  it('the next interval is 6 hours after the answer, even when that answer lands after the wait began', async () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      saveBillingSession({ token: 'tok', paidUntil: start + 30 * 24 * HOUR });
      let release: (r: HttpResponse) => void = () => undefined;
      const gate = new Promise<HttpResponse>((resolve) => { release = resolve; });
      const site = fakeSite(() => gate);
      const stop = startPremiumRecheck(() => site.ctx);
      for (let i = 0; i < 30 && site.calls.length === 0; i++) await Promise.resolve();
      expect(site.calls.filter((c) => c.url.indexOf('/v1/me') >= 0)).toHaveLength(1);

      // The startup answer is 30s late. A timer started at open would fire 30s before this answer is 6h old and skip it.
      await vi.advanceTimersByTimeAsync(30_000);
      release(page(JSON.stringify({
        active: true,
        paidUntil: start + 30 * 24 * HOUR,
        accessUntil: start + 30 * 24 * HOUR,
        monitorMax: 0,
        sources: { jackett: true, jacred: true },
      }), 'http://billing'));
      for (let i = 0; i < 40; i++) await Promise.resolve();
      expect(nextRecheckDelay(Date.now())).toBe(PREMIUM_FRESH_MS);

      await vi.advanceTimersByTimeAsync(PREMIUM_FRESH_MS - 1);
      expect(site.calls.filter((c) => c.url.indexOf('/v1/me') >= 0)).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      for (let i = 0; i < 40 && site.calls.filter((c) => c.url.indexOf('/v1/me') >= 0).length < 2; i++) await Promise.resolve();
      expect(site.calls.filter((c) => c.url.indexOf('/v1/me') >= 0)).toHaveLength(2);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('startPremiumRecheck asks once at startup when the cache is stale, and stops', async () => {
    const now = Date.now();
    saveBillingSession({ token: 'tok', paidUntil: now + 10 * 24 * HOUR });
    saveBillingAccess({ active: true, accessUntil: now + HOUR, checkedAt: now - PREMIUM_RESUME_MIN_MS - 1, monitorMax: 0, jackett: false, jacred: true });
    const site = fakeSite((c) =>
      page(JSON.stringify({ active: true, paidUntil: now + 10 * 24 * HOUR, accessUntil: now + 10 * 24 * HOUR, monitorMax: 0, sources: { jackett: true, jacred: false } }), c.url),
    );
    const stop = startPremiumRecheck(() => site.ctx);
    for (let i = 0; i < 50 && !site.calls.some((c) => c.url.indexOf('/v1/me') > 0); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    stop();
    expect(site.calls.filter((c) => c.url.indexOf('/v1/me') > 0)).toHaveLength(1);
    expect(getSource(OMP_JACKETT_ID)?.id).toBe(OMP_JACKETT_ID);
    expect(getSource(OMP_JACRED_ID)).toBeUndefined();
  });
});

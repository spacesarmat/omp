import { describe, expect, it } from 'vitest';
import { emptyState } from '../src/state.mjs';
import {
  addCredit,
  applyRollback,
  cpuPercent,
  diskAlert,
  funnelView,
  ingestPresence,
  parsePresence,
  paymentFee,
  rankingView,
  restartAllowed,
  roleOf,
  setWatchFlag,
  snapshotSettings,
  spikeAlert,
} from '../src/desk.mjs';
import { publishAdmin, resetAdminLive, sseChunk, sseHeartbeat, SSE_HEADERS, subscribeAdmin } from '../src/adminLive.mjs';

describe('admin desk', () => {
  it('keeps readers from writing and leaves the shell link full', () => {
    const settings = { adminReaders: '42, 7' };
    expect(roleOf(settings, { telegramId: '42' })).toBe('read');
    expect(roleOf(settings, { telegramId: '9' })).toBe('full');
    expect(roleOf(settings, { via: 'cli' })).toBe('full');
  });

  it('computes a fee only when the charged sum is known', () => {
    expect(paymentFee({ amount: '99.00', withdrawAmount: '100.00' })).toEqual({ fee: 1, charged: 100 });
    expect(paymentFee({ amount: '99.00' }).fee).toBeNull();
  });

  it('rolls settings back without secrets', () => {
    const before = snapshotSettings({ botUsername: 'old', botToken: 'secret', priceRub: 100, adminReaders: '1' });
    expect(before).not.toHaveProperty('botToken');
    const next = applyRollback({ botUsername: 'new', botToken: 'secret', priceRub: 120 }, before);
    expect(next.botUsername).toBe('old');
    expect(next.botToken).toBe('secret');
    expect(next.priceRub).toBe(100);
  });

  it('stores funnel steps only when diagnostics are on', () => {
    const state = emptyState();
    const off = ingestPresence(state, { diagnostics: false, events: ['install'], key: 'abc', version: '1', platform: 'phone', accountId: '' }, 10);
    expect(off.deskEvents || []).toHaveLength(0);
    const on = ingestPresence(state, { diagnostics: true, events: ['install', 'nope'], key: 'abc', version: '1', platform: 'tv', accountId: 'a1' }, 10);
    expect(on.deskEvents).toEqual([{ name: 'install', at: 10, key: 'abc', accountId: 'a1', version: '1', platform: 'tv' }]);
    expect(parsePresence({ events: 'login,payment', diagnostics: '1', version: '2' }).events).toEqual(['login', 'payment']);
  });

  it('reports conversion and degrades ranking', () => {
    const state = emptyState();
    state.deskEvents = [
      { name: 'install', key: 'a', at: 1 },
      { name: 'install', key: 'b', at: 1 },
      { name: 'login', key: 'a', at: 2 },
    ];
    const funnel = funnelView(state, 100);
    expect(funnel.steps[0].users).toBe(2);
    expect(funnel.steps[1].users).toBe(1);
    expect(funnel.steps[1].conversion).toBe(50);
    expect(rankingView(state).available).toBe(false);
    const missing = setWatchFlag(state, { infohash: 'a'.repeat(40), flag: 'pin', on: true });
    expect(missing.result.error).toBe('unavailable');
  });

  it('credits rubles and alerts on disk and spikes', () => {
    const state = emptyState();
    state.accounts = [{ id: 'a1' }];
    state.subscriptions = [{ id: 's1', accountId: 'a1', product: 'jackett', paidUntil: Date.now() + 86400000, creditRub: 0 }];
    const out = addCredit(state, { accountId: 'a1', rub: 15, now: 5 });
    expect(out.result.creditRub).toBe(15);
    expect(diskAlert('ok', 0.05).text).toContain('10%');
    expect(diskAlert('low', 0.05).text).toBe('');
    expect(spikeAlert(0, 20, 1000).text).toContain('20');
    expect(spikeAlert(1000, 20, 2000).text).toBe('');
  });

  it('allows only the named containers and reads docker cpu', () => {
    expect(restartAllowed('omp-jackett')).toBe(true);
    expect(restartAllowed('/omp-postgres')).toBe(false);
    expect(restartAllowed('omp-billing')).toBe(false);
    const pct = cpuPercent({
      cpu_stats: { online_cpus: 2, system_cpu_usage: 200, cpu_usage: { total_usage: 100 } },
      precpu_stats: { system_cpu_usage: 100, cpu_usage: { total_usage: 50 } },
    });
    expect(pct).toBe(100);
  });

  it('formats an SSE frame with no-transform headers', () => {
    resetAdminLive();
    const got: string[] = [];
    const drop = subscribeAdmin((chunk) => got.push(chunk));
    publishAdmin({ type: 'payment' });
    drop();
    expect(got[0]).toContain('"type":"payment"');
    expect(sseChunk({ type: 'audit' }).endsWith('\n\n')).toBe(true);
    expect(sseHeartbeat().startsWith(':')).toBe(true);
    expect(SSE_HEADERS['cache-control']).toContain('no-transform');
    expect(SSE_HEADERS['x-accel-buffering']).toBe('no');
  });
});

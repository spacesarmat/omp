import { describe, expect, it, beforeEach } from 'vitest';
import { dhtStatsView, noteDhtRequest, resetDhtStats } from '../src/dhtStats.mjs';

const HOUR = 60 * 60 * 1000;

describe('DHT admin counters', () => {
  beforeEach(() => resetDhtStats());

  it('counts 24h requests, the share with peers, and the average time', () => {
    const now = 1_800_000_000_000;
    noteDhtRequest({ status: 200, ms: 100, peers: 4 }, now - 2 * HOUR);
    noteDhtRequest({ status: 200, ms: 300, peers: 0 }, now - HOUR);
    noteDhtRequest({ status: 502, ms: 500, reason: 'down' }, now - 30 * 60 * 1000);
    noteDhtRequest({ status: 200, ms: 100, peers: 2 }, now - 25 * HOUR);
    const view = dhtStatsView(now);
    expect(view.requests24h).toBe(3);
    expect(view.withPeers24h).toBe(1);
    expect(view.peersSharePct).toBe(33.3);
    expect(view.avgMs).toBe(300);
    expect(view.errors).toEqual([{ at: now - 30 * 60 * 1000, status: 502, reason: 'sidecar не ответил' }]);
  });

  it('keeps the last 10 errors and drops a reason that is not a known code', () => {
    const now = 1_800_000_000_000;
    for (let i = 0; i < 12; i++) {
      noteDhtRequest({ status: 401, ms: 1, reason: i === 0 ? 'token=SECRET infohash=abcd' : 'bad_token' }, now - (12 - i) * 1000);
    }
    const view = dhtStatsView(now);
    expect(view.errors).toHaveLength(10);
    expect(view.errors[0].at).toBe(now - 1000);
    expect(view.errors.every((e) => e.reason === 'нет токена' || e.reason === 'ошибка')).toBe(true);
    expect(JSON.stringify(view)).not.toContain('SECRET');
    expect(JSON.stringify(view)).not.toContain('abcd');
    noteDhtRequest({ status: 500, ms: 4, reason: 'down' }, now);
    expect(dhtStatsView(now).errors[0]).toEqual({ at: now, status: 500, reason: 'ошибка биллинга' });
  });

  it('keeps totals after more than 8000 requests in the same day', () => {
    const now = 1_800_000_000_000;
    const n = 8001;
    let withPeers = 0;
    let sumMs = 0;
    for (let i = 0; i < n; i++) {
      const ms = i % 2 === 0 ? 10 : 30;
      const peers = i % 3 === 0 ? 1 : 0;
      if (peers > 0) withPeers++;
      sumMs += ms;
      noteDhtRequest({ status: 200, ms, peers }, now - (i % 50) * 1000);
    }
    for (let i = 0; i < 12; i++) noteDhtRequest({ status: 401, ms: 4, reason: 'bad_token' }, now - i * 1000);
    const view = dhtStatsView(now);
    expect(view.requests24h).toBe(n + 12);
    expect(view.withPeers24h).toBe(withPeers);
    expect(view.avgMs).toBe(Math.round((sumMs + 12 * 4) / (n + 12)));
    expect(view.peersSharePct).toBe(Math.round((withPeers * 1000) / (n + 12)) / 10);
    expect(view.errors).toHaveLength(10);
    expect(view.errors[0].reason).toBe('нет токена');
  });
});

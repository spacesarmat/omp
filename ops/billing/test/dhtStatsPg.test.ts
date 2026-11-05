import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bindDhtStats, dhtStatsView, flushDhtStats, noteDhtRequest, readyDhtStats, resetDhtStats } from '../src/dhtStats.mjs';
import { testStore } from './pg';

const HASH = 'ab'.repeat(20);

describe('DHT stats persistence', () => {
  beforeEach(() => {
    resetDhtStats();
    bindDhtStats(null);
  });
  afterEach(() => {
    resetDhtStats();
    bindDhtStats(null);
  });

  it('reloads buckets, percentiles, series and sanitized errors from Postgres', async () => {
    const now = 1_800_000_000_000;
    const store = await testStore();
    bindDhtStats(store.dht);
    await readyDhtStats();
    noteDhtRequest({ status: 200, ms: 100, peers: 2 }, now - 2 * 60 * 60 * 1000);
    noteDhtRequest({ status: 401, ms: 4, reason: 'token=SECRET infohash=' + HASH }, now - 60 * 1000);
    noteDhtRequest({ status: 502, ms: 500, reason: 'down' }, now);
    noteDhtRequest({ status: 200, ms: 100, peers: 1 }, now - 25 * 60 * 60 * 1000);
    await flushDhtStats(now);

    const dumped = await store.query('SELECT reason FROM dht_recent_error ORDER BY pos');
    const raw = JSON.stringify(dumped.rows);
    expect(raw).not.toContain('SECRET');
    expect(raw).not.toContain(HASH);
    expect(dumped.rows.map((r: { reason: string }) => r.reason)).toEqual(['ошибка', 'sidecar не ответил']);
    await expect(
      store.query('INSERT INTO dht_recent_error (pos, at, status, reason) VALUES (9, 1, 500, $1)', [HASH]),
    ).rejects.toThrow();

    resetDhtStats();
    bindDhtStats(store.dht);
    await readyDhtStats();
    const view = dhtStatsView(now);
    expect(view.requests24h).toBe(3);
    expect(view.withPeers24h).toBe(1);
    expect(view.errors4xx24h).toBe(1);
    expect(view.errors5xx24h).toBe(1);
    expect(view.errors24h).toBe(2);
    expect(view.p50Ms).toBe(100);
    expect(view.p95Ms).toBe(500);
    expect(view.series.reduce((sum, p) => sum + p.requests, 0)).toBe(3);
    expect(view.series.reduce((sum, p) => sum + p.errors, 0)).toBe(2);
    expect(view.errors.map((e) => e.reason)).toEqual(['sidecar не ответил', 'ошибка']);
    expect(JSON.stringify(view)).not.toContain('SECRET');
    expect(JSON.stringify(view)).not.toContain(HASH);
  });

  it('drops a stored minute once it is older than 24h even when no new request arrived', async () => {
    const now = Date.now();
    const store = await testStore();
    bindDhtStats(store.dht);
    await readyDhtStats();
    noteDhtRequest({ status: 200, ms: 20, peers: 1 }, now - 30 * 60 * 1000);
    await flushDhtStats(now);
    expect(Number((await store.query('SELECT COUNT(*)::int AS n FROM dht_minute')).rows[0].n)).toBe(1);
    await flushDhtStats(now + 25 * 60 * 60 * 1000);
    expect(Number((await store.query('SELECT COUNT(*)::int AS n FROM dht_minute')).rows[0].n)).toBe(0);
    expect(dhtStatsView(now + 25 * 60 * 60 * 1000).requests24h).toBe(0);
  });
});

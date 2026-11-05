import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { bindDhtStats, dhtStatsView, flushDhtStats, noteDhtRequest, readyDhtStats, resetDhtStats, shutdownDhtStats } from '../src/dhtStats.mjs';

const HOUR = 60 * 60 * 1000;

describe('DHT admin counters', () => {
  beforeEach(() => {
    resetDhtStats();
    bindDhtStats(null);
  });
  afterEach(() => {
    vi.useRealTimers();
    resetDhtStats();
    bindDhtStats(null);
  });

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
    expect(view.errors24h).toBe(1);
    expect(view.errors4xx24h).toBe(0);
    expect(view.errors5xx24h).toBe(1);
    expect(view.p50Ms).toBe(300);
    expect(view.p95Ms).toBe(500);
    expect(view.series.reduce((sum, p) => sum + p.requests, 0)).toBe(3);
    expect(view.series.reduce((sum, p) => sum + p.errors, 0)).toBe(1);
    expect(view.series.every((p) => p.t <= now && p.t >= now - 25 * HOUR)).toBe(true);
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
    expect(view.errors24h).toBe(12);
    expect(view.errors4xx24h).toBe(12);
    expect(view.errors5xx24h).toBe(0);
    expect(view.p50Ms).toBe(10);
    expect(view.p95Ms).toBe(30);
    expect(view.series.reduce((sum, p) => sum + p.requests, 0)).toBe(n + 12);
    expect(view.errors).toHaveLength(10);
    expect(view.errors[0].reason).toBe('нет токена');
  });

  it('stores an admin probe as the label проверка and drops a raw hash', () => {
    const now = 1_800_000_000_000;
    const hash = 'cd'.repeat(20);
    noteDhtRequest({ status: 400, ms: 8, reason: hash }, now - 1000);
    noteDhtRequest({ status: 502, ms: 20, reason: 'probe', infohash: hash }, now);
    const view = dhtStatsView(now);
    expect(view.errors.map((e) => e.reason)).toEqual(['проверка', 'ошибка']);
    expect(view.errors4xx24h).toBe(1);
    expect(view.errors5xx24h).toBe(1);
    expect(JSON.stringify(view)).not.toContain(hash);
  });

  it('merges counts that arrive while a load is in flight or after a failed load', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    bindDhtStats({
      async load() {
        calls += 1;
        if (calls === 1) {
          await gate;
          throw new Error('down');
        }
        return {
          minutes: [{ minute: 1, count: 4, withPeers: 0, sumMs: 40, errors: 0, errors4xx: 0, errors5xx: 0, hist: [] }],
          errors: [],
        };
      },
      async save() {},
    });
    const first = readyDhtStats();
    noteDhtRequest({ status: 200, ms: 10, peers: 2 }, 60 * 1000);
    release();
    await first;
    expect(dhtStatsView(120 * 1000).requests24h).toBe(1);
    await readyDhtStats();
    const view = dhtStatsView(120 * 1000);
    expect(view.requests24h).toBe(5);
    expect(view.withPeers24h).toBe(1);
  });

  it('retries a failed save and does not retry a read-only refusal', async () => {
    vi.useFakeTimers();
    let calls = 0;
    let mode = 'fail';
    bindDhtStats({
      async load() {
        return { minutes: [], errors: [] };
      },
      async save() {
        calls += 1;
        if (mode === 'fail') throw new Error('down');
        if (mode === 'ro') throw Object.assign(new Error('ro'), { code: 'READ_ONLY' });
      },
    });
    await readyDhtStats();
    noteDhtRequest({ status: 200, ms: 10, peers: 1 }, Date.now());
    await flushDhtStats();
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);
    mode = 'ro';
    noteDhtRequest({ status: 200, ms: 10, peers: 1 }, Date.now());
    await flushDhtStats();
    const seen = calls;
    await vi.advanceTimersByTimeAsync(30000);
    expect(calls).toBe(seen);
  });

  it('flushes pending counts on shutdown and stops waiting when load never ends', async () => {
    const saved: { minutes: { count: number }[] }[] = [];
    bindDhtStats({
      async load() {
        return { minutes: [], errors: [] };
      },
      async save(snap: { minutes: { count: number }[] }) {
        saved.push(snap);
      },
    });
    noteDhtRequest({ status: 200, ms: 15, peers: 1 }, Date.now());
    await shutdownDhtStats(2000);
    expect(saved.length).toBe(1);
    expect(saved[0].minutes.reduce((sum, row) => sum + row.count, 0)).toBe(1);

    resetDhtStats();
    bindDhtStats({
      load() {
        return new Promise(() => {});
      },
      async save() {},
    });
    const started = Date.now();
    await shutdownDhtStats(40);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('arms an idle prune so a quiet process still drops old minutes', async () => {
    const spy = vi.spyOn(global, 'setInterval');
    bindDhtStats({
      async load() {
        return { minutes: [], errors: [] };
      },
      async save() {},
    });
    await readyDhtStats();
    expect(spy.mock.calls.map((call) => call[1])).toContain(60 * 1000);
    spy.mockRestore();
  });
});

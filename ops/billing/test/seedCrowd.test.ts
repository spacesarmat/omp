// Phase 3 crowd counts: pure parse/device-key/aggregate/merge policy and the runSeedCheck wiring.
// No Postgres here - the SQL round-trip lives in seedCrowdPg.test.ts (CI runs it).
import { describe, expect, it } from 'vitest';
import {
  CROWD_BATCH_MAX,
  CROWD_COUNT_CAP,
  CROWD_FRESH_MS,
  CROWD_MIN_DEVICES,
  CROWD_WINDOW_MS,
  aggregateCrowdReports,
  crowdDeviceKey,
  mergeCrowdCounts,
  parseSwarmReports,
} from '../src/seedCrowd.mjs';
import { createMemorySeedCache, runSeedCheck } from '../src/seedProbe.mjs';

const HASH = 'ab'.repeat(20);
const HASH_B = 'cd'.repeat(20);
const NOW = 1_800_000_000_000;

function report(p: Partial<{ infohash: string; deviceKey: string; seeders: number; leechers: number; reportedAt: number }> = {}) {
  return {
    infohash: HASH,
    deviceKey: 'k1',
    seeders: 4,
    leechers: 1,
    reportedAt: NOW - 60_000,
    ...p,
  };
}

describe('parseSwarmReports', () => {
  it('accepts an absent field as an empty batch', () => {
    expect(parseSwarmReports(undefined)).toEqual({ ok: true, items: [] });
    expect(parseSwarmReports(null)).toEqual({ ok: true, items: [] });
  });

  it('normalizes hashes and keeps whole counts only', () => {
    const out = parseSwarmReports([
      { infohash: HASH.toUpperCase(), seeders: 7, leechers: 2 },
      { infohash: 'nope', seeders: 1, leechers: 0 },
      { infohash: HASH_B, seeders: -1, leechers: 0 },
      { infohash: HASH_B, seeders: 1.5, leechers: 0 },
      { infohash: HASH_B, seeders: '3', leechers: 0 },
      { infohash: HASH_B, seeders: 3 },
    ]);
    expect(out.ok).toBe(true);
    expect(out.items).toEqual([{ infohash: HASH, seeders: 7, leechers: 2 }]);
  });

  it('parses the JSON string form the form body carries', () => {
    const out = parseSwarmReports(JSON.stringify([{ infohash: HASH, seeders: 5, leechers: 1 }]));
    expect(out.ok).toBe(true);
    expect(out.items).toEqual([{ infohash: HASH, seeders: 5, leechers: 1 }]);
    expect(parseSwarmReports('nope').ok).toBe(false);
    expect(parseSwarmReports({ infohash: HASH }).ok).toBe(false);
  });

  it('refuses an oversized batch', () => {
    const rows = [];
    for (let i = 0; i <= CROWD_BATCH_MAX; i++) rows.push({ infohash: HASH, seeders: 1, leechers: 0 });
    expect(parseSwarmReports(rows).ok).toBe(false);
  });

  it('caps insane counts and keeps the last report per hash', () => {
    const out = parseSwarmReports([
      { infohash: HASH, seeders: 1, leechers: 0 },
      { infohash: HASH, seeders: CROWD_COUNT_CAP + 500, leechers: CROWD_COUNT_CAP + 1 },
    ]);
    expect(out.items).toEqual([{ infohash: HASH, seeders: CROWD_COUNT_CAP, leechers: CROWD_COUNT_CAP }]);
  });

  it('drops every field but the hash and the counts (privacy)', () => {
    const out = parseSwarmReports([
      { infohash: HASH, seeders: 2, leechers: 1, title: 'Show', trackers: ['http://t/announce'], deviceId: 'dev', telegramId: 42 },
    ]);
    expect(out.items).toEqual([{ infohash: HASH, seeders: 2, leechers: 1 }]);
    expect(JSON.stringify(out.items)).not.toContain('telegram');
  });
});

describe('crowdDeviceKey', () => {
  it('is a stable irreversible hex digest, never the raw id', () => {
    const a = crowdDeviceKey('row-1');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(crowdDeviceKey('row-1'));
    expect(a).not.toContain('row-1');
    expect(crowdDeviceKey('row-2')).not.toBe(a);
    expect(crowdDeviceKey('')).toBe('');
    expect(crowdDeviceKey(null)).toBe('');
  });
});

describe('aggregateCrowdReports', () => {
  it('medians two devices and stamps the oldest contributing report', () => {
    const rows = [
      report({ deviceKey: 'k1', seeders: 2, leechers: 0, reportedAt: NOW - 3_600_000 }),
      report({ deviceKey: 'k2', seeders: 10, leechers: 4, reportedAt: NOW - 60_000 }),
    ];
    const out = aggregateCrowdReports(rows, NOW);
    expect(out.get(HASH)).toEqual({
      seeders: 6,
      leechers: 2,
      devices: 2,
      updatedAt: NOW - 3_600_000,
      source: 'crowd',
    });
  });

  it('takes the true median of three devices, not the max', () => {
    const rows = [
      report({ deviceKey: 'k1', seeders: 1, leechers: 0 }),
      report({ deviceKey: 'k2', seeders: 100, leechers: 50 }),
      report({ deviceKey: 'k3', seeders: 3, leechers: 2 }),
    ];
    const row = aggregateCrowdReports(rows, NOW).get(HASH);
    expect(row && row.seeders).toBe(3);
    expect(row && row.leechers).toBe(2);
    expect(row && row.devices).toBe(3);
  });

  it('a single device is not an estimate', () => {
    expect(aggregateCrowdReports([report()], NOW).size).toBe(0);
    expect(CROWD_MIN_DEVICES).toBe(2);
  });

  it('drops reports outside the 24h window, so one stale device cannot pair with a fresh one', () => {
    const rows = [
      report({ deviceKey: 'k1', reportedAt: NOW - 60_000 }),
      report({ deviceKey: 'k2', reportedAt: NOW - CROWD_WINDOW_MS - 1 }),
    ];
    expect(aggregateCrowdReports(rows, NOW).size).toBe(0);
  });

  it('tolerates a small clock skew but not a future report', () => {
    const rows = [
      report({ deviceKey: 'k1', reportedAt: NOW + 30_000 }),
      report({ deviceKey: 'k2', reportedAt: NOW - 60_000 }),
    ];
    expect(aggregateCrowdReports(rows, NOW).get(HASH)).toBeTruthy();
    const future = [
      report({ deviceKey: 'k1', reportedAt: NOW + 5 * 60_000 }),
      report({ deviceKey: 'k2', reportedAt: NOW - 60_000 }),
    ];
    expect(aggregateCrowdReports(future, NOW).size).toBe(0);
  });

  it('keeps the newest report per device and skips invalid rows', () => {
    const rows = [
      report({ deviceKey: 'k1', seeders: 1, reportedAt: NOW - 7_200_000 }),
      report({ deviceKey: 'k1', seeders: 5, reportedAt: NOW - 60_000 }),
      report({ deviceKey: 'k2', seeders: 7, reportedAt: NOW - 60_000 }),
      report({ deviceKey: '', seeders: 9 }),
      { infohash: 'bad', deviceKey: 'k3', seeders: 9, leechers: 0, reportedAt: NOW },
    ];
    const row = aggregateCrowdReports(rows, NOW).get(HASH);
    expect(row && row.seeders).toBe(6);
    expect(row && row.devices).toBe(2);
  });
});

describe('mergeCrowdCounts', () => {
  const fresh = { seeders: 6, leechers: 2, devices: 2, updatedAt: NOW - 3_600_000, source: 'crowd' };
  const base = { infohash: HASH, seeders: 0, leechers: 0, live: false, verified: false, samples: 0, estimate: false };

  it('applies a fresh two-device aggregate as an estimate, never live', () => {
    const out = mergeCrowdCounts(base, fresh, { now: () => NOW });
    expect(out).toMatchObject({
      seeders: 6,
      leechers: 2,
      source: 'crowd',
      estimate: true,
      fresh: true,
      ageMs: 3_600_000,
      measuredAt: fresh.updatedAt,
      live: false,
      verified: false,
    });
  });

  it('a fresh crowd aggregate wins over a bitmagnet estimate', () => {
    const bm = { ...base, seeders: 2, leechers: 1, source: 'bitmagnet', estimate: true, measuredAt: NOW - 60_000 };
    const out = mergeCrowdCounts(bm, fresh, { now: () => NOW });
    expect(out.source).toBe('crowd');
    expect(out.seeders).toBe(6);
  });

  it('stale crowd counts never apply and keep the bitmagnet answer', () => {
    const bm = { ...base, seeders: 2, leechers: 1, source: 'bitmagnet', estimate: true };
    const stale = { ...fresh, updatedAt: NOW - CROWD_FRESH_MS - 1 };
    const out = mergeCrowdCounts(bm, stale, { now: () => NOW });
    expect(out.source).toBe('bitmagnet');
    expect(out.seeders).toBe(2);
    expect(out.fresh).toBe(false);
  });

  it('a single-device aggregate never applies', () => {
    const out = mergeCrowdCounts(base, { ...fresh, devices: 1 }, { now: () => NOW });
    expect(out.source).toBeUndefined();
    expect(out.estimate).toBe(false);
  });

  it('a null count keeps the existing number, an absent row keeps the base', () => {
    const bm = { ...base, seeders: 2, leechers: 1, source: 'bitmagnet' };
    const out = mergeCrowdCounts(bm, { ...fresh, seeders: null }, { now: () => NOW });
    expect(out.seeders).toBe(2);
    expect(out.leechers).toBe(2);
    const none = mergeCrowdCounts(bm, null, { now: () => NOW });
    expect(none.source).toBe('bitmagnet');
    expect(none.fresh).toBe(false);
  });

  it('stale saved crowd counts demote live and keep their age advancing', () => {
    const saved = { ...base, seeders: 6, source: 'crowd', estimate: true, measuredAt: NOW - 7 * 3_600_000, live: true, verified: true };
    const out = mergeCrowdCounts(saved, null, { now: () => NOW });
    expect(out.live).toBe(false);
    expect(out.verified).toBe(false);
    expect(out.ageMs).toBe(7 * 3_600_000);
  });

  it('tolerates a small clock skew like bitmagnet', () => {
    const out = mergeCrowdCounts(base, { ...fresh, updatedAt: NOW + 30_000 }, { now: () => NOW });
    expect(out.source).toBe('crowd');
    expect(out.ageMs).toBe(0);
  });
});

describe('runSeedCheck with a crowd source', () => {
  const crowdRow = { seeders: 6, leechers: 2, devices: 2, updatedAt: NOW - 3_600_000, source: 'crowd' };

  function crowdSource(rows: Map<string, unknown>, calls: string[][] = []) {
    return {
      enabled: true,
      fetchCounts: async (hashes: string[]) => {
        calls.push(hashes.slice());
        return rows;
      },
    };
  }

  it('a tracker-verified row always wins and is never offered to crowd', async () => {
    const calls: string[][] = [];
    const out = await runSeedCheck({
      now: () => NOW,
      items: [{ infohash: HASH, trackers: ['http://tracker.example/announce'] }],
      cache: createMemorySeedCache(),
      transport: { http: async () => ({ seeders: 8, leechers: 2 }), udp: async () => null },
      crowd: crowdSource(new Map([[HASH, crowdRow]]), calls),
    });
    expect(out.items[0]).toMatchObject({ seeders: 8, live: true, verified: true });
    expect(out.items[0].source).toBeUndefined();
    expect(calls).toEqual([]);
    expect(out.stats.crowd).toBe(0);
  });

  it('a tracker-less hash gets the crowd estimate, response-only', async () => {
    const cache = createMemorySeedCache();
    const out = await runSeedCheck({
      now: () => NOW,
      items: [{ infohash: HASH, trackers: [] }],
      cache,
      crowd: crowdSource(new Map([[HASH, crowdRow]])),
    });
    expect(out.items[0]).toMatchObject({
      seeders: 6,
      leechers: 2,
      source: 'crowd',
      estimate: true,
      live: false,
      verified: false,
      ageMs: 3_600_000,
      samples: 0,
    });
    expect(out.stats.crowd).toBe(1);
    // the estimate never enters the cache: a second check asks the crowd again, nothing verified appears
    const stored = await cache.get([{ infohash: HASH, trackerKey: '' }]);
    expect(stored[0].live).toBe(false);
    expect(stored[0].seeders).toBe(0);
    const again = await runSeedCheck({
      now: () => NOW,
      items: [{ infohash: HASH, trackers: [] }],
      cache,
      crowd: crowdSource(new Map([[HASH, crowdRow]])),
    });
    expect(again.items[0]).toMatchObject({ source: 'crowd', cached: true, live: false });
  });

  it('fresh crowd beats bitmagnet, stale crowd keeps bitmagnet', async () => {
    const bm = {
      enabled: true,
      fetchCounts: async () => new Map([[HASH, { seeders: 2, leechers: 1, updatedAt: NOW - 60_000, source: 'bitmagnet' }]]),
    };
    const freshOut = await runSeedCheck({
      now: () => NOW,
      items: [{ infohash: HASH, trackers: [] }],
      bitmagnet: bm,
      crowd: crowdSource(new Map([[HASH, crowdRow]])),
    });
    expect(freshOut.items[0]).toMatchObject({ source: 'crowd', seeders: 6 });
    expect(freshOut.stats).toMatchObject({ bitmagnet: 1, crowd: 1 });
    const staleOut = await runSeedCheck({
      now: () => NOW,
      items: [{ infohash: HASH, trackers: [] }],
      bitmagnet: bm,
      crowd: crowdSource(new Map([[HASH, { ...crowdRow, updatedAt: NOW - CROWD_FRESH_MS - 1 }]])),
    });
    expect(staleOut.items[0]).toMatchObject({ source: 'bitmagnet', seeders: 2 });
    expect(staleOut.stats.crowd).toBe(0);
  });

  it('a single-device crowd row is not an estimate', async () => {
    const out = await runSeedCheck({
      now: () => NOW,
      items: [{ infohash: HASH, trackers: [] }],
      crowd: crowdSource(new Map([[HASH, { ...crowdRow, devices: 1 }]])),
    });
    expect(out.items[0].source).toBeUndefined();
    expect(out.items[0].estimate).toBe(false);
    expect(out.stats.crowd).toBe(0);
  });

  it('a slow crowd source cannot push the answer past the request budget', async () => {
    const started = Date.now();
    const out = await runSeedCheck({
      items: [{ infohash: HASH, trackers: [] }],
      cache: createMemorySeedCache(),
      budgetMs: 400,
      crowd: { enabled: true, fetchCounts: () => new Promise((resolve) => setTimeout(() => resolve(new Map([[HASH, crowdRow]])), 5000)) },
    });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(out.items[0].source).toBeUndefined();
    expect(out.items[0].live).toBe(false);
    expect(out.stats.crowd).toBe(0);
  });

  it('a crowd error keeps the previous answer', async () => {
    const out = await runSeedCheck({
      now: () => NOW,
      items: [{ infohash: HASH, trackers: [] }],
      crowd: { enabled: true, fetchCounts: async () => { throw new Error('down'); } },
    });
    expect(out.items[0].source).toBeUndefined();
    expect(out.items[0].live).toBe(false);
    expect(out.stats.crowd).toBe(0);
  });

  it('without a crowd source the answer and stats stay as before', async () => {
    const out = await runSeedCheck({
      now: () => NOW,
      items: [{ infohash: HASH, trackers: [] }],
      cache: createMemorySeedCache(),
    });
    expect(out.items[0].source).toBeUndefined();
    expect(out.stats).toMatchObject({ asked: 1, cache: 0, live: 0, dht: 0, bitmagnet: 0, crowd: 0 });
  });

  it('asks only the hashes left without a tracker measurement', async () => {
    const calls: string[][] = [];
    await runSeedCheck({
      now: () => NOW,
      items: [
        { infohash: HASH, trackers: ['http://tracker.example/announce'] },
        { infohash: HASH_B, trackers: [] },
      ],
      cache: createMemorySeedCache(),
      transport: { http: async () => ({ seeders: 8, leechers: 2 }), udp: async () => null },
      crowd: crowdSource(new Map([[HASH_B, crowdRow]]), calls),
    });
    expect(calls).toEqual([[HASH_B]]);
  });
});

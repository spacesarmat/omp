import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveBillingSession } from '../../src/billing/session';
import { applySeedRound, parseSeedResponse, pickProbeRows, watchSeedVerify, type SeedMeasure } from '../../src/sources/seedVerify';
import type { SourceContext, SourceResult } from '../../src/sources/types';

const HASH = 'ab'.repeat(20);
const OTHER = 'cd'.repeat(20);

function row(p: Partial<SourceResult> & { Title: string }): SourceResult {
  return {
    Categories: '',
    Size: '',
    CreateDate: '',
    Tracker: '',
    Link: '',
    Magnet: '',
    Hash: '',
    Peer: 0,
    Seed: 0,
    source: 'rutor',
    ...p,
  };
}

function ctx(): SourceContext {
  return {
    http: {
      get: () => Promise.reject(new Error('no')),
      post: () => Promise.reject(new Error('no')),
      clearCookies: () => Promise.resolve(),
    },
    client: null,
  };
}

afterEach(() => {
  saveBillingSession(null);
  vi.useRealTimers();
});

describe('seed check apply', () => {
  it('parses a batch and writes live counts, a DHT mark, and unverified on the rest', () => {
    const text = JSON.stringify({
      items: [
        { infohash: HASH, verified: true, live: true, seeders: 12, leechers: 3, seedersMax: 20, seedersMedian: 12, peers: 0, samples: 2, measuredAt: 50 },
        { infohash: OTHER, verified: false, live: false, seeders: 0, leechers: 0, peers: 9, dhtSeeds: 4, estimate: true, noTracker: true, samples: 0, measuredAt: 50 },
        { infohash: 'nope', verified: true, live: true, seeders: 1 },
      ],
    });
    const measures = parseSeedResponse(text) as SeedMeasure[];
    expect(measures).toHaveLength(2);
    const rows = applySeedRound(
      [
        row({ Title: 'A', hash: HASH, Seed: 1, Peer: 0 }),
        row({ Title: 'B', hash: OTHER, Seed: 9 }),
        row({ Title: 'C', Seed: 3 }),
      ],
      measures,
      true,
    );
    expect(rows[0]).toMatchObject({ Seed: 12, Peer: 3, seedCheck: 'live', seedCheckAt: 50, seedersMedian: 12 });
    expect(rows[1]).toMatchObject({ Seed: 9, seedCheck: 'dht', dhtSeeds: 4, dhtEstimate: true, noTracker: true });
    expect(rows[2].seedCheck).toBe('unverified');
    expect(applySeedRound(rows, measures, false)[0].Seed).toBe(12);
  });

  it('picks the top distinct infohashes and ignores a duplicate magnet', () => {
    const magnet = 'magnet:?xt=urn:btih:' + HASH + '&tr=' + encodeURIComponent('udp://tracker.example:6969/announce');
    const picked = pickProbeRows(
      [
        row({ Title: 'Low', hash: OTHER, Seed: 1 }),
        row({ Title: 'High', Magnet: magnet, Seed: 30 }),
        row({ Title: 'Same', hash: HASH, Seed: 2 }),
      ],
      'high',
      30,
    );
    expect(picked.map((r) => r.Title)).toEqual(['High', 'Low']);
  });

  it('asks once, after the delay while sources are still searching', async () => {
    saveBillingSession({ token: 'tok', paidUntil: 1, access: 'a', accessExp: Date.now() + 60_000 });
    vi.useFakeTimers();
    let asked = 0;
    const seen: SeedMeasure[] = [];
    const watch = watchSeedVerify({
      query: 'film',
      ctx: ctx(),
      getRows: () => [row({ Title: 'Film', hash: HASH, Seed: 2 })],
      getPending: () => 1,
      delayMs: 1200,
      request: () => {
        asked += 1;
        return Promise.resolve([
          { infohash: HASH, verified: true, live: true, seeders: 4, leechers: 1, seedersMax: 4, seedersMedian: 4, peers: 0, samples: 1, measuredAt: 9 },
        ]);
      },
      onApply: (list) => seen.push(list[0]),
    });
    watch.notify();
    watch.notify();
    expect(asked).toBe(0);
    await vi.advanceTimersByTimeAsync(1200);
    expect(asked).toBe(1);
    expect(seen[0].seeders).toBe(4);
    watch.notify();
    expect(asked).toBe(1);
    watch.cancel();
  });

  it('marks every row unverified when the check succeeds with no infohash', async () => {
    saveBillingSession({ token: 'tok', paidUntil: 1, access: 'a', accessExp: Date.now() + 6 * 60 * 60 * 1000 });
    let applied: SeedMeasure[] | null = null;
    const plain = row({ Title: 'No hash' });
    const watch = watchSeedVerify({
      query: 'film',
      ctx: ctx(),
      getRows: () => [plain],
      getPending: () => 0,
      request: () => Promise.resolve([]),
      onApply: (list) => {
        applied = list;
      },
    });
    watch.notify();
    await Promise.resolve();
    expect(applied).toEqual([]);
    expect(applySeedRound([plain], applied, true)[0].seedCheck).toBe('unverified');
    watch.cancel();
  });

  it('does nothing without a billing session', () => {
    let asked = 0;
    const watch = watchSeedVerify({
      query: 'film',
      ctx: ctx(),
      getRows: () => [row({ Title: 'Film', hash: HASH })],
      getPending: () => 0,
      request: () => {
        asked += 1;
        return Promise.resolve([]);
      },
      onApply: () => undefined,
    });
    watch.notify();
    expect(asked).toBe(0);
    watch.cancel();
  });

  it('finishes the round as unverified when the server does not answer', async () => {
    saveBillingSession({ token: 'tok', paidUntil: 1, access: 'a', accessExp: Date.now() + 60_000 });
    let applied: SeedMeasure[] | null = null;
    const plain = row({ Title: 'Film', hash: HASH, Seed: 4 });
    const watch = watchSeedVerify({
      query: 'film',
      ctx: ctx(),
      getRows: () => [plain],
      getPending: () => 0,
      request: () => Promise.resolve(null),
      onApply: (list) => {
        applied = list;
      },
    });
    watch.notify();
    await Promise.resolve();
    expect(applied).toEqual([]);
    expect(applySeedRound([plain], applied, true)[0].seedCheck).toBe('unverified');
    watch.cancel();
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  POPULAR_HITS,
  POPULAR_SEEDS,
  TTL_MISS_MS,
  TTL_POPULAR_MS,
  TTL_RARE_MS,
  createMemorySeedCache,
  mergeMeasurements,
  parseHttpScrape,
  publicTrackers,
  runSeedCheck,
  trackerKey,
} from '../src/seedProbe.mjs';
import { itemFromCache, refreshDue, startSeedRefresh } from '../src/seedRefresh.mjs';

const HASH = 'ab'.repeat(20);
const HASH_B = 'cd'.repeat(20);

function scrapeBody(seeders: number, leechers: number, downloaded?: number): string {
  let key = '';
  for (let i = 0; i < 40; i += 2) key += String.fromCharCode(parseInt(HASH.substr(i, 2), 16));
  const dl = downloaded === undefined ? '' : '10:downloadedi' + downloaded + 'e';
  return 'd5:filesd20:' + key + 'd8:completei' + seeders + 'e' + dl + '10:incompletei' + leechers + 'eeee';
}

describe('completed (snatched) count', () => {
  it('reads downloaded when the tracker sent it, and stays silent when it did not', () => {
    expect(parseHttpScrape(scrapeBody(12, 3, 14703), HASH)).toEqual({ seeders: 12, leechers: 3, completed: 14703 });
    expect(parseHttpScrape(scrapeBody(12, 3), HASH)).toEqual({ seeders: 12, leechers: 3 });
    expect(parseHttpScrape(scrapeBody(12, 3, 0), HASH)).toEqual({ seeders: 12, leechers: 3, completed: 0 });
    // a junk downloaded does not break the seeders/leechers answer
    expect(parseHttpScrape(scrapeBody(12, 3, -5), HASH)).toEqual({ seeders: 12, leechers: 3 });
  });

  it('merges completed by the same median/max rule as seeders, over the samples that reported it', () => {
    const two = mergeMeasurements(
      [
        { seeders: 10, leechers: 1, completed: 100 },
        { seeders: 4, leechers: 9, completed: 200 },
      ],
      0,
      100,
    );
    expect(two.completed).toBe(150);
    const one = mergeMeasurements([{ seeders: 3, leechers: 1, completed: 77 }], 0, 100);
    expect(one.completed).toBe(77);
    // a tracker without downloaded does not pull the count down
    const mixed = mergeMeasurements(
      [
        { seeders: 10, leechers: 1 },
        { seeders: 4, leechers: 9, completed: 90 },
      ],
      0,
      100,
    );
    expect(mixed.completed).toBe(90);
    expect(mergeMeasurements([{ seeders: 3, leechers: 1 }], 0, 100).completed).toBe(0);
    expect(mergeMeasurements([], 6, 100).completed).toBe(0);
  });

  it('carries completed through runSeedCheck and the cache, and stores public trackers without a passkey', async () => {
    const cache = createMemorySeedCache();
    // scrapeJobs measures its deadline against the real clock: the batch start must be a real timestamp
    const now = Date.now();
    const transport = {
      http: async () => ({ seeders: 20, leechers: 2, completed: 500 }),
      udp: async () => null,
    };
    const items = [{ infohash: HASH, trackers: ['http://tracker.example/announce?passkey=secret', 'http://127.0.0.1/announce'] }];
    const first = await runSeedCheck({ items, cache, now: () => now, transport, deadlineMs: 1000, timeoutMs: 500 });
    expect(first.items[0]).toMatchObject({ seeders: 20, completed: 500, live: true, cached: false });
    const rows = await cache.get([{ infohash: HASH, trackerKey: 'tracker.example' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].completed).toBe(500);
    expect(rows[0].trackers).toEqual(['http://tracker.example/announce']);
    const second = await runSeedCheck({ items, cache, now: () => now + 1000, transport, deadlineMs: 1000 });
    expect(second.items[0]).toMatchObject({ completed: 500, cached: true });
  });

  it('force re-scrapes a row that is still cache-fresh: the refresh asks at half the TTL', async () => {
    const cache = createMemorySeedCache();
    const now = Date.now();
    let calls = 0;
    const transport = {
      http: async () => {
        calls += 1;
        return { seeders: 20, leechers: 2, completed: 500 };
      },
      udp: async () => null,
    };
    const items = [{ infohash: HASH, trackers: ['http://tracker.example/announce'] }];
    await runSeedCheck({ items, cache, now: () => now, transport, deadlineMs: 1000, timeoutMs: 500 });
    expect(calls).toBe(1);
    // half the popular TTL later: the endpoint still answers from the cache
    const half = now + TTL_POPULAR_MS / 2 + 1000;
    const cached = await runSeedCheck({ items, cache, now: () => half, transport, deadlineMs: 1000 });
    expect(cached.items[0].cached).toBe(true);
    expect(calls).toBe(1);
    // the refresh forces the scrape and updates the row in place
    const forced = await runSeedCheck({ items, cache, now: () => half, transport, force: true, deadlineMs: 1000, timeoutMs: 500 });
    expect(forced.items[0]).toMatchObject({ cached: false, live: true, seeders: 20 });
    expect(calls).toBe(2);
    const rows = await cache.get([{ infohash: HASH, trackerKey: 'tracker.example' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].measuredAt).toBe(half);
  });

  it('a failed forced refresh keeps the working row; a real zero answer updates it', async () => {
    const cache = createMemorySeedCache();
    const now = Date.now();
    const key = [{ infohash: HASH, trackerKey: 'tracker.example' }];
    const items = [{ infohash: HASH, trackers: ['http://tracker.example/announce'] }];
    const good = { http: async () => ({ seeders: 20, leechers: 2, completed: 500 }), udp: async () => null };
    await runSeedCheck({ items, cache, now: () => now, transport: good, deadlineMs: 1000, timeoutMs: 500 });
    const before = (await cache.get(key))[0];
    expect(before).toMatchObject({ seeders: 20, live: true, hits: 1 });
    // every tracker fails on the forced refresh: the stored measurement must survive untouched
    const bad = { http: async () => null, udp: async () => null };
    const half = now + TTL_POPULAR_MS / 2 + 1000;
    const out = await runSeedCheck({ items, cache, now: () => half, transport: bad, force: true, deadlineMs: 1000, timeoutMs: 500 });
    expect(out.stats.live).toBe(0);
    const after = (await cache.get(key))[0];
    expect(after).toEqual(before);
    // a tracker that answered with zeros is a real measurement (a dead torrent): it saves
    const zero = { http: async () => ({ seeders: 0, leechers: 0 }), udp: async () => null };
    await runSeedCheck({ items, cache, now: () => half + 1000, transport: zero, force: true, deadlineMs: 1000, timeoutMs: 500 });
    const dead = (await cache.get(key))[0];
    expect(dead).toMatchObject({ seeders: 0, leechers: 0, live: true, samples: 1, measuredAt: half + 1000, hits: 2 });
    // without force a miss still records the empty row, as the endpoint always did
    const missCache = createMemorySeedCache();
    await runSeedCheck({ items, cache: missCache, now: () => now, transport: bad, deadlineMs: 1000, timeoutMs: 500 });
    const miss = (await missCache.get(key))[0];
    expect(miss).toMatchObject({ seeders: 0, live: false, samples: 0 });
  });
});

describe('publicTrackers', () => {
  it('keeps public announce addresses, drops the query, private hosts and userinfo, de-duplicates', () => {
    const item = {
      infohash: HASH,
      trackers: [
        'http://tracker.example/announce?passkey=secret',
        'http://tracker.example/announce',
        'udp://udp.example:6969/announce',
        'udp://udp.example:6969',
        'http://127.0.0.1/announce',
        'http://user:pw@tracker.example/announce',
        'https://secure.example/announce.php?x=1#frag',
      ],
    };
    expect(publicTrackers(item)).toEqual([
      'http://tracker.example/announce',
      'udp://udp.example:6969/announce',
      'https://secure.example/announce.php',
    ]);
    // the stored set rebuilds the same tracker key
    expect(trackerKey({ infohash: HASH, trackers: publicTrackers(item) })).toBe(trackerKey(item));
    expect(publicTrackers({ infohash: HASH, trackers: [] })).toEqual([]);
    expect(publicTrackers(null)).toEqual([]);
  });

  it('stores only standard announce paths: a passkey or token in the path drops the whole URL', () => {
    const item = {
      infohash: HASH,
      trackers: [
        'https://tracker.example/secret/announce',
        'http://tracker.example/announce',
        'http://tracker.example:8080/announce.php',
        'udp://udp.example:6969',
        'https://tracker.example/announce/0123456789abcdef0123456789abcdef',
        'https://tracker.example/announce/',
        'https://tracker.example/passkey/abc/scrape',
      ],
    };
    expect(publicTrackers(item)).toEqual([
      'http://tracker.example/announce',
      'http://tracker.example:8080/announce.php',
      'udp://udp.example:6969/announce',
    ]);
    // a query passkey on a standard path is stripped, the address stays
    expect(publicTrackers({ infohash: HASH, trackers: ['https://tracker.example/announce?passkey=abc'] })).toEqual([
      'https://tracker.example/announce',
    ]);
  });

  it('the foreground scrape keeps the full original URL; only storage is sanitized', async () => {
    const calls: string[] = [];
    const cache = createMemorySeedCache();
    const now = Date.now();
    const transport = {
      http: async (url: string) => {
        calls.push(url);
        return { seeders: 9, leechers: 1, completed: 40 };
      },
      udp: async () => null,
    };
    const items = [
      {
        infohash: HASH,
        trackers: ['https://private.example/secret/announce?passkey=abc', 'http://clean.example/announce'],
      },
    ];
    const out = await runSeedCheck({ items, cache, now: () => now, transport, deadlineMs: 1000, timeoutMs: 500 });
    expect(out.items[0]).toMatchObject({ live: true, seeders: 9 });
    // both trackers were scraped with their original addresses, passkey included
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('private.example/secret/scrape?passkey=abc');
    expect(calls[1]).toContain('clean.example/scrape');
    // the credential-bearing path is not stored; the clean address is
    const rows = await cache.get([{ infohash: HASH, trackerKey: trackerKey(items[0]) }]);
    expect(rows[0].trackers).toEqual(['http://clean.example/announce']);
    expect(JSON.stringify(rows[0])).not.toContain('secret');
    expect(JSON.stringify(rows[0])).not.toContain('passkey');
    // the refresh cannot rebuild this row in place (the key differs): it skips it, not overwrites
    expect(itemFromCache(rows[0])).toBe(null);
  });
});

describe('refresh selection', () => {
  const now = 10_000_000;
  it('takes a popular row past half its TTL, and leaves fresh, rare and miss rows alone', () => {
    const popular = { infohash: HASH, live: true, seeders: POPULAR_SEEDS, hits: 1, measuredAt: now };
    const asked = { infohash: HASH, live: true, seeders: 2, hits: POPULAR_HITS, measuredAt: now };
    const dhtPopular = { infohash: HASH, live: false, seeders: 0, dhtSeeds: POPULAR_SEEDS, hits: 1, measuredAt: now };
    const rare = { infohash: HASH, live: true, seeders: 2, hits: 1, measuredAt: now };
    const miss = { infohash: HASH, live: false, seeders: 0, hits: 1, measuredAt: now };
    const half = TTL_POPULAR_MS / 2;
    expect(refreshDue(popular, now + half - 1)).toBe(false);
    expect(refreshDue(popular, now + half)).toBe(true);
    expect(refreshDue(asked, now + half)).toBe(true);
    expect(refreshDue(dhtPopular, now + half)).toBe(true);
    // only popular rows are refreshed: a rare live row is left alone even past half its 4-hour TTL
    expect(refreshDue(rare, now + TTL_RARE_MS / 2)).toBe(false);
    expect(refreshDue(rare, now + TTL_RARE_MS)).toBe(false);
    expect(refreshDue(miss, now + TTL_MISS_MS)).toBe(false);
    expect(refreshDue(null, now)).toBe(false);
    expect(refreshDue({ seeders: 40, hits: 5 }, now)).toBe(false);
  });

  it('rebuilds the item from the cached trackers, and refuses a row it cannot update in place', () => {
    const trackers = ['http://one.example/announce', 'udp://two.example:6969/announce'];
    const row = { infohash: HASH, trackerKey: trackerKey({ infohash: HASH, trackers }), trackers, seeders: 20, hits: 4, measuredAt: now };
    expect(itemFromCache(row)).toEqual({ infohash: HASH, trackers });
    expect(itemFromCache({ ...row, trackers: [] })).toBe(null);
    expect(itemFromCache({ ...row, trackers: null })).toBe(null);
    expect(itemFromCache({ ...row, trackers: ['http://127.0.0.1/announce'] })).toBe(null);
    expect(itemFromCache({ ...row, trackerKey: 'other.example' })).toBe(null);
    expect(itemFromCache({ ...row, infohash: 'nope' })).toBe(null);
    expect(itemFromCache(null)).toBe(null);
  });
});

describe('startSeedRefresh', () => {
  const now = 10_000_000;
  const dueRow = {
    infohash: HASH,
    trackerKey: 'one.example',
    trackers: ['http://one.example/announce'],
    seeders: 20,
    hits: 4,
    live: true,
    measuredAt: now - TTL_POPULAR_MS,
  };

  it('refreshes one due row per tick through the wired check, and idles when nothing is due', async () => {
    const seen: { infohash: string; trackers: string[] }[] = [];
    const lines: string[] = [];
    const sched = startSeedRefresh({
      now: () => now,
      log: (s: string) => lines.push(s),
      list: async () => dueRow,
      check: async (item: { infohash: string; trackers: string[] }) => {
        seen.push(item);
        return { items: [], stats: { asked: 1, cache: 0, live: 1, dht: 0 } };
      },
    });
    const r = await sched.tick();
    expect(r).toEqual({ live: 1 });
    expect(seen).toEqual([{ infohash: HASH, trackers: ['http://one.example/announce'] }]);
    expect(lines).toEqual(['seed-refresh live=1']);
    // nothing due: the check is not called
    const idle = startSeedRefresh({ now: () => now, log: () => {}, list: async () => null, check: async () => ({ stats: { live: 1 } }) });
    expect(await idle.tick()).toBe(null);
    const fresh = startSeedRefresh({
      now: () => now,
      log: () => {},
      list: async () => ({ ...dueRow, measuredAt: now }),
      check: async () => ({ stats: { live: 1 } }),
    });
    expect(await fresh.tick()).toBe(null);
    // not wired (no transport/gate behind it): idle
    const bare = startSeedRefresh({ log: () => {} });
    expect(await bare.tick()).toBe(null);
    sched.stop();
    idle.stop();
    fresh.stop();
    bare.stop();
  });

  it('does not stack ticks, keeps the log free of addresses, and stops on stop()', async () => {
    vi.useFakeTimers();
    try {
      let release: (() => void) | null = null;
      let calls = 0;
      const lines: string[] = [];
      const sched = startSeedRefresh({
        now: () => now,
        everyMs: 60_000,
        firstDelayMs: 60_000,
        log: (s: string) => lines.push(s),
        list: async () => dueRow,
        check: () => {
          calls += 1;
          return new Promise((resolve) => {
            release = () => resolve({ stats: { live: 1 } });
          });
        },
      });
      const first = sched.tick();
      const second = sched.tick();
      // the tick body awaits list(): let the microtasks run before asserting
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(calls).toBe(1);
      if (release) (release as () => void)();
      // both callers share the one running tick
      expect(await second).toEqual({ live: 1 });
      expect(await first).toEqual({ live: 1 });
      expect(calls).toBe(1);
      // the interval fires the next tick once the first one is done
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls).toBe(2);
      sched.stop();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(calls).toBe(2);
      expect(lines.join('\n')).not.toContain('one.example');
      expect(lines.join('\n')).not.toContain(HASH);
    } finally {
      vi.useRealTimers();
    }
  });

  it('survives a failing list or check without logging the error text', async () => {
    const lines: string[] = [];
    const bad = startSeedRefresh({
      now: () => now,
      log: (s: string) => lines.push(s),
      list: async () => {
        throw new Error('http://one.example/announce failed');
      },
      check: async () => ({ stats: { live: 1 } }),
    });
    const r = await bad.tick();
    expect(r).toMatchObject({ error: expect.any(String) });
    expect(lines).toEqual(['seed-refresh error']);
    expect(lines.join('\n')).not.toContain('one.example');
    expect(bad.status().lastError).toBeTruthy();
    bad.stop();
  });
});

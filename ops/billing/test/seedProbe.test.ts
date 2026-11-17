import { describe, expect, it } from 'vitest';
import {
  TTL_MISS_MS,
  TTL_POPULAR_MS,
  TTL_RARE_MS,
  bdecode,
  cacheFresh,
  connectRequest,
  createMemorySeedCache,
  createTrackerGate,
  httpScrapeUrl,
  median,
  mergeMeasurements,
  parseHttpScrape,
  parseSeedRequest,
  parseTracker,
  readConnect,
  readScrape,
  runSeedCheck,
  scrapeRequest,
  ttlMs,
} from '../src/seedProbe.mjs';
import { resolvePublic } from '../src/seedProbeNet.mjs';

const HASH = 'ab'.repeat(20);
const HASH_B = 'cd'.repeat(20);

function scrapeBody(seeders: number, leechers: number, hash = HASH): string {
  let key = '';
  for (let i = 0; i < 40; i += 2) key += String.fromCharCode(parseInt(hash.substr(i, 2), 16));
  return 'd5:filesd20:' + key + 'd8:completei' + seeders + 'e10:incompletei' + leechers + 'eeee';
}

describe('bencode scrape', () => {
  it('reads complete and incomplete for the infohash', () => {
    expect(bdecode('i42e')).toBe(42);
    expect(bdecode('3:abc')).toBe('abc');
    expect(parseHttpScrape(scrapeBody(12, 3), HASH)).toEqual({ seeders: 12, leechers: 3 });
    expect(parseHttpScrape(scrapeBody(4, 1, HASH_B), HASH)).toEqual({ seeders: 4, leechers: 1 });
    expect(parseHttpScrape('d5:filesdee', HASH)).toBe(null);
    expect(parseHttpScrape(scrapeBody(-1, 1), HASH)).toBe(null);
    expect(bdecode('l'.repeat(40) + 'e'.repeat(40))).toBe(null);
    expect(parseHttpScrape('l'.repeat(40) + 'e'.repeat(40), HASH)).toBe(null);
  });

  it('builds an HTTP scrape URL and drops a private or credentialed tracker', () => {
    const url = httpScrapeUrl('http://tracker.example/announce?passkey=abc', HASH);
    expect(url).toContain('/scrape?passkey=abc&info_hash=');
    expect(parseTracker('udp://10.1.2.3:6969/announce', HASH)).toBe(null);
    expect(parseTracker('http://127.0.0.1/announce', HASH)).toBe(null);
    expect(parseTracker('http://user:pw@tracker.example/announce', HASH)).toBe(null);
    expect(parseTracker('udp://tracker.example:6969/announce', HASH)).toMatchObject({ kind: 'udp', host: 'tracker.example', port: 6969 });
  });
});

describe('udp scrape packets', () => {
  it('round-trips connect and scrape', () => {
    const connect = connectRequest(1);
    expect(connect.subarray(0, 8).toString('hex')).toBe('0000041727101980');
    expect(connect.readUInt32BE(8)).toBe(0);
    expect(connect.readUInt32BE(12)).toBe(1);
    const reply = Buffer.alloc(16);
    reply.writeUInt32BE(0, 0);
    reply.writeUInt32BE(1, 4);
    reply.writeBigUInt64BE(99n, 8);
    expect(readConnect(reply, 1)).toBe(99n);
    expect(readConnect(reply, 2)).toBe(null);
    const scrape = scrapeRequest(99n, 7, HASH);
    expect(scrape.subarray(16).toString('hex')).toBe(HASH);
    const ans = Buffer.alloc(20);
    ans.writeUInt32BE(2, 0);
    ans.writeUInt32BE(7, 4);
    ans.writeUInt32BE(12, 8);
    ans.writeUInt32BE(1, 12);
    ans.writeUInt32BE(3, 16);
    expect(readScrape(ans, 7)).toEqual({ seeders: 12, completed: 1, leechers: 3 });
    expect(readScrape(ans, 8)).toBe(null);
  });
});

describe('merge, ttl, and the tracker gate', () => {
  it('uses the median of two or more answers and the max of one', () => {
    expect(median([10, 4])).toBe(7);
    const many = mergeMeasurements(
      [
        { seeders: 10, leechers: 1 },
        { seeders: 4, leechers: 9 },
      ],
      2,
      100,
    );
    expect(many).toMatchObject({ seeders: 7, seedersMax: 10, seedersMedian: 7, leechers: 9, peers: 2, live: true, verified: true, samples: 2 });
    const one = mergeMeasurements([{ seeders: 3, leechers: 1 }], 0, 100);
    expect(one.seeders).toBe(3);
    const dhtOnly = mergeMeasurements([], 6, 100);
    expect(dhtOnly).toMatchObject({ seeders: 0, peers: 6, live: false, verified: false, estimate: false });
    const estimated = mergeMeasurements([], { peers: 6, seedsEstimate: 4, peerEstimate: 9, estimate: true }, 100);
    expect(estimated).toMatchObject({ peers: 6, dhtSeeds: 4, peerEstimate: 9, estimate: true, verified: false, live: false });
  });

  it('keeps popular rows for 20 minutes, rare rows for 4 hours, and a miss for 10 minutes', () => {
    const now = 1_000_000;
    const popular = { live: true, peers: 0, seeders: 40, hits: 1, measuredAt: now };
    const rare = { live: true, peers: 0, seeders: 2, hits: 1, measuredAt: now };
    const asked = { live: true, peers: 0, seeders: 2, hits: 3, measuredAt: now };
    const miss = { live: false, peers: 0, seeders: 0, hits: 1, measuredAt: now };
    expect(ttlMs(popular)).toBe(TTL_POPULAR_MS);
    expect(ttlMs(rare)).toBe(TTL_RARE_MS);
    expect(ttlMs(asked)).toBe(TTL_POPULAR_MS);
    expect(ttlMs(miss)).toBe(TTL_MISS_MS);
    expect(cacheFresh(rare, now + TTL_RARE_MS - 1)).toBe(true);
    expect(cacheFresh(rare, now + TTL_RARE_MS)).toBe(false);
    expect(cacheFresh(popular, now + TTL_POPULAR_MS)).toBe(false);
    expect(cacheFresh(miss, now + TTL_MISS_MS - 1)).toBe(true);
  });

  it('caps in-flight scrapes, the per-host gap, and the short window', () => {
    const gate = createTrackerGate({ maxInFlight: 2, perHostGapMs: 500, windowMs: 10_000, windowMax: 3 });
    expect(gate.take('a', 0)).toBe(true);
    expect(gate.take('a', 100)).toBe(false);
    expect(gate.take('b', 100)).toBe(true);
    expect(gate.take('c', 100)).toBe(false);
    gate.release();
    expect(gate.take('c', 100)).toBe(true);
    gate.release();
    gate.release();
    expect(gate.take('d', 1000)).toBe(false);
    expect(gate.take('d', 11_000)).toBe(true);
  });
});

describe('runSeedCheck', () => {
  it('merges trackers, serves a fresh cache hit, and does not scrape a private name', async () => {
    const calls: string[] = [];
    const transport = {
      http: async (url: string) => {
        calls.push(url);
        return url.indexOf('one.') >= 0 ? { seeders: 10, leechers: 1 } : { seeders: 4, leechers: 9 };
      },
      udp: async () => null,
    };
    const cache = createMemorySeedCache();
    const items = [
      {
        infohash: HASH,
        trackers: ['http://one.example/announce', 'http://two.example/announce', 'http://127.0.0.1/announce'],
      },
      { infohash: HASH, trackers: ['http://two.example/announce'] },
      { infohash: HASH_B, trackers: ['udp://10.0.0.8:6969/announce'] },
    ];
    const parsed = parseSeedRequest({ items: JSON.stringify(items) });
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0].trackers).toHaveLength(3);
    const now = Date.now();
    const first = await runSeedCheck({
      items: parsed.items,
      cache,
      now: () => now,
      transport,
      dht: async () => 5,
      deadlineMs: 1000,
      timeoutMs: 500,
    });
    expect(calls).toHaveLength(2);
    expect(first.items[0]).toMatchObject({ infohash: HASH, verified: true, live: true, seeders: 7, peers: 0, estimate: false, cached: false });
    expect(first.items[1]).toMatchObject({ infohash: HASH_B, verified: false, live: false, peers: 5, estimate: false, noTracker: true, cached: false });
    expect(first.stats).toMatchObject({ asked: 2, cache: 0, live: 1, dht: 1 });
    calls.length = 0;
    const second = await runSeedCheck({
      items: parsed.items,
      cache,
      now: () => now + 1000,
      transport,
      deadlineMs: 1000,
    });
    expect(calls).toHaveLength(0);
    expect(second.items[0].cached).toBe(true);
    expect(second.items[0].seeders).toBe(7);
    expect(second.stats.cache).toBe(2);
    const other = await runSeedCheck({
      items: [{ infohash: HASH, trackers: ['http://evil.example/announce'] }],
      cache,
      now: () => now + 2000,
      transport,
      deadlineMs: 1000,
      timeoutMs: 500,
    });
    expect(calls).toHaveLength(1);
    expect(other.items[0].cached).toBe(false);
    expect(String(calls[0])).toContain('evil.example');
  });

  it('stops when the deadline passes and leaves the hash unchecked', async () => {
    const transport = {
      http: () => new Promise(() => undefined),
      udp: async () => null,
    };
    const out = await runSeedCheck({
      items: [{ infohash: HASH, trackers: ['http://slow.example/announce'] }],
      cache: createMemorySeedCache(),
      now: () => Date.now(),
      transport,
      deadlineMs: 250,
      timeoutMs: 5000,
    });
    expect(out.items[0]).toMatchObject({ verified: false, live: false, cached: false });
  });

  it('estimates seeds from DHT for a hash with no tracker and does not treat peer addresses as seeds', async () => {
    const seen: string[] = [];
    const out = await runSeedCheck({
      items: [
        { infohash: HASH, trackers: ['http://one.example/announce'] },
        { infohash: HASH_B, trackers: [] },
      ],
      cache: createMemorySeedCache(),
      now: () => Date.now(),
      transport: { http: async () => ({ seeders: 3, leechers: 1 }), udp: async () => null },
      dht: async (hash: string) => {
        seen.push(hash);
        return { peers: 40, seedsEstimate: 12, peerEstimate: 30, estimate: true };
      },
      deadlineMs: 1000,
      timeoutMs: 500,
    });
    expect(seen).toEqual([HASH_B]);
    expect(out.items[0]).toMatchObject({ verified: true, live: true, seeders: 3, estimate: false });
    expect(out.items[1]).toMatchObject({
      verified: false,
      live: false,
      estimate: true,
      dhtSeeds: 12,
      peerEstimate: 30,
      peers: 40,
      noTracker: true,
    });
    const again = await runSeedCheck({
      items: [{ infohash: HASH_B, trackers: [] }],
      cache: createMemorySeedCache(),
      now: () => Date.now(),
      transport: { http: async () => null, udp: async () => null },
      dht: async () => 9,
      deadlineMs: 500,
      timeoutMs: 200,
    });
    expect(again.items[0]).toMatchObject({ verified: false, estimate: false, peers: 9, dhtSeeds: 0 });
  });
});

describe('resolvePublic', () => {
  it('refuses a name that resolves to a private address and keeps a public one', async () => {
    const lookup = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ];
    expect(await resolvePublic('tracker.example', lookup)).toBe(null);
    expect(await resolvePublic('1.2.3.4', async () => [])).toEqual({ address: '1.2.3.4', family: 4 });
    expect(await resolvePublic('127.0.0.1', async () => [])).toBe(null);
    const onlyPublic = async () => [{ address: '93.184.216.34', family: 4 }];
    expect(await resolvePublic('tracker.example', onlyPublic)).toEqual({ address: '93.184.216.34', family: 4 });
  });
});

describe('runSeedCheck DHT budget and coverage (phase 2)', () => {
  const HASH_C = 'ef'.repeat(20);
  const noTrackers = (hash: string) => ({ infohash: hash, trackers: [] as string[] });
  const idleTransport = { http: async () => null, udp: async () => null };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('asks DHT for every tracker-less hash in the batch and merges each one', async () => {
    const seen: string[] = [];
    const out = await runSeedCheck({
      items: [noTrackers(HASH), noTrackers(HASH_B), noTrackers(HASH_C)],
      cache: createMemorySeedCache(),
      now: () => Date.now(),
      transport: idleTransport,
      dht: async (hash: string) => {
        seen.push(hash);
        return { peers: hash === HASH ? 10 : hash === HASH_B ? 20 : 30, seedsEstimate: 0, peerEstimate: 0, estimate: false };
      },
      deadlineMs: 300,
      dhtWaitMs: 2000,
    });
    expect(seen.slice().sort()).toEqual([HASH, HASH_B, HASH_C].sort());
    expect(out.items[0]).toMatchObject({ infohash: HASH, peers: 10, noTracker: true });
    expect(out.items[1]).toMatchObject({ infohash: HASH_B, peers: 20, noTracker: true });
    expect(out.items[2]).toMatchObject({ infohash: HASH_C, peers: 30, noTracker: true });
    expect(out.stats.dht).toBe(3);
  });

  it('caps the concurrent DHT lookups and still covers the whole batch', async () => {
    const seen: string[] = [];
    let active = 0;
    let maxActive = 0;
    const hashes = [HASH, HASH_B, HASH_C, '11'.repeat(20), '22'.repeat(20), '33'.repeat(20)];
    const out = await runSeedCheck({
      items: hashes.map(noTrackers),
      cache: createMemorySeedCache(),
      now: () => Date.now(),
      transport: idleTransport,
      dhtConcurrency: 2,
      dht: async (hash: string) => {
        active++;
        maxActive = Math.max(maxActive, active);
        seen.push(hash);
        await wait(20);
        active--;
        return 5;
      },
      deadlineMs: 300,
      dhtWaitMs: 3000,
    });
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(seen).toHaveLength(hashes.length);
    expect(out.stats.dht).toBe(hashes.length);
    expect(out.items.every((it: any) => it.peers === 5)).toBe(true);
  });

  it('discards a DHT answer that outlives the shared budget', async () => {
    const slow = await runSeedCheck({
      items: [noTrackers(HASH)],
      cache: createMemorySeedCache(),
      now: () => Date.now(),
      transport: idleTransport,
      dht: async () => {
        await wait(300);
        return 42;
      },
      deadlineMs: 300,
      dhtWaitMs: 80,
    });
    expect(slow.items[0]).toMatchObject({ peers: 0, dhtSeeds: 0 });
    expect(slow.stats.dht).toBe(0);

    const fast = await runSeedCheck({
      items: [noTrackers(HASH)],
      cache: createMemorySeedCache(),
      now: () => Date.now(),
      transport: idleTransport,
      dht: async () => {
        await wait(10);
        return 42;
      },
      deadlineMs: 300,
      dhtWaitMs: 1000,
    });
    expect(fast.items[0]).toMatchObject({ peers: 42 });
    expect(fast.stats.dht).toBe(1);
  });

  it('keeps an answer slower than the old 1500 ms race under the raised default budget', async () => {
    const out = await runSeedCheck({
      items: [noTrackers(HASH)],
      cache: createMemorySeedCache(),
      now: () => Date.now(),
      transport: idleTransport,
      dht: async () => {
        await wait(1600); // longer than the phase-1 1500 ms race, inside the phase-2 6000 ms budget
        return { peers: 7, seedsEstimate: 3, peerEstimate: 9, estimate: true };
      },
      deadlineMs: 2500,
    });
    expect(out.items[0]).toMatchObject({ peers: 7, dhtSeeds: 3, peerEstimate: 9, estimate: true });
    expect(out.stats.dht).toBe(1);
  }, 10000);

  it('asks the first stale hash when every hash carries trackers (phase-1 fallback)', async () => {
    const seen: string[] = [];
    const out = await runSeedCheck({
      items: [
        { infohash: HASH, trackers: ['http://one.example/announce'] },
        { infohash: HASH_B, trackers: ['http://two.example/announce'] },
      ],
      cache: createMemorySeedCache(),
      now: () => Date.now(),
      transport: { http: async () => ({ seeders: 3, leechers: 1 }), udp: async () => null },
      dht: async (hash: string) => {
        seen.push(hash);
        return 6;
      },
      deadlineMs: 500,
      timeoutMs: 300,
      dhtWaitMs: 1000,
    });
    expect(seen).toEqual([HASH]);
    expect(out.items[0]).toMatchObject({ infohash: HASH, live: true, seeders: 3, peers: 6 });
    expect(out.items[1]).toMatchObject({ infohash: HASH_B, live: true, peers: 0 });
    expect(out.stats.dht).toBe(1);
  });
});

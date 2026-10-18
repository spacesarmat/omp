import { describe, expect, it } from 'vitest';
import {
  LiveSeedCache,
  bdecode,
  createScrapeQueue,
  encodeInfohash,
  httpScrapeUrl,
  infohashBytes,
  mergeScrape,
  parseHttpScrape,
  phoneSeedBits,
  seedDisplay,
  trackerTargets,
  tvSeedLabel,
  type ScrapeCounts,
  type ScrapeHandle,
  type ScrapeTransport,
} from '../../src/sources/liveSeeds';

const HASH = '08ada5a7a6183aae1e09d831df6748d566095a10';

function hexBytes(hex: string): string {
  let s = '';
  for (let i = 0; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  return s;
}

function bstr(s: string): string {
  return s.length + ':' + s;
}

function scrapeBody(seeders: number, leechers: number, hash = HASH): string {
  const file = 'd8:completei' + seeders + 'e10:incompletei' + leechers + 'e10:downloadedi4ee';
  return 'd5:filesd' + bstr(hexBytes(hash)) + file + 'ee';
}

describe('bencode scrape', () => {
  it('decodes ints, strings, lists and dicts, including a binary key', () => {
    expect(bdecode('i42e')).toBe(42);
    expect(bdecode('i-7e')).toBe(-7);
    expect(bdecode('i0e')).toBe(0);
    expect(bdecode('3:yes')).toBe('yes');
    expect(bdecode('le')).toEqual([]);
    expect(bdecode('li1ei2ee')).toEqual([1, 2]);
    expect(bdecode('d3:foo3:bare')).toEqual({ foo: 'bar' });
    expect(bdecode('i03e')).toBeNull();
    expect(bdecode('i-0e')).toBeNull();
    expect(bdecode('d5:files')).toBeNull();
    const key = hexBytes(HASH);
    const dict = bdecode('d' + bstr(key) + 'i9ee');
    expect(dict).toEqual({ [key]: 9 });
  });

  it('reads complete and incomplete for the infohash', () => {
    expect(parseHttpScrape(scrapeBody(12, 3), HASH)).toEqual({ seeders: 12, leechers: 3 });
    expect(parseHttpScrape('d14:failure reason11:unavailablee', HASH)).toBeNull();
    expect(parseHttpScrape('d5:filesdee', HASH)).toBeNull();
    // opentrackr puts downloaded before incomplete
    const swapped =
      'd5:filesd' + bstr(hexBytes(HASH)) + 'd8:completei188e10:downloadedi14703e10:incompletei76eeee';
    expect(parseHttpScrape(swapped, HASH)).toEqual({ seeders: 188, leechers: 76 });
    // one file entry: taken even if the key is not our hash
    const other = 'd5:filesd20:' + 'xxxxxxxxxxxxxxxxxxxx' + 'd8:completei4e10:incompletei1eeee';
    expect(parseHttpScrape(other, HASH)).toEqual({ seeders: 4, leechers: 1 });
  });

  it('builds an HTTP scrape URL and keeps the passkey', () => {
    const url = httpScrapeUrl('http://retracker.local/announce?passkey=abc', HASH);
    expect(url).toBe('http://retracker.local/scrape?passkey=abc&info_hash=' + encodeInfohash(HASH));
    expect(encodeInfohash(HASH)!.slice(0, 6)).toBe('%08%AD');
    expect(infohashBytes(HASH)!.charCodeAt(0)).toBe(0x08);
    expect(httpScrapeUrl('udp://opentor.net:6969/announce', HASH)).toBeNull();
    expect(httpScrapeUrl('https://t.example/announce.php', HASH)).toMatch(/^https:\/\/t\.example\/scrape\.php\?info_hash=/);
  });

  it('lists http and udp trackers from a magnet, capped and de-duplicated', () => {
    const magnet =
      'magnet:?xt=urn:btih:' + HASH +
      '&tr=' + encodeURIComponent('udp://opentor.net:6969/announce') +
      '&tr=' + encodeURIComponent('http://retracker.local/announce') +
      '&tr=' + encodeURIComponent('udp://opentor.net:6969') +
      '&tr=' + encodeURIComponent('http://user:secret@tracker.example/announce');
    const list = trackerTargets(magnet, HASH, 6);
    expect(list.map((t) => t.kind + ' ' + t.host + ':' + t.port)).toEqual([
      'udp opentor.net:6969',
      'http retracker.local:80',
    ]);
  });
});

describe('merge', () => {
  it('keeps the max seeders and the leechers from that tracker', () => {
    const answers: ScrapeCounts[] = [
      { seeders: 5, leechers: 1 },
      { seeders: 9, leechers: 2 },
      { seeders: 9, leechers: 4 },
    ];
    expect(mergeScrape(100, 50, answers)).toEqual({ seeders: 9, leechers: 4, live: true });
  });

  it('keeps the search numbers when nobody answered', () => {
    expect(mergeScrape(11, 2, [])).toEqual({ seeders: 11, leechers: 2, live: false });
    expect(seedDisplay({ Seed: 11, Peer: 2 }, true, { seeders: 0, leechers: 0, live: false, at: 1 }).mode).toBe('approx');
    expect(seedDisplay({ Seed: 11, Peer: 2 }, true, { seeders: 9, leechers: 4, live: true, at: 1 })).toEqual({
      mode: 'live',
      seeders: 9,
      leechers: 4,
    });
    expect(seedDisplay({ Seed: 11, Peer: 2 }, false, { seeders: 9, leechers: 4, live: true, at: 1 }).mode).toBe('off');
  });

  it('marks the labels', () => {
    expect(phoneSeedBits({ mode: 'search', seeders: 5, leechers: 0 }).text).toBe('5 сидов');
    expect(phoneSeedBits({ mode: 'approx', seeders: 5, leechers: 0 }).text).toBe('~5 сидов');
    expect(phoneSeedBits({ mode: 'live', seeders: 5, leechers: 1 }).text).toBe('5 сидов · 1 лич');
    expect(phoneSeedBits({ mode: 'search', seeders: 0, leechers: 0 }).text).toBe('');
    expect(tvSeedLabel({ mode: 'search', seeders: 50, leechers: 0 })).toBe('↑50');
    expect(tvSeedLabel({ mode: 'approx', seeders: 7, leechers: 0 })).toBe('~↑7');
    expect(tvSeedLabel({ mode: 'live', seeders: 7, leechers: 2 })).toBe('↑7 ↓2');
  });
});

describe('cache', () => {
  function memory() {
    const box: { [k: string]: string } = {};
    let now = 1_000_000;
    const cache = new LiveSeedCache(
      { get: (k) => (k in box ? box[k] : null), set: (k, v) => { box[k] = v; } },
      () => now,
      10 * 60 * 1000,
    );
    return { cache, box, setNow: (n: number) => { now = n; } };
  }

  it('remembers a scrape for ten minutes and drops it after', () => {
    const { cache, setNow } = memory();
    cache.put(HASH, { seeders: 4, leechers: 1, live: true, at: 1_000_000 });
    expect(cache.get(HASH)!.seeders).toBe(4);
    setNow(1_000_000 + 10 * 60 * 1000);
    expect(cache.get(HASH)).toBeNull();
  });

  it('persists successes only, and a new cache reads them back', () => {
    const { cache, box, setNow } = memory();
    cache.put(HASH, { seeders: 4, leechers: 1, live: true, at: 1_000_000 });
    cache.put('b'.repeat(40), { seeders: 0, leechers: 0, live: false, at: 1_000_000 });
    const saved = JSON.parse(box['tsp.liveSeeds']);
    expect(saved.items).toEqual([{ h: HASH, s: 4, l: 1, t: 1_000_000 }]);
    const again = new LiveSeedCache(
      { get: (k) => box[k] || null, set: (k, v) => { box[k] = v; } },
      () => 1_000_000 + 1000,
      10 * 60 * 1000,
    );
    expect(again.get(HASH)).toEqual({ seeders: 4, leechers: 1, live: true, at: 1_000_000 });
    setNow(1_000_000);
    expect(again.get('b'.repeat(40))).toBeNull();
  });
});

describe('queue', () => {
  interface Pending {
    kind: string;
    key: string;
    resolve: (v: string | ScrapeCounts | null) => void;
  }

  function fake() {
    const pending: Pending[] = [];
    const cancelled: string[] = [];
    let now = 0;
    const timers: { fn: () => void; at: number }[] = [];
    const transport: ScrapeTransport = {
      http(url): ScrapeHandle<string | null> {
        let resolve!: (v: string | null) => void;
        const promise = new Promise<string | null>((r) => { resolve = r; });
        const item: Pending = { kind: 'http', key: url, resolve: resolve as Pending['resolve'] };
        pending.push(item);
        return { promise, cancel: () => { cancelled.push(url); resolve(null); } };
      },
      udp(host, port): ScrapeHandle<ScrapeCounts | null> {
        let resolve!: (v: ScrapeCounts | null) => void;
        const promise = new Promise<ScrapeCounts | null>((r) => { resolve = r; });
        const key = host + ':' + port;
        const item: Pending = { kind: 'udp', key, resolve: resolve as Pending['resolve'] };
        pending.push(item);
        return { promise, cancel: () => { cancelled.push(key); resolve(null); } };
      },
    };
    const box: { [k: string]: string } = {};
    const cache = new LiveSeedCache({ get: (k) => box[k] || null, set: (k, v) => { box[k] = v; } }, () => now, 10 * 60 * 1000);
    const queue = createScrapeQueue({
      transport,
      cache,
      now: () => now,
      concurrency: 2,
      maxStarts: 2,
      windowMs: 10_000,
      maxTrackers: 4,
      schedule: (fn) => {
        timers.push({ fn, at: now });
        return timers.length;
      },
    });
    return { pending, cancelled, cache, queue, timers, setNow: (n: number) => { now = n; } };
  }

  const hash = (n: number) => (n.toString(16) + 'a'.repeat(40)).slice(0, 40);

  function httpTracker(h: string, host: string) {
    return trackerTargets('magnet:?xt=urn:btih:' + h + '&tr=' + encodeURIComponent('http://' + host + '/announce'), h, 4);
  }

  it('merges the max across trackers and does not start a third while the cap holds', async () => {
    const f = fake();
    const h = hash(1);
    const targets = trackerTargets(
      'magnet:?xt=urn:btih:' + h +
        '&tr=' + encodeURIComponent('http://a.example/announce') +
        '&tr=' + encodeURIComponent('http://b.example/announce'),
      h,
      4,
    );
    f.queue.watch({ hash: h, trackers: targets, seed: 1, peer: 0 });
    f.queue.watch({ hash: hash(2), trackers: httpTracker(hash(2), 'c.example'), seed: 3, peer: 0 });
    await Promise.resolve();
    expect(f.pending.map((p) => p.key)).toEqual([
      targets[0].url,
      targets[1].url,
    ]);
    f.pending[0].resolve(scrapeBody(2, 1, h));
    f.pending[1].resolve(scrapeBody(8, 5, h));
    await Promise.resolve();
    await Promise.resolve();
    expect(f.cache.get(h)).toMatchObject({ seeders: 8, leechers: 5, live: true });
    expect(f.pending.length).toBe(2);
  });

  it('cancels a row that left the screen and does not keep a failed scrape', async () => {
    const f = fake();
    const h = hash(3);
    const stop = f.queue.watch({ hash: h, trackers: httpTracker(h, 'a.example'), seed: 6, peer: 1 });
    await Promise.resolve();
    expect(f.pending).toHaveLength(1);
    stop();
    expect(f.cancelled).toHaveLength(1);
    f.pending[0].resolve(scrapeBody(9, 9, h));
    await Promise.resolve();
    await Promise.resolve();
    expect(f.cache.get(h)).toBeNull();
  });

  it('waits out the window before starting more', async () => {
    const f = fake();
    const h1 = hash(4);
    const h2 = hash(5);
    f.queue.watch({ hash: h1, trackers: httpTracker(h1, 'a.example'), seed: 1, peer: 0 });
    f.queue.watch({ hash: h2, trackers: httpTracker(h2, 'b.example'), seed: 1, peer: 0 });
    const extra = hash(6);
    f.queue.watch({ hash: extra, trackers: httpTracker(extra, 'c.example'), seed: 1, peer: 0 });
    await Promise.resolve();
    expect(f.pending).toHaveLength(2);
    // a free slot is not enough: the window still has its two starts
    f.pending[0].resolve(null);
    await Promise.resolve();
    await Promise.resolve();
    expect(f.pending).toHaveLength(2);
    expect(f.timers.length).toBeGreaterThan(0);
    f.setNow(10_000);
    f.timers[0].fn();
    await Promise.resolve();
    expect(f.pending).toHaveLength(3);
  });
});

import { describe, expect, it } from 'vitest';
import {
  BITMAGNET_BATCH_MAX,
  BITMAGNET_MAX_AGE_MS,
  bitmagnetGraphqlUrl,
  createBitmagnetSource,
  isFreshRow,
  mergeBitmagnetCounts,
} from '../src/bitmagnetSource.mjs';

const HASH = 'c18c3b09ad9b1a6270e6e4d07523f6aeeb795dd6';
const HASH_B = 'b55a1b2f6fa4ec1bc1b0430116c5ca284908de7d';
const BASE = 'http://192.168.1.211:3333';
const NOW = 1794900000000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function jsonRes(body: unknown, status = 200) {
  return { status, json: async () => body };
}

function itemsBody(items: unknown[]) {
  return { data: { torrentContent: { search: { items } } } };
}

/** Fake fetch that records every call and answers from a responder. */
function fakeFetch(responder: (call: { url: string; init: any; body: any }, index: number) => any) {
  const calls: { url: string; init: any; body: any }[] = [];
  const impl = async (url: string, init: any) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return responder(calls[calls.length - 1], calls.length - 1);
  };
  (impl as any).calls = calls;
  return impl as any;
}

function hashesOfQuery(query: string): string[] {
  const m = /infoHashes:\[([^\]]*)\]/.exec(query);
  if (!m) return [];
  return m[1].split(',').map((s) => s.replace(/"/g, ''));
}

function item(hash: string, over: Record<string, unknown> = {}) {
  return { infoHash: hash, seeders: 9, leechers: 2, updatedAt: iso(NOW - 1000), torrent: null, ...over };
}

describe('bitmagnetGraphqlUrl', () => {
  it('normalizes an origin to the graphql endpoint', () => {
    expect(bitmagnetGraphqlUrl(BASE)).toBe(BASE + '/graphql');
    expect(bitmagnetGraphqlUrl(BASE + '/torznab')).toBe(BASE + '/graphql');
    expect(bitmagnetGraphqlUrl('  ' + BASE + '  ')).toBe(BASE + '/graphql');
  });
  it('refuses empty, non-http and credentialed bases', () => {
    expect(bitmagnetGraphqlUrl('')).toBe('');
    expect(bitmagnetGraphqlUrl('ftp://host')).toBe('');
    expect(bitmagnetGraphqlUrl('http://user:pass@host')).toBe('');
    expect(bitmagnetGraphqlUrl('http://host?q=1')).toBe('');
    expect(bitmagnetGraphqlUrl('not a url')).toBe('');
  });
});

describe('createBitmagnetSource fetchCounts', () => {
  it('posts the verified graphql batch shape to origin/graphql', async () => {
    const fetchImpl = fakeFetch(() => jsonRes(itemsBody([item(HASH, { torrent: { seeders: 34, leechers: 1, updatedAt: iso(NOW - 2000) } })])));
    const src = createBitmagnetSource({ baseUrl: BASE, fetchImpl, now: () => NOW });
    const map = await src.fetchCounts([HASH]);
    expect(fetchImpl.calls.length).toBe(1);
    const call = fetchImpl.calls[0];
    expect(call.url).toBe(BASE + '/graphql');
    expect(call.init.method).toBe('POST');
    expect(call.init.headers['content-type']).toBe('application/json');
    expect(call.init.signal).toBeTruthy();
    expect(call.body.query).toContain('torrentContent{search(input:{infoHashes:');
    expect(call.body.query).toContain('limit:' + BITMAGNET_BATCH_MAX);
    expect(call.body.query).toContain('torrent{seeders leechers updatedAt}');
    expect(hashesOfQuery(call.body.query)).toEqual([HASH]);
    expect(map.get(HASH)).toEqual({ seeders: 34, leechers: 1, updatedAt: NOW - 2000, source: 'bitmagnet' });
    expect(src.lastStatus.ok).toBe(true);
    expect(src.lastStatus.rows).toBe(1);
  });

  it('prefers torrent aggregate counts and falls back to contents counts', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonRes(itemsBody([
        item(HASH, { seeders: 99, leechers: 99, torrent: { seeders: 34, leechers: 1, updatedAt: iso(NOW - 5000) } }),
        item(HASH_B, { seeders: 7, leechers: 3, torrent: { seeders: null, leechers: null, updatedAt: null } }),
      ])),
    );
    const src = createBitmagnetSource({ baseUrl: BASE, fetchImpl, now: () => NOW });
    const map = await src.fetchCounts([HASH, HASH_B]);
    expect(map.get(HASH).seeders).toBe(34);
    expect(map.get(HASH).leechers).toBe(1);
    expect(map.get(HASH).updatedAt).toBe(NOW - 5000);
    expect(map.get(HASH_B)).toEqual({ seeders: 7, leechers: 3, updatedAt: NOW - 1000, source: 'bitmagnet' });
  });

  it('treats null counts as unknown: both null omits the row, one null stays null', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonRes(itemsBody([
        item(HASH, { seeders: null, leechers: null, torrent: null }),
        item(HASH_B, { seeders: null, leechers: 4, torrent: null }),
      ])),
    );
    const src = createBitmagnetSource({ baseUrl: BASE, fetchImpl, now: () => NOW });
    const map = await src.fetchCounts([HASH, HASH_B]);
    expect(map.has(HASH)).toBe(false);
    expect(map.get(HASH_B)).toEqual({ seeders: null, leechers: 4, updatedAt: NOW - 1000, source: 'bitmagnet' });
  });

  it('drops invalid counts and bad updatedAt instead of guessing', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonRes(itemsBody([
        item(HASH, { seeders: -3, leechers: 1.5, updatedAt: 'not a date', torrent: null }),
        item(HASH_B, { seeders: 0, leechers: 0, updatedAt: 'not a date', torrent: null }),
      ])),
    );
    const src = createBitmagnetSource({ baseUrl: BASE, fetchImpl, now: () => NOW });
    const map = await src.fetchCounts([HASH, HASH_B]);
    // Both counts invalid -> unknown -> the row is omitted, never shown as zero.
    expect(map.has(HASH)).toBe(false);
    expect(map.get(HASH_B)).toEqual({ seeders: 0, leechers: 0, updatedAt: null, source: 'bitmagnet' });
  });

  it('splits more than 30 hashes into capped batches and merges the answers', async () => {
    const many = Array.from({ length: 35 }, (_, i) => (i + 1).toString(16).padStart(40, '0'));
    const fetchImpl = fakeFetch((call) => {
      const asked = hashesOfQuery(call.body.query);
      return jsonRes(itemsBody(asked.map((h) => item(h, { torrent: { seeders: asked.length, leechers: 0, updatedAt: iso(NOW) } }))));
    });
    const src = createBitmagnetSource({ baseUrl: BASE, fetchImpl, now: () => NOW });
    const map = await src.fetchCounts(many);
    expect(fetchImpl.calls.length).toBe(2);
    expect(hashesOfQuery(fetchImpl.calls[0].body.query).length).toBe(BITMAGNET_BATCH_MAX);
    expect(hashesOfQuery(fetchImpl.calls[1].body.query).length).toBe(5);
    expect(map.size).toBe(35);
    expect(map.get(many[0]).seeders).toBe(30);
    expect(map.get(many[34]).seeders).toBe(5);
  });

  it('validates hex40, lowercases and dedupes before asking', async () => {
    const fetchImpl = fakeFetch(() => jsonRes(itemsBody([])));
    const src = createBitmagnetSource({ baseUrl: BASE, fetchImpl, now: () => NOW });
    await src.fetchCounts([HASH.toUpperCase(), HASH, 'zz'.repeat(20), 'ab'.repeat(19), '', null as any]);
    expect(hashesOfQuery(fetchImpl.calls[0].body.query)).toEqual([HASH]);
  });

  it('never throws on http error, network error, graphql errors or a bad shape', async () => {
    const cases = [
      fakeFetch(() => jsonRes({ error: 'down' }, 500)),
      fakeFetch(() => Promise.reject(new Error('ECONNRESET'))),
      fakeFetch(() => jsonRes({ errors: [{ message: 'boom' }] })),
      fakeFetch(() => jsonRes({ data: {} })),
      fakeFetch(() => ({ status: 200, json: async () => Promise.reject(new Error('bad json')) })),
    ];
    for (const fetchImpl of cases) {
      const src = createBitmagnetSource({ baseUrl: BASE, fetchImpl, now: () => NOW });
      const map = await src.fetchCounts([HASH]);
      expect(map.size).toBe(0);
      expect(src.lastStatus.ok).toBe(false);
      expect(typeof src.lastStatus.error).toBe('string');
    }
  });

  it('aborts on timeout and reports it without throwing', async () => {
    const fetchImpl = (_url: string, init: any) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    const src = createBitmagnetSource({ baseUrl: BASE, timeoutMs: 30, fetchImpl, now: () => NOW });
    const map = await src.fetchCounts([HASH]);
    expect(map.size).toBe(0);
    expect(src.lastStatus.error).toBe('timeout');
  });

  it('stays disabled without a usable baseUrl and never calls fetch', async () => {
    const fetchImpl = fakeFetch(() => jsonRes(itemsBody([])));
    for (const baseUrl of ['', '   ', 'ftp://host']) {
      const src = createBitmagnetSource({ baseUrl, fetchImpl, now: () => NOW });
      const map = await src.fetchCounts([HASH]);
      expect(map.size).toBe(0);
      expect(src.enabled).toBe(false);
      expect(src.lastStatus.error).toBe('disabled');
    }
    expect(fetchImpl.calls.length).toBe(0);
  });

  it('ignores unsolicited or malformed items in the answer', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonRes(itemsBody([item(HASH), item(HASH_B), { infoHash: 'nothex', seeders: 5, leechers: 1 }, null])),
    );
    const src = createBitmagnetSource({ baseUrl: BASE, fetchImpl, now: () => NOW });
    const map = await src.fetchCounts([HASH]);
    expect(map.size).toBe(1);
    expect(map.has(HASH)).toBe(true);
  });
});

describe('isFreshRow', () => {
  it('uses the age window and tolerates a small clock skew', () => {
    expect(isFreshRow({ updatedAt: NOW - 1000 }, 5000, NOW)).toBe(true);
    expect(isFreshRow({ updatedAt: NOW - 10000 }, 5000, NOW)).toBe(false);
    expect(isFreshRow({ updatedAt: null }, 5000, NOW)).toBe(false);
    expect(isFreshRow({}, 5000, NOW)).toBe(false);
    expect(isFreshRow({ updatedAt: NOW + 30000 }, 5000, NOW)).toBe(true);
    expect(isFreshRow({ updatedAt: NOW + 120000 }, 5000, NOW)).toBe(false);
    expect(isFreshRow(null, 5000, NOW)).toBe(false);
  });
});

describe('mergeBitmagnetCounts', () => {
  const existing = { seeders: 1, leechers: 0, live: true, verified: true, source: 'tracker', samples: 2 };
  const fresh = { seeders: 34, leechers: 1, updatedAt: NOW - 1000, source: 'bitmagnet' };

  it('applies a fresh row, marks source and age, keeps tracker verification', () => {
    const out = mergeBitmagnetCounts(existing, fresh, { now: () => NOW, maxAgeMs: 60000 });
    expect(out.seeders).toBe(34);
    expect(out.leechers).toBe(1);
    expect(out.source).toBe('bitmagnet');
    expect(out.fresh).toBe(true);
    expect(out.ageMs).toBe(1000);
    expect(out.estimate).toBe(true);
    expect(out.live).toBe(true);
    expect(out.verified).toBe(true);
    expect(out.samples).toBe(2);
  });

  it('keeps the existing number when the bitmagnet field is null', () => {
    const out = mergeBitmagnetCounts(existing, { ...fresh, seeders: null }, { now: () => NOW, maxAgeMs: 60000 });
    expect(out.seeders).toBe(1);
    expect(out.leechers).toBe(1);
    expect(out.fresh).toBe(true);
  });

  it('does not apply a stale row and does not touch a tracker row', () => {
    const stale = { ...fresh, updatedAt: NOW - BITMAGNET_MAX_AGE_MS - 1000 };
    const out = mergeBitmagnetCounts(existing, stale, { now: () => NOW });
    expect(out.seeders).toBe(1);
    expect(out.source).toBe('tracker');
    expect(out.fresh).toBe(false);
    expect(out.live).toBe(true);
    expect(out.ageMs).toBe(BITMAGNET_MAX_AGE_MS + 1000);
  });

  it('demotes a stale bitmagnet-sourced row so it is never shown as live', () => {
    const bmRow = { ...existing, source: 'bitmagnet', seeders: 34 };
    const stale = { ...fresh, updatedAt: NOW - BITMAGNET_MAX_AGE_MS - 1000 };
    const out = mergeBitmagnetCounts(bmRow, stale, { now: () => NOW });
    expect(out.live).toBe(false);
    expect(out.verified).toBe(false);
    expect(out.fresh).toBe(false);
    expect(out.seeders).toBe(34);
    const absent = mergeBitmagnetCounts(bmRow, null, { now: () => NOW });
    expect(absent.live).toBe(false);
    expect(absent.fresh).toBe(false);
  });

  it('honours a custom maxAgeMs and survives an empty existing row', () => {
    const out = mergeBitmagnetCounts({}, fresh, { now: () => NOW, maxAgeMs: 500 });
    expect(out.fresh).toBe(false);
    const out2 = mergeBitmagnetCounts({}, fresh, { now: () => NOW, maxAgeMs: 5000 });
    expect(out2.seeders).toBe(34);
    expect(out2.live).toBe(false);
    expect(out2.fresh).toBe(true);
  });
});

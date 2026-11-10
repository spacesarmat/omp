import { describe, expect, it, beforeEach } from 'vitest';
import { TorrServerClient } from '../../src/api/torrserver';
import { cacheNodesOn, saveBillingAccess } from '../../src/billing/entitlement';
import { saveBillingSession } from '../../src/billing/session';
import { cacheBase, clearCacheSources, rememberCacheSource, rewritePlaybackUrl } from '../../src/cache/cacheNode';
import { buildTorrentQueue } from '../../src/player/queue';

const HASH = 'ab'.repeat(20);

describe('cache playback hook', () => {
  beforeEach(() => {
    clearCacheSources();
    localStorage.clear();
  });

  it('keeps the local URL until a cache source for the same hash is known', () => {
    const local = 'http://127.0.0.1:8090/stream/film.mkv?link=' + HASH + '&index=1&play';
    expect(rewritePlaybackUrl(local, HASH, null)).toBe(local);
    expect(cacheBase('http://user:secret@cache.example:8090')).toBe('');
    expect(cacheBase('http://127.0.0.1:8090')).toBe('');
    const source = { url: 'http://cache.example:8090', infohash: HASH, title: 'Film', prefixBytes: 10 };
    expect(rewritePlaybackUrl(local, HASH, source)).toBe('http://cache.example:8090/stream/film.mkv?link=' + HASH + '&index=1&play');
    expect(rewritePlaybackUrl(local, 'cd'.repeat(20), source)).toBe(local);
    expect(cacheNodesOn()).toBe(false);
  });

  it('rewrites a queue only after the source is remembered, and a missing flag does not', () => {
    saveBillingSession({ token: 'legacy-token', paidUntil: Date.now() + 86400000, id: 'sess' });
    saveBillingAccess({ active: true, accessUntil: Date.now() + 86400000, cacheNodes: false });
    expect(cacheNodesOn()).toBe(false);
    const c = new TorrServerClient({ url: 'http://10.0.0.8:8090' });
    const files = [{ id: 1, path: 'Film.mkv', length: 10 }];
    const before = buildTorrentQueue(c, { hash: HASH, title: 'Film', stat: 3 }, files);
    expect(before[0].url).toBe(c.streamUrl(HASH, 1, 'Film.mkv'));
    rememberCacheSource(HASH, { url: 'http://cache.example:8090', infohash: HASH, title: 'Film', prefixBytes: 5 });
    const after = buildTorrentQueue(c, { hash: HASH, title: 'Film', stat: 3 }, files);
    expect(after[0].url.indexOf('http://cache.example:8090/')).toBe(0);
    expect(after[0].url).not.toBe(before[0].url);
  });
});

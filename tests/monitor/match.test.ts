import { describe, it, expect } from 'vitest';
import { matchesQuality, matchesSubscription, filterForSubscription, resultSize, resultKeys, isSeen, seenEntry, seenIndex } from '../../src/monitor/match';
import type { Subscription } from '../../src/monitor/types';
import type { SourceResult } from '../../src/sources/types';

const GB = 1024 * 1024 * 1024;

function res(Title: string, extra?: Partial<SourceResult>): SourceResult {
  return { Title, Categories: '', Size: '', CreateDate: '', Tracker: 'rutor', Link: '', Magnet: '', Hash: '', Peer: 0, Seed: 10, source: 'rutor', ...extra };
}

function sub(extra?: Partial<Subscription>): Subscription {
  return { id: 's1', query: 'Дюна', quality: '', sources: null, notify: true, createdAt: 1, ...extra };
}

describe('matchesQuality', () => {
  it('any, 720p+, 1080p+, 2160p', () => {
    const t720 = 'Дюна (2021) WEB-DL 720p';
    const t1080 = 'Дюна (2021) BDRip 1080p';
    const t4k = 'Дюна / Dune (2021) UHD BDRemux 2160p | 4K';
    const none = 'Дюна (2021) DVDRip';
    expect([t720, t1080, t4k, none].map((t) => matchesQuality(t, ''))).toEqual([true, true, true, true]);
    expect([t720, t1080, t4k, none].map((t) => matchesQuality(t, '720'))).toEqual([true, true, true, false]);
    expect([t720, t1080, t4k, none].map((t) => matchesQuality(t, '1080'))).toEqual([false, true, true, false]);
    expect([t720, t1080, t4k, none].map((t) => matchesQuality(t, '2160'))).toEqual([false, false, true, false]);
    expect(matchesQuality('Dune.2021.4K.HDR', '2160')).toBe(true);
  });
});

describe('matchesSubscription', () => {
  it('seeds and size limits; unknown size passes', () => {
    const s = sub({ minSeeds: 5, maxSizeGb: 20 });
    expect(matchesSubscription(s, res('a', { Seed: 5, sizeBytes: 20 * GB }))).toBe(true);
    expect(matchesSubscription(s, res('a', { Seed: 4, sizeBytes: GB }))).toBe(false);
    expect(matchesSubscription(s, res('a', { Seed: 9, sizeBytes: 21 * GB }))).toBe(false);
    expect(matchesSubscription(s, res('a', { Seed: 9, Size: '25.3 GB' }))).toBe(false);
    expect(matchesSubscription(s, res('a', { Seed: 9 }))).toBe(true);
    expect(resultSize(res('a', { Size: '1.5 GB' }))).toBe(Math.round(1.5 * GB));
    expect(resultSize(res('a'))).toBeNull();
  });

  it('filters a list with the quality', () => {
    const list = [res('Дюна 720p'), res('Дюна 1080p'), res('Дюна 2160p', { Seed: 0 })];
    expect(filterForSubscription(sub({ quality: '1080' }), list).map((r) => r.Title)).toEqual(['Дюна 1080p', 'Дюна 2160p']);
    expect(filterForSubscription(sub({ quality: '1080', minSeeds: 1 }), list).map((r) => r.Title)).toEqual(['Дюна 1080p']);
  });
});

describe('resultKeys / isSeen', () => {
  it('infohash and normalized title + size bucket', () => {
    const a = res('Дюна: Часть вторая (2024) WEB-DL 1080p', { hash: 'a'.repeat(40), sizeBytes: 10 * GB });
    const keys = resultKeys(a);
    expect(keys[0]).toBe('h:' + 'a'.repeat(40));
    expect(keys[1].indexOf('t:дюна часть вторая 2024 web dl 1080p:')).toBe(0);
    expect(keys).toHaveLength(2);
    // the same release from a site without the hash, the size a little different, punctuation and ё differ
    const b = res('ДЮНА. Часть вторая (2024) WEB-DL 1080p', { sizeBytes: 10 * GB + 1024 * 1024 });
    expect(resultKeys(b)).toEqual([keys[1]]);
    expect(isSeen(b, keys)).toBe(true);
    // another size is another release
    expect(isSeen(res(a.Title, { sizeBytes: 12 * GB }), keys)).toBe(false);
    // the hash alone is enough
    expect(isSeen(res('other title', { hash: 'a'.repeat(40) }), keys)).toBe(true);
    expect(resultKeys(res('Без размера'))).toEqual(['t:без размера:?']);
    // stored entries: one per result, matched by either key
    const entry = seenEntry(a);
    expect(entry).toBe(keys.join('|'));
    expect(isSeen(b, [entry])).toBe(true);
    expect(isSeen(res('other title', { hash: 'a'.repeat(40) }), seenIndex(['x', entry]))).toBe(true);
    expect(isSeen(res('other title'), [entry])).toBe(false);
  });
});

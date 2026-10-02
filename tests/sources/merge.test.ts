import { describe, it, expect } from 'vitest';
import { mergeResults, normalizeTitle } from '../../src/sources/merge';
import type { SourceResult } from '../../src/sources/types';

const GB = 1024 * 1024 * 1024;

function r(p: Partial<SourceResult> & { source: string; Title: string }): SourceResult {
  return { Categories: '', Size: '', CreateDate: '', Tracker: p.source, Link: '', Magnet: '', Hash: '', Peer: 0, Seed: 0, ...p };
}

describe('normalizeTitle', () => {
  it('lowercases, ё→е, collapses punctuation and spaces', () => {
    expect(normalizeTitle('  Ёлки-палки:  Фильм (2026) [1080p]  ')).toBe('елки палки фильм 2026 1080p');
    expect(normalizeTitle('The.Movie.2026.WEB-DL')).toBe('the movie 2026 web dl');
  });
});

describe('mergeResults', () => {
  it('merges by infohash and keeps the result with most seeds', () => {
    const out = mergeResults([
      r({ source: 'rutor', Title: 'A', hash: 'aa', Seed: 5 }),
      r({ source: 'nnmclub', Title: 'A other name', hash: 'aa', Seed: 50 }),
      r({ source: 'bitru', Title: 'B', hash: 'bb', Seed: 1 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].source).toBe('nnmclub');
    expect(out[0].sources).toEqual(['rutor']);
    expect(out[1].source).toBe('bitru');
    expect(out[1].sources).toBeUndefined();
  });

  it('merges by normalized title and size within ±1%', () => {
    const out = mergeResults([
      r({ source: 'rutor', Title: 'Фильм (2026) 1080p', sizeBytes: 10 * GB, Seed: 3 }),
      r({ source: 'bitru', Title: 'фильм 2026 1080P', sizeBytes: 10.05 * GB, Seed: 9 }),
      r({ source: 'nnmclub', Title: 'Фильм (2026) 1080p', sizeBytes: 10.5 * GB, Seed: 100 }),
      r({ source: 'anidub', Title: 'Фильм (2026) 1080p', Seed: 1 }),
    ]);
    expect(out.map((x) => x.source)).toEqual(['bitru', 'nnmclub', 'anidub']);
    expect(out[0].sources).toEqual(['rutor']);
  });

  it('lists each other source once and fills a missing magnet from a duplicate', () => {
    const out = mergeResults([
      r({ source: 'rutor', Title: 'X', hash: 'cc', Seed: 9 }),
      r({ source: 'bitru', Title: 'X', hash: 'cc', Seed: 1, Magnet: 'magnet:?xt=urn:btih:cc' }),
      r({ source: 'bitru', Title: 'X', hash: 'cc', Seed: 2 }),
      r({ source: 'rutor', Title: 'X', hash: 'cc', Seed: 0 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].Seed).toBe(9);
    expect(out[0].sources).toEqual(['bitru']);
    expect(out[0].Magnet).toBe('magnet:?xt=urn:btih:cc');
  });

  it('does not mutate the input', () => {
    const a = r({ source: 'rutor', Title: 'X', hash: 'cc', Seed: 9 });
    const b = r({ source: 'bitru', Title: 'X', hash: 'cc', Seed: 1 });
    mergeResults([a, b]);
    expect(a.sources).toBeUndefined();
  });

  it('different hashes are never merged even with the same title and size', () => {
    const out = mergeResults([
      r({ source: 'rutor', Title: 'X', hash: 'aa', sizeBytes: GB }),
      r({ source: 'bitru', Title: 'X', hash: 'bb', sizeBytes: GB }),
    ]);
    expect(out).toHaveLength(2);
  });
});

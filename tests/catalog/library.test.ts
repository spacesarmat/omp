import { describe, it, expect } from 'vitest';
import { libraryKey, libraryIndex, inLibrary, seasonIndex, inLibrarySeason, librarySeasonHash } from '../../src/catalog/library';

describe('library matching', () => {
  it('libraryKey normalises case, yo, punctuation and adds the year', () => {
    expect(libraryKey('  Ёлки: Новые!! ', 2026)).toBe('елки новые|2026');
    expect(libraryKey('Abc', 0)).toBe('abc|0');
  });

  it('matches a torrent with the year in the title', () => {
    const idx = libraryIndex([{ title: 'Северный ветер (2026) WEB-DL 1080p' }]);
    expect(inLibrary(idx, { title: 'Северный ветер', original: 'North Wind', year: 2026 })).toBe(true);
  });

  it('matches by either part of a slashed title, without a year', () => {
    const idx = libraryIndex([{ title: 'Орбитальная станция / Orbit Station / Сезон: 2' }]);
    expect(inLibrary(idx, { title: 'Орбитальная станция', original: 'Orbit Station', year: 2024 })).toBe(true);
    expect(inLibrary(idx, { title: 'Другое', original: 'Orbit Station', year: 0 })).toBe(true);
  });

  it('does not match another year', () => {
    const idx = libraryIndex([{ title: 'Северный ветер (2019)' }]);
    expect(inLibrary(idx, { title: 'Северный ветер', original: 'North Wind', year: 2026 })).toBe(false);
  });
});

describe('season matching', () => {
  const show = { title: 'Ледяной перевал', original: 'Frost Pass' };

  it('a torrent of season 2 marks only season 2', () => {
    const idx = seasonIndex([{ title: 'Ледяной перевал / Frost Pass (2025) 2 сезон WEB-DL 1080p' }]);
    expect(inLibrarySeason(idx, show, 2)).toBe(true);
    expect(inLibrarySeason(idx, show, 1)).toBe(false);
    expect(inLibrarySeason(idx, show, 3)).toBe(false);
  });

  it('a torrent without a season or a year marks none', () => {
    const idx = seasonIndex([{ title: 'Ледяной перевал WEB-DL 1080p' }]);
    expect(idx.size).toBe(0);
    expect(inLibrarySeason(idx, show, 1)).toBe(false);
  });

  it('a season range marks each season in it', () => {
    const idx = seasonIndex([{ title: 'Ледяной перевал / Сезоны: 1-3 (2024-2026) WEB-DL' }]);
    expect([1, 2, 3, 4].map((n) => inLibrarySeason(idx, show, n))).toEqual([true, true, true, false]);
  });

  it('matches by the original name and an S02 mark; another series does not match', () => {
    const idx = seasonIndex([{ title: 'Frost Pass S02 1080p' }]);
    expect(inLibrarySeason(idx, show, 2)).toBe(true);
    expect(inLibrarySeason(idx, { title: 'Тёплый перевал', original: 'Warm Pass' }, 2)).toBe(false);
  });

  it('keeps the hash of the first torrent with the season', () => {
    const idx = seasonIndex([
      { title: 'Ледяной перевал WEB-DL', hash: 'h0' },
      { title: 'Ледяной перевал / Frost Pass / Сезоны: 1-2 WEB-DL', hash: 'h1' },
      { title: 'Frost Pass S02 2160p', hash: 'h2' },
      { title: 'Ледяной перевал (2026) 3 сезон WEB-DL', hash: 'h3' },
    ]);
    expect(librarySeasonHash(idx, show, 1)).toBe('h1');
    expect(librarySeasonHash(idx, show, 2)).toBe('h1');
    expect(librarySeasonHash(idx, show, 3)).toBe('h3');
    expect(librarySeasonHash(idx, show, 4)).toBe('');
    expect(librarySeasonHash(idx, { title: 'Другой', original: 'Frost Pass' }, 2)).toBe('h1');
  });
});

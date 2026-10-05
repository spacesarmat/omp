import { describe, it, expect } from 'vitest';
import { libraryKey, libraryIndex, inLibrary } from '../../src/catalog/library';

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

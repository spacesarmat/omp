import { describe, it, expect } from 'vitest';
import { libraryKey, libraryIndex, inLibrary, seasonIndex, seasonHashIndex, inLibrarySeason, inLibrarySeries, seriesNames, librarySeasonHash, librarySeasonHashes } from '../../src/catalog/library';

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

  it('a cleaned title keeps the year from the saved release string', () => {
    const data = JSON.stringify({ omp: { rt: 'Дюна / Dune (2021) 1080p' } });
    const idx = libraryIndex([{ title: 'Дюна', data }]);
    expect(inLibrary(idx, { title: 'Дюна', original: 'Dune', year: 2021 })).toBe(true);
    expect(inLibrary(idx, { title: 'Дюна', original: 'Dune', year: 1984 })).toBe(false);
  });

  it('a title the person typed wins over the saved release string', () => {
    const data = JSON.stringify({ omp: { rt: 'Дюна / Dune (1984) 1080p', nm: true } });
    const idx = libraryIndex([{ title: 'Дюна (2021)', data }]);
    expect(inLibrary(idx, { title: 'Дюна', original: 'Dune', year: 2021 })).toBe(true);
    expect(inLibrary(idx, { title: 'Дюна', original: 'Dune', year: 1984 })).toBe(false);
  });

  it('a rename without a year keeps the year from the saved release string', () => {
    const data = JSON.stringify({ omp: { rt: 'Дюна / Dune (2021) 1080p', nm: true } });
    const idx = libraryIndex([{ title: 'Дюна', data }]);
    expect(inLibrary(idx, { title: 'Дюна', original: 'Dune', year: 2021 })).toBe(true);
    expect(inLibrary(idx, { title: 'Дюна', original: 'Dune', year: 1984 })).toBe(false);
  });
});

describe('a card only reads the releases of its kind', () => {
  const pack = [{ title: 'Содержание / The Content (2 сезон) 2024 WEB-DL' }];
  const named = { title: 'Содержание', original: 'The Content', year: 2024 };

  it('a season release does not claim the film of the same name and year', () => {
    const idx = libraryIndex(pack);
    expect(inLibrary(idx, { ...named, kind: 'movie' })).toBe(false);
    expect(inLibrary(idx, { ...named, kind: 'tv' })).toBe(true);
  });

  it('a release that names no year claims no film of another year (a remake)', () => {
    const idx = libraryIndex([{ title: 'Король Лев / The Lion King WEB-DL' }]);
    const lion = (year: number) => ({ title: 'Король Лев', original: 'The Lion King', year, kind: 'movie' as const });
    expect(inLibrary(idx, lion(2019))).toBe(false);
    expect(inLibrary(idx, lion(1994))).toBe(false);
  });

  it('a film release that names its year still claims that film', () => {
    const idx = libraryIndex([{ title: 'Король Лев / The Lion King (2019) 1080p' }]);
    const lion = (year: number) => ({ title: 'Король Лев', original: 'The Lion King', year, kind: 'movie' as const });
    expect(inLibrary(idx, lion(2019))).toBe(true);
    expect(inLibrary(idx, lion(1994))).toBe(false);
  });

  it('a season release that names no year still claims the series', () => {
    const idx = libraryIndex([{ title: 'Медсестра / The Nurse 3 сезон WEB-DL' }]);
    expect(inLibrary(idx, { title: 'Медсестра', original: 'The Nurse', year: 2026, kind: 'tv' })).toBe(true);
  });

  it('a film whose name carries a season number keeps its mark', () => {
    const idx = libraryIndex([{ title: 'Сезон охоты 2 / Open Season 2 (2008) BDRip' }]);
    expect(inLibrary(idx, { title: 'Сезон охоты 2', original: 'Open Season 2', year: 2008, kind: 'movie' })).toBe(true);
  });

  it('a complete-series pack is no film, even when it names a year', () => {
    const idx = libraryIndex([{ title: 'Содержание / The Content (2024) Complete Series WEB-DL' }]);
    expect(inLibrary(idx, { ...named, kind: 'movie' })).toBe(false);
    expect(inLibrary(idx, { ...named, kind: 'tv' })).toBe(true);
  });

  it('a renamed season pack is still a season pack', () => {
    const data = JSON.stringify({ omp: { rt: 'Содержание / The Content (2 сезон) 2024 WEB-DL', nm: true } });
    const idx = libraryIndex([{ title: 'Содержание (2024)', data }]);
    expect(inLibrary(idx, { ...named, kind: 'movie' })).toBe(false);
    expect(inLibrary(idx, { ...named, kind: 'tv' })).toBe(true);
  });

  it('a bracketed season label is a pack, not a film name', () => {
    const idx = libraryIndex([{ title: 'Содержание / The Content (Сезон: 2) 2024 WEB-DL' }]);
    expect(inLibrary(idx, { ...named, kind: 'movie' })).toBe(false);
    expect(inLibrary(idx, { ...named, kind: 'tv' })).toBe(true);
    const en = libraryIndex([{ title: 'The Content (Season 2) 2024 WEB-DL' }]);
    const content = { title: 'The Content', original: 'The Content', year: 2024 };
    expect(inLibrary(en, { ...content, kind: 'movie' })).toBe(false);
    expect(inLibrary(en, { ...content, kind: 'tv' })).toBe(true);
  });

  it('the «Сериалы» category of the server settles it without any mark', () => {
    const idx = libraryIndex([{ title: 'Содержание / The Content (2024) WEB-DL', category: 'tv' }]);
    expect(inLibrary(idx, { ...named, kind: 'movie' })).toBe(false);
    expect(inLibrary(idx, { ...named, kind: 'tv' })).toBe(true);
  });

  it('a film name with a season number stays a film even if the guess called it «Сериалы»', () => {
    const idx = libraryIndex([{ title: 'Сезон охоты 2 / Open Season 2 (2008) BDRip', category: 'tv' }]);
    expect(inLibrary(idx, { title: 'Сезон охоты 2', original: 'Open Season 2', year: 2008, kind: 'movie' })).toBe(true);
  });

  it('without a kind both readings still match, as before', () => {
    expect(inLibrary(libraryIndex(pack), named)).toBe(true);
    expect(inLibrary(libraryIndex([{ title: 'Король Лев / The Lion King WEB-DL' }]), { title: 'Король Лев', original: 'The Lion King', year: 2019 })).toBe(true);
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
    const all = seasonHashIndex([
      { title: 'Ледяной перевал / Frost Pass / Сезоны: 1-2 WEB-DL', hash: 'h1' },
      { title: 'Frost Pass S02 2160p', hash: 'h2' },
      { title: 'Ледяной перевал (2026) 3 сезон WEB-DL', hash: 'h3' },
    ]);
    expect(librarySeasonHashes(all, show, 2)).toEqual(['h1', 'h2']);
    expect(librarySeasonHashes(all, show, 3)).toEqual(['h3']);
    expect(librarySeasonHashes(all, show, 4)).toEqual([]);
  });
});

describe('a release string that lists several works', () => {
  const pack = [{ title: 'Крестьянин 999 уровня / Второй брак императрицы / Рамаяна. Возрождение' }];

  it('marks owned only the work the release is named after', () => {
    const idx = libraryIndex(pack);
    expect(inLibrary(idx, { title: 'Крестьянин 999 уровня', original: '999 Level Farmer', year: 2026 })).toBe(true);
    expect(inLibrary(idx, { title: 'Второй брак императрицы', original: 'Empress Second Marriage', year: 2026 })).toBe(false);
    expect(inLibrary(idx, { title: 'Рамаяна. Возрождение', original: 'Ramayana: Rebirth', year: 2026 })).toBe(false);
  });

  it('keeps a translation in another script as the same work', () => {
    const idx = libraryIndex([{ title: 'Дюна: Часть вторая / Dune: Part Two (2024) 2160p' }]);
    expect(inLibrary(idx, { title: 'Dune: Part Two', original: 'Дюна: Часть вторая', year: 2024 })).toBe(true);
    expect(inLibrary(idx, { title: 'Пак Дюна', original: 'Dune: Part Two', year: 2024 })).toBe(true);
  });

  it('season keys of a pack name only its first work', () => {
    const idx = seasonIndex([{ title: 'Дорама А / Дорама Б 1 сезон [LostFilm]' }]);
    expect(inLibrarySeason(idx, { title: 'Дорама А', original: 'Dorama A' }, 1)).toBe(true);
    expect(inLibrarySeason(idx, { title: 'Дорама Б', original: 'Dorama B' }, 1)).toBe(false);
    expect(inLibrarySeries(seriesNames(idx), { title: 'Дорама Б', original: 'Dorama B' })).toBe(false);
  });
});

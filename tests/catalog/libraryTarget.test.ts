import { describe, it, expect, beforeEach } from 'vitest';
import { libraryTargetOf, ownedChecker, torrentTarget } from '../../src/catalog/libraryTarget';
import { seriesKey } from '../../src/lib/seriesGroups';
import { applySyncedMatch, resetSeriesMatches, seriesMatchVersion } from '../../src/lib/seriesMatch';
import type { Torrent } from '../../src/api/types';
import type { CatalogTitle } from '../../src/catalog/tmdb';

const a = { hash: 'a', title: 'Тёмная материя / Dark Matter (2 сезон) 2026 WEB-DL' } as Torrent;
const b = { hash: 'b', title: 'Дюна: Часть вторая / Dune: Part Two (2024) 2160p' } as Torrent;
const list = [a, b];

const dark = { kind: 'tv' as 'tv' | 'movie', title: 'Тёмная материя', original: 'Dark Matter', year: 2024 };
const dune = { kind: 'movie' as 'tv' | 'movie', title: 'Дюна: Часть вторая', original: 'Dune: Part Two', year: 2024 };
const nope = { kind: 'movie' as 'tv' | 'movie', title: 'Ничего', original: 'Nothing', year: 2001 };
const asTitle = (t: { kind: 'tv' | 'movie'; title: string; original: string; year: number; id?: number }): CatalogTitle => ({ ...t, id: t.id || 1, poster: '', rating: 0 });

describe('libraryTargetOf', () => {
  it('opens the series on the newest season of the library', () => {
    expect(libraryTargetOf(list, dark)).toEqual({ kind: 'series', key: seriesKey(a), season: 2 });
  });
  it('opens the torrent of a film', () => {
    expect(libraryTargetOf(list, dune)).toEqual({ kind: 'torrent', hash: 'b' });
  });
  it('is null for a title the library lacks', () => {
    expect(libraryTargetOf(list, nope)).toBeNull();
    expect(libraryTargetOf([], dark)).toBeNull();
  });
  it('torrentTarget puts the season on the series screen', () => {
    expect(torrentTarget(list, a, 2)).toEqual({ kind: 'series', key: seriesKey(a), season: 2 });
    expect(torrentTarget(list, b)).toEqual({ kind: 'torrent', hash: 'b' });
  });
});

describe('ownedChecker', () => {
  it('agrees with libraryTargetOf', () => {
    const owned = ownedChecker(list);
    expect(owned(asTitle(dark))).toBe(true);
    expect(owned(asTitle(dune))).toBe(true);
    expect(owned(asTitle(nope))).toBe(false);
  });
});

describe('a film card against a season release', () => {
  const pack = { hash: 'p', title: 'Содержание / The Content (2 сезон) 2024 WEB-DL' } as Torrent;
  const film = { kind: 'movie' as const, title: 'Содержание', original: 'The Content', year: 2024 };
  const show = { kind: 'tv' as const, title: 'Содержание', original: 'The Content', year: 2024 };

  it('the film gets no target and no mark from the series pack of the same name', () => {
    expect(libraryTargetOf([pack], film)).toBeNull();
    expect(ownedChecker([pack])(asTitle(film))).toBe(false);
  });

  it('the series card still opens the season screen', () => {
    expect(libraryTargetOf([pack], show)).toEqual({ kind: 'series', key: seriesKey(pack), season: 2 });
    expect(ownedChecker([pack])(asTitle(show))).toBe(true);
  });
});

describe('a release that bundles several works', () => {
  const pack = { hash: 'p', title: 'Крестьянин 999 уровня / Второй брак императрицы / Рамаяна. Возрождение' } as Torrent;
  const peasant = { kind: 'tv' as 'tv' | 'movie', title: 'Крестьянин 999 уровня', original: '999 Level Farmer', year: 2026 };
  const marriage = { kind: 'tv' as 'tv' | 'movie', title: 'Второй брак императрицы', original: 'Empress Second Marriage', year: 2026 };
  const ramayana = { kind: 'movie' as 'tv' | 'movie', title: 'Рамаяна. Возрождение', original: 'Ramayana: Rebirth', year: 2026 };

  it('opens the pack only for the work it is named after', () => {
    expect(libraryTargetOf([pack], peasant)).toEqual({ kind: 'torrent', hash: 'p' });
    expect(libraryTargetOf([pack], marriage)).toBeNull();
    expect(libraryTargetOf([pack], ramayana)).toBeNull();
  });

  it('ownedChecker does not mark the bundled cards owned', () => {
    const owned = ownedChecker([pack]);
    expect(owned(asTitle(peasant))).toBe(true);
    expect(owned(asTitle(marriage))).toBe(false);
    expect(owned(asTitle(ramayana))).toBe(false);
  });
});

describe('a pack that lists each work in two scripts', () => {
  const pack = { hash: 'p', title: 'Крестьянин 999 уровня / 999 Level Farmer / Маска вермильона / Vermillion Mask' } as Torrent;
  const first = { kind: 'tv' as const, title: 'Крестьянин 999 уровня', original: '999 Level Farmer', year: 2026 };
  const second = { kind: 'tv' as const, title: 'Маска вермильона', original: 'Vermillion Mask', year: 2026 };

  it('the second work neither opens the pack nor wears the mark', () => {
    expect(libraryTargetOf([pack], first)).toEqual({ kind: 'torrent', hash: 'p' });
    expect(libraryTargetOf([pack], second)).toBeNull();
    const owned = ownedChecker([pack]);
    expect(owned(asTitle(first))).toBe(true);
    expect(owned(asTitle(second))).toBe(false);
  });
});

describe('a release the person already matched to another show', () => {
  const show = { hash: 'h1', title: 'Маска вермильона / Vermillion Mask 1 сезон 2026 WEB-DL' } as Torrent;
  // the saved match is keyed by language and the series key, the way seriesMatch writes it
  const key = 'ru|' + seriesKey(show);

  beforeEach(() => {
    // the saved choices live in localStorage: without clearing them a test sees the previous test's match
    localStorage.removeItem('tsp.seriesTmdb');
    resetSeriesMatches();
  });

  it('keeps the card it was matched to and refuses the one of the same name', () => {
    resetSeriesMatches();
    applySyncedMatch(key, 100, '', Date.now());
    const mine = { kind: 'tv' as const, id: 100, title: 'Маска вермильона', original: 'Vermillion Mask', year: 2026 };
    const other = { kind: 'tv' as const, id: 200, title: 'Маска вермильона', original: 'Vermillion Mask', year: 2026 };
    expect(libraryTargetOf([show], mine)).toEqual({ kind: 'series', key: seriesKey(show), season: 1 });
    expect(libraryTargetOf([show], other)).toBeNull();
    const owned = ownedChecker([show]);
    expect(owned(asTitle(mine))).toBe(true);
    expect(owned(asTitle(other))).toBe(false);
  });

  it('a release nobody matched yet still answers by name', () => {
    const cold = { hash: 'h2', title: 'Ледяной перевал / Frost Pass 1 сезон 2026 WEB-DL' } as Torrent;
    const fresh = { kind: 'tv' as const, id: 300, title: 'Ледяной перевал', original: 'Frost Pass', year: 2026 };
    resetSeriesMatches();
    expect(libraryTargetOf([cold], fresh)).toEqual({ kind: 'series', key: seriesKey(cold), season: 1 });
    expect(ownedChecker([cold])(asTitle(fresh))).toBe(true);
  });

  it('a checker built before a correction sees it without being rebuilt', () => {
    resetSeriesMatches();
    const other = { kind: 'tv' as const, id: 200, title: 'Маска вермильона', original: 'Vermillion Mask', year: 2026 };
    const owned = ownedChecker([show]);
    expect(owned(asTitle(other))).toBe(true);
    applySyncedMatch(key, 100, '', Date.now());
    // this is what chooseSeries does when a person picks another show in the picker
    seriesMatchVersion.value = seriesMatchVersion.value + 1;
    expect(owned(asTitle(other))).toBe(false);
    resetSeriesMatches();
  });

  it('two releases of one name are one series: the chosen show wins for both', () => {
    const s2 = { hash: 'm2', title: 'Маска вермильона / Vermillion Mask 2 сезон 2026 WEB-DL' } as Torrent;
    resetSeriesMatches();
    expect(seriesKey(s2)).toBe(seriesKey(show));
    applySyncedMatch(key, 100, '', Date.now());
    const mine = { kind: 'tv' as const, id: 100, title: 'Маска вермильона', original: 'Vermillion Mask', year: 2026 };
    const other = { kind: 'tv' as const, id: 200, title: 'Маска вермильона', original: 'Vermillion Mask', year: 2026 };
    expect(libraryTargetOf([show, s2], mine)!.kind).toBe('series');
    expect(libraryTargetOf([show, s2], other)).toBeNull();
    resetSeriesMatches();
  });

  it('the id check reads a name the same way the library index does', () => {
    const loud = { hash: 'd1', title: 'DARK MATTER!! (2 сезон) 2026 WEB-DL' } as Torrent;
    resetSeriesMatches();
    applySyncedMatch('ru|' + seriesKey(loud), 100, '', Date.now());
    const other = { kind: 'tv' as const, id: 200, title: 'Dark Matter', original: 'Dark Matter', year: 2024 };
    expect(ownedChecker([loud])(asTitle(other))).toBe(false);
    expect(libraryTargetOf([loud], other)).toBeNull();
    resetSeriesMatches();
  });
});

describe('ownedChecker on a big library', () => {
  // 36 000 lookups: alone it takes under two seconds, in a full suite run the workers share the machine
  it('agrees with libraryTargetOf for every credit (300 torrents x 120 credits)', { timeout: 20000 }, () => {
    const big: Torrent[] = [];
    for (let i = 0; i < 300; i++) {
      big.push({
        hash: 'h' + i,
        title: i % 2 ? 'Сериал' + i + ' / Show' + i + ' (' + ((i % 5) + 1) + ' сезон) 2020 WEB-DL' : 'Фильм' + i + ' / Film' + i + ' (2019) 1080p',
      } as Torrent);
    }
    const credits: CatalogTitle[] = [];
    for (let i = 0; i < 120; i++) {
      const n = i * 3; // every third is in the library for sure, the rest mostly not
      credits.push(asTitle({
        kind: i % 2 ? 'tv' : 'movie',
        title: (i % 2 ? 'Сериал' : 'Фильм') + n,
        original: (i % 2 ? 'Show' : 'Film') + n,
        year: i % 2 ? 2024 : 2019,
      }));
    }
    const owned = ownedChecker(big);
    let hits = 0;
    credits.forEach((c) => {
      const expected = libraryTargetOf(big, c) !== null;
      if (expected) hits++;
      expect(owned(c)).toBe(expected);
    });
    expect(hits).toBeGreaterThan(5);
    expect(hits).toBeLessThan(credits.length);
  });
});

import { describe, it, expect } from 'vitest';
import { libraryTargetOf, ownedChecker, torrentTarget } from '../../src/catalog/libraryTarget';
import { seriesKey } from '../../src/lib/seriesGroups';
import type { Torrent } from '../../src/api/types';
import type { CatalogTitle } from '../../src/catalog/tmdb';

const a = { hash: 'a', title: 'Тёмная материя / Dark Matter (2 сезон) 2026 WEB-DL' } as Torrent;
const b = { hash: 'b', title: 'Дюна: Часть вторая / Dune: Part Two (2024) 2160p' } as Torrent;
const list = [a, b];

const dark = { kind: 'tv' as 'tv' | 'movie', title: 'Тёмная материя', original: 'Dark Matter', year: 2024 };
const dune = { kind: 'movie' as 'tv' | 'movie', title: 'Дюна: Часть вторая', original: 'Dune: Part Two', year: 2024 };
const nope = { kind: 'movie' as 'tv' | 'movie', title: 'Ничего', original: 'Nothing', year: 2001 };
const asTitle = (t: { kind: 'tv' | 'movie'; title: string; original: string; year: number }): CatalogTitle => ({ ...t, id: 1, poster: '', rating: 0 });

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

describe('ownedChecker on a big library', () => {
  it('agrees with libraryTargetOf for every credit (300 torrents x 120 credits)', () => {
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

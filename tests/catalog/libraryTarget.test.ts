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

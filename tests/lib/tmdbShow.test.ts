import { describe, expect, it, afterEach } from 'vitest';
import { pickShow } from '../../src/lib/tmdbShow';
import { groupLibrary, singleGroup } from '../../src/lib/seriesGroups';
import { chooseSeries, resetSeriesMatches } from '../../src/lib/seriesMatch';
import { setCatalogProvider } from '../../src/catalog/activeCatalog';
import type { CatalogTitle, CatalogCard } from '../../src/catalog/tmdb';
import type { Torrent } from '../../src/api/types';

function show(title: string, year: number, rating: number, original = ''): CatalogTitle {
  return { kind: 'tv', id: year + rating, title, original, year, poster: '', rating };
}

const card = (id: number): CatalogCard => ({
  kind: 'tv', id, title: 'Loki', original: 'Loki', year: 2021, poster: '', rating: 8,
  backdrop: '', genres: [], runtime: 0, overview: '', cast: [], seasons: [], airing: false,
});

function tor(title: string, hash: string): Torrent {
  return { hash, title, category: 'tv', stat: 0 };
}

afterEach(() => {
  resetSeriesMatches();
  setCatalogProvider(null);
});

describe('pickShow', () => {
  it('prefers the show of the asked year whose title is the query, not a different show that only contains the word', () => {
    const picked = pickShow([
      show('Мифический детектив Локи', 2010, 7.2),
      show('Локи', 2021, 8.1, 'Loki'),
    ], 2021, 'Локи');
    expect(picked && picked.title).toBe('Локи');
    expect(picked && picked.year).toBe(2021);
  });
});

describe('groupLibrary TMDB id', () => {
  it('joins two differently named torrents once both were matched to the same show', async () => {
    setCatalogProvider(() => Promise.resolve({
      card: (_k: string, id: number) => Promise.resolve(card(id)),
    } as never));
    const a = tor('Локи S01 1080p', 'a'.repeat(40));
    const b = tor('Loki S02 1080p', 'b'.repeat(40));
    const ga = singleGroup(a);
    const gb = singleGroup(b);
    expect(ga && gb).toBeTruthy();
    await chooseSeries(ga!, 99);
    await chooseSeries(gb!, 99);
    const groups = groupLibrary([a, b]).filter((x) => x.kind === 'series');
    expect(groups).toHaveLength(1);
    if (groups[0].kind === 'series') expect(groups[0].members).toHaveLength(2);
  });
});

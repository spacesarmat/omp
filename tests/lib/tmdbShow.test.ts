import { describe, expect, it, afterEach } from 'vitest';
import { findShow, pickShow } from '../../src/lib/tmdbShow';
import { endpointOf, sanitizeList } from '../../src/catalog/tmdb';
import { groupLibrary, singleGroup } from '../../src/lib/seriesGroups';
import { chooseSeries, matchSeries, resetSeriesMatches } from '../../src/lib/seriesMatch';
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
  it('reads popularity, votes, seasons and runtime from a normal search answer', () => {
    const raw = {
      results: [
        { id: 1, media_type: 'tv', name: 'Локи', original_name: 'Loki', first_air_date: '2021-01-01', popularity: 10, vote_count: 100, number_of_seasons: 1, episode_run_time: [12] },
        { id: 84958, media_type: 'tv', name: 'Локи', original_name: 'Loki', first_air_date: '2021-06-09', popularity: 10, vote_count: 100, number_of_seasons: 2, episode_run_time: [50] },
      ],
    };
    const items = sanitizeList(endpointOf({ APIKey: 'k' })!, raw, null).items;
    expect(items.map((x) => [x.id, x.popularity, x.voteCount, x.seasonCount, x.runtime])).toEqual([
      [1, 10, 100, 1, 12],
      [84958, 10, 100, 2, 50],
    ]);
    expect(pickShow(items, 2021, 'локи', { season: 2, runtimeMin: 50 })!.id).toBe(84958);
  });

  it('prefers the show of the asked year whose title is the query, not a different show that only contains the word', () => {
    const picked = pickShow([
      show('Мифический детектив Локи', 2010, 7.2),
      show('Локи', 2021, 8.1, 'Loki'),
    ], 2021, 'Локи');
    expect(picked && picked.title).toBe('Локи');
    expect(picked && picked.year).toBe(2021);
  });

  it('Loki season 2 with six long 4K episodes is TMDB 84958, not the anime that only contains the name', () => {
    const anime = {
      ...show('Детектив Локи: Рагнарёк', 2003, 8.5, 'Matantei Loki'),
      id: 999, popularity: 3, voteCount: 20, seasonCount: 1, runtime: 24,
    };
    const marvel = {
      ...show('Loki', 2021, 8.1, 'Loki'),
      id: 84958, popularity: 180, voteCount: 6000, seasonCount: 2, runtime: 52,
    };
    const picked = pickShow([anime, marvel], 0, 'Локи', { season: 2, episodes: 6, runtimeMin: 45, modern: true });
    expect(picked && picked.id).toBe(84958);
  });

  it('the same rule holds for other short titles, not only Loki', () => {
    const partial = { ...show('Тьма на окраине', 2010, 9, 'Dark Edge'), id: 3, popularity: 400, seasonCount: 1, runtime: 24 };
    const exact = { ...show('Тьма', 2017, 8, 'Dark'), id: 70523, popularity: 2, seasonCount: 3, runtime: 55 };
    const picked = pickShow([partial, exact], 0, 'Тьма', { season: 3, runtimeMin: 50, modern: true });
    expect(picked && picked.id).toBe(70523);
  });

  it('an exact title still beats a more popular title that only contains the query', () => {
    const partial = { ...show('Детектив Локи: Рагнарёк', 2003, 9, 'Matantei Loki'), id: 1, popularity: 500 };
    const exact = { ...show('Локи', 2021, 7, 'Loki'), id: 84958, popularity: 1 };
    const picked = pickShow([partial, exact], 0, 'Локи');
    expect(picked && picked.id).toBe(84958);
  });

  it('keeps an exact title in another script ahead of a higher-rated different show', () => {
    const picked = pickShow([
      show('Your Name', 2016, 9),
      show('君の名は', 2016, 5),
    ], 0, '君の名は');
    expect(picked && picked.title).toBe('君の名は');
  });
});

describe('findShow', () => {
  it('keeps searching when the first query only has a show whose title contains the word', async () => {
    const anime = { ...show('Детектив Локи: Рагнарёк', 2003, 8.5, 'Matantei Loki'), id: 999 };
    const marvel = { ...show('Loki', 2021, 8.1, 'Loki'), id: 84958, popularity: 180 };
    const asked: string[] = [];
    const found = await findShow({
      search: (q: string) => {
        asked.push(q);
        if (q === 'Локи') return Promise.resolve({ items: [anime] });
        if (q === 'Loki') return Promise.resolve({ items: [marvel] });
        return Promise.resolve({ items: [] });
      },
    }, 'Локи / Loki', 0, { season: 2, episodes: 6, runtimeMin: 45, modern: true });
    expect(asked.indexOf('Loki') >= 0).toBe(true);
    expect(found && found.id).toBe(84958);
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

  it('a lookup that finishes after a manual choice keeps the chosen show', async () => {
    localStorage.clear();
    resetSeriesMatches();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    let started = false;
    setCatalogProvider(() => Promise.resolve({
      search: () => {
        started = true;
        return gate.then(() => ({ items: [show('Чужой', 2010, 5)], pages: 1 }));
      },
      card: (_k: string, id: number) => Promise.resolve(card(id)),
    } as never));
    const g = singleGroup(tor('Тьма S01 1080p', 'c'.repeat(40)));
    expect(g).toBeTruthy();
    const pending = matchSeries(g!);
    for (let i = 0; i < 20 && !started; i++) await Promise.resolve();
    expect(started).toBe(true);
    await chooseSeries(g!, 99);
    release();
    expect((await pending)!.id).toBe(99);
    expect((await matchSeries(g!))!.id).toBe(99);
  });

  it('a correction on a merged card covers every name in it', async () => {
    localStorage.clear();
    resetSeriesMatches();
    setCatalogProvider(() => Promise.resolve({
      search: () => Promise.resolve({ items: [show('Не тот', 2010, 9)], pages: 1 }),
      card: (_k: string, id: number) => Promise.resolve(card(id)),
    } as never));
    const a = tor('Тьма S01 1080p', 'd'.repeat(40));
    const b = tor('Dark S02 1080p', 'e'.repeat(40));
    const ga = singleGroup(a);
    const gb = singleGroup(b);
    expect(ga && gb && ga.key !== gb.key).toBeTruthy();
    await matchSeries(ga!);
    await matchSeries(gb!);
    const groups = groupLibrary([a, b]).filter((x) => x.kind === 'series');
    expect(groups).toHaveLength(1);
    if (groups[0].kind !== 'series') return;
    await chooseSeries(groups[0], 99);
    expect((await matchSeries(ga!))!.id).toBe(99);
    expect((await matchSeries(gb!))!.id).toBe(99);
    expect(groupLibrary([a, b]).filter((x) => x.kind === 'series')).toHaveLength(1);
  });

  it('drops a saved automatic match after the title is cleaned and searches again', async () => {
    localStorage.clear();
    resetSeriesMatches();
    const anime = { ...show('Детектив Локи: Рагнарёк', 2003, 8.5, 'Matantei Loki'), id: 999 };
    const marvel = { ...show('Локи', 2021, 8.1, 'Loki'), id: 84958, popularity: 180 };
    let mode = 'anime';
    setCatalogProvider(() => Promise.resolve({
      search: (q: string) => Promise.resolve({
        items: mode === 'anime' ? [anime] : (q === 'Локи' || q === 'Loki' ? [marvel] : []),
        pages: 1,
      }),
      card: (_k: string, id: number) => Promise.resolve({ ...card(id), title: id === 84958 ? 'Локи' : 'Детектив Локи: Рагнарёк', original: id === 84958 ? 'Loki' : 'Matantei Loki' }),
    } as never));
    const hash = 'f'.repeat(40);
    const raw = singleGroup(tor('Локи (2 сезон: 1-6 серии из 6) / Loki S02 2160p HDR', hash));
    const clean = singleGroup(tor('Локи', hash));
    expect(raw && clean && raw.key === clean.key).toBeTruthy();
    expect((await matchSeries(raw!))!.id).toBe(999);
    resetSeriesMatches();
    mode = 'marvel';
    expect((await matchSeries(clean!))!.id).toBe(84958);
  });
});

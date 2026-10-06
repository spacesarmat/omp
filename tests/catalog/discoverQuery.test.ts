import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { discoverUrl, sanitizeList, type CatalogTitle, type TmdbEndpoint } from '../../src/catalog/tmdb';
import { createCatalogClient, flushCatalogCache, resetCatalogCache } from '../../src/catalog/client';
import {
  DEFAULT_DISCOVER_QUERY, sanitizeDiscoverQuery, discoverQueryKey, discoverFilterCount, genresFor, GENRES, digitalSoonItems,
  type DiscoverQuery,
} from '../../src/catalog/discoverQuery';
import { applyLanguageSetting } from '../../src/i18n';
import { ru } from '../../src/i18n/ru';
import { en } from '../../src/i18n/en';
import type { SourceHttp } from '../../src/sources/types';

const E: TmdbEndpoint = { base: 'https://api.tmdb.mirror.test/3/', key: 'K', images: 'https://img.mirror.test' };
const TODAY = '2026-10-06';
const Q = (patch: Partial<DiscoverQuery>): DiscoverQuery => ({ ...DEFAULT_DISCOVER_QUERY, ...patch });

function params(url: string | null): { [k: string]: string } {
  expect(url).not.toBeNull();
  const out: { [k: string]: string } = {};
  url!.split('?')[1].split('&').forEach((kv) => {
    const i = kv.indexOf('=');
    out[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
  });
  return out;
}

describe('discover URLs', () => {
  it('default «Популярные»: /discover/{kind}, popularity, the page and language; series without talk, news and reality', () => {
    const m = discoverUrl(E, 'movie', DEFAULT_DISCOVER_QUERY, 2, TODAY)!;
    expect(m.indexOf('https://api.tmdb.mirror.test/3/discover/movie?')).toBe(0);
    const p = params(m);
    expect(p.sort_by).toBe('popularity.desc');
    expect(p.page).toBe('2');
    expect(p.language).toBe('ru-RU');
    expect(p.without_genres).toBeUndefined();
    expect(p.with_genres).toBeUndefined();
    const tv = params(discoverUrl(E, 'tv', DEFAULT_DISCOVER_QUERY, 1, TODAY));
    expect(tv.without_genres).toBe('10767,10763,10764');
    expect(discoverUrl(E, 'tv', DEFAULT_DISCOVER_QUERY, 1, TODAY)!.indexOf('/3/discover/tv?')).toBeGreaterThan(0);
  });

  it('«По рейтингу»: vote_average desc with a vote count floor (200 films, 100 series)', () => {
    const m = params(discoverUrl(E, 'movie', Q({ sort: 'rating' }), 1, TODAY));
    expect(m.sort_by).toBe('vote_average.desc');
    expect(m['vote_count.gte']).toBe('200');
    const tv = params(discoverUrl(E, 'tv', Q({ sort: 'rating' }), 1, TODAY));
    expect(tv['vote_count.gte']).toBe('100');
  });

  it('«По дате выхода»: newest released first, up to today', () => {
    const m = params(discoverUrl(E, 'movie', Q({ sort: 'date' }), 1, TODAY));
    expect(m.sort_by).toBe('primary_release_date.desc');
    expect(m['primary_release_date.lte']).toBe(TODAY);
    const tv = params(discoverUrl(E, 'tv', Q({ sort: 'date' }), 1, TODAY));
    expect(tv.sort_by).toBe('first_air_date.desc');
    expect(tv['first_air_date.lte']).toBe(TODAY);
  });

  it('«Самые ожидаемые»: from tomorrow on, by popularity', () => {
    const m = params(discoverUrl(E, 'movie', Q({ sort: 'upcoming' }), 1, TODAY));
    expect(m.sort_by).toBe('popularity.desc');
    expect(m['primary_release_date.gte']).toBe('2026-10-07');
    expect(m['primary_release_date.lte']).toBeUndefined();
    expect(params(discoverUrl(E, 'tv', Q({ sort: 'upcoming' }), 1, '2026-12-31'))['first_air_date.gte']).toBe('2027-01-01');
  });

  it('genres map to each kind; a chosen talk show / news / reality is no longer excluded', () => {
    const q = Q({ genres: ['action', 'adventure', 'comedy'] });
    expect(params(discoverUrl(E, 'movie', q, 1, TODAY)).with_genres).toBe('28|12|35');
    expect(discoverUrl(E, 'movie', q, 1, TODAY)).toContain('with_genres=28%7C12%7C35');
    // action and adventure are one series genre
    expect(params(discoverUrl(E, 'tv', q, 1, TODAY)).with_genres).toBe('10759|35');
    const talk = params(discoverUrl(E, 'tv', Q({ genres: ['talk'] }), 1, TODAY));
    expect(talk.with_genres).toBe('10767');
    expect(talk.without_genres).toBe('10763,10764');
    const all3 = params(discoverUrl(E, 'tv', Q({ genres: ['talk', 'news', 'reality'] }), 1, TODAY));
    expect(all3.without_genres).toBeUndefined();
    // films have no talk shows: nothing to ask
    expect(discoverUrl(E, 'movie', Q({ genres: ['talk'] }), 1, TODAY)).toBeNull();
    expect(discoverUrl(E, 'tv', Q({ genres: ['horror'] }), 1, TODAY)).toBeNull();
  });

  it('year: this, last and a range; combined with the sort dates', () => {
    const t = params(discoverUrl(E, 'movie', Q({ year: 'this' }), 1, TODAY));
    expect(t['primary_release_date.gte']).toBe('2026-01-01');
    expect(t['primary_release_date.lte']).toBe('2026-12-31');
    const l = params(discoverUrl(E, 'tv', Q({ year: 'last' }), 1, TODAY));
    expect(l['first_air_date.gte']).toBe('2025-01-01');
    expect(l['first_air_date.lte']).toBe('2025-12-31');
    const r = params(discoverUrl(E, 'movie', Q({ year: 'range', from: 1990, to: 1999 }), 1, TODAY));
    expect(r['primary_release_date.gte']).toBe('1990-01-01');
    expect(r['primary_release_date.lte']).toBe('1999-12-31');
    const open = params(discoverUrl(E, 'movie', Q({ year: 'range', from: 2010 }), 1, TODAY));
    expect(open['primary_release_date.gte']).toBe('2010-01-01');
    expect(open['primary_release_date.lte']).toBeUndefined();
    // this year, newest released: up to today
    expect(params(discoverUrl(E, 'movie', Q({ year: 'this', sort: 'date' }), 1, TODAY))['primary_release_date.lte']).toBe(TODAY);
  });

  it('country and minimum rating', () => {
    const p = params(discoverUrl(E, 'tv', Q({ country: 'KR', rating: 7 }), 1, TODAY));
    expect(p.with_origin_country).toBe('KR');
    expect(p['vote_average.gte']).toBe('7');
    expect(p['vote_count.gte']).toBe('50');
    expect(params(discoverUrl(E, 'movie', Q({ rating: 8, sort: 'rating' }), 1, TODAY))['vote_count.gte']).toBe('200');
  });

  it('English: en-US', () => {
    applyLanguageSetting('en');
    try {
      expect(params(discoverUrl(E, 'movie', DEFAULT_DISCOVER_QUERY, 1, TODAY)).language).toBe('en-US');
    } finally {
      applyLanguageSetting('ru');
    }
  });
});

describe('discover query', () => {
  it('sanitizes anything stored', () => {
    expect(sanitizeDiscoverQuery(null)).toEqual(DEFAULT_DISCOVER_QUERY);
    expect(sanitizeDiscoverQuery('junk')).toEqual(DEFAULT_DISCOVER_QUERY);
    expect(sanitizeDiscoverQuery({ sort: 'upcoming', genres: ['drama', 'drama', 5, 'x'], year: 'range', from: 2020, to: 1995, country: 'JP', rating: 6 })).toEqual({
      sort: 'upcoming', genres: ['drama'], year: 'range', from: 1995, to: 2020, country: 'JP', rating: 6,
    });
    // range years only with «Диапазон»; out-of-range years dropped
    expect(sanitizeDiscoverQuery({ year: 'this', from: 2000 }).from).toBe(0);
    expect(sanitizeDiscoverQuery({ year: 'range', from: 1200, to: 2020.5 })).toMatchObject({ from: 0, to: 0 });
    expect(sanitizeDiscoverQuery({ rating: 5, country: 'ZZ' })).toMatchObject({ rating: 0, country: '' });
  });

  it('the key differs per sort and filter, not per genre order', () => {
    const a = discoverQueryKey(Q({ genres: ['drama', 'comedy'] }));
    expect(a).toBe(discoverQueryKey(Q({ genres: ['comedy', 'drama'] })));
    expect(a).not.toBe(discoverQueryKey(Q({ genres: ['drama', 'comedy'], sort: 'rating' })));
    expect(discoverQueryKey(Q({ rating: 7 }))).not.toBe(discoverQueryKey(Q({ rating: 8 })));
  });

  it('counts the set filters', () => {
    expect(discoverFilterCount(DEFAULT_DISCOVER_QUERY)).toBe(0);
    expect(discoverFilterCount(Q({ sort: 'rating' }))).toBe(0);
    expect(discoverFilterCount(Q({ genres: ['drama', 'war'], year: 'last', country: 'RU', rating: 6 }))).toBe(5);
  });

  it('genres per kind, each with a label in both languages', () => {
    expect(genresFor('movie')).not.toContain('talk');
    expect(genresFor('tv')).toContain('talk');
    expect(genresFor('tv')).not.toContain('horror');
    expect(genresFor('all').length).toBe(GENRES.length);
    const ruG = ru.discover.genres as { [k: string]: string };
    const enG = en.discover.genres as { [k: string]: string };
    GENRES.forEach((g) => {
      expect(ruG[g.id]).toBeTruthy();
      expect(enG[g.id]).toBeTruthy();
    });
  });
});

describe('client.discover', () => {
  let urls: string[] = [];
  const http: SourceHttp = {
    get: (url) => {
      urls.push(url);
      const kind = url.indexOf('discover/tv') >= 0 ? 'tv' : 'movie';
      const results = kind === 'tv' ? [{ id: 2, name: 'S', first_air_date: '2024-01-01' }] : [{ id: 1, title: 'M', release_date: '2026-02-01' }];
      return Promise.resolve({ status: 200, url: url, text: JSON.stringify({ results: results, total_pages: 3 }) });
    },
    post: () => Promise.reject(new Error('no')),
    clearCookies: () => Promise.resolve(),
  };

  beforeEach(() => {
    localStorage.clear();
    resetCatalogCache();
    urls = [];
  });
  afterEach(() => flushCatalogCache());

  it('«Все» merges a page of films and a page of series', async () => {
    const c = createCatalogClient(E, http, { today: () => TODAY });
    const r = await c.discover('all', DEFAULT_DISCOVER_QUERY, 1);
    expect(r.items.map((x) => x.kind + ':' + x.id + ':' + x.year)).toEqual(['movie:1:2026', 'tv:2:2024']);
    expect(r.pages).toBe(3);
    expect(urls.length).toBe(2);
  });

  it('a kind without the chosen genres asks nothing', async () => {
    const c = createCatalogClient(E, http, { today: () => TODAY });
    const r = await c.discover('all', Q({ genres: ['reality'] }), 1);
    expect(r.items.map((x) => x.kind)).toEqual(['tv']);
    expect(urls.length).toBe(1);
    expect(urls[0]).toContain('discover/tv');
  });

  it('caches per sort and filters', async () => {
    const c = createCatalogClient(E, http, { today: () => TODAY });
    await c.discover('movie', DEFAULT_DISCOVER_QUERY, 1);
    await c.discover('movie', DEFAULT_DISCOVER_QUERY, 1);
    expect(urls.length).toBe(1);
    await c.discover('movie', Q({ sort: 'rating' }), 1);
    await c.discover('movie', Q({ rating: 7 }), 1);
    expect(urls.length).toBe(3);
  });
});

describe('«Скоро в цифре» items', () => {
  const item = (id: number, digital: string | undefined, popularity: number): CatalogTitle => ({
    kind: 'movie', id: id, title: 'F' + id, original: 'F' + id, year: 0, poster: '', rating: 0, digital: digital, popularity: popularity,
  });

  it('keeps the dated films of the window (today to +60 days), soonest first, the more popular first on one day', () => {
    const out = digitalSoonItems([
      item(1, '2026-10-16', 5), item(2, '2026-10-09', 1), item(3, '', 9), item(4, undefined, 9), item(5, '2026-10-05', 9),
      item(6, '2026-12-06', 9), item(7, '2026-10-09', 4), item(8, '2026-10-06', 0), item(9, '2026-12-05', 0), item(2, '2026-10-07', 9),
    ], TODAY);
    expect(out.map((x) => x.id)).toEqual([8, 7, 2, 1, 9]);
  });

  it("a dated list keeps release_date as the digital date and popularity; its year is not the film's", () => {
    const raw = { results: [{ id: 1, title: 'Marie Antoinette', release_date: '2026-11-06', popularity: 12.5 }, { id: 2, title: 'X', release_date: 'junk' }], total_pages: 2 };
    const dated = sanitizeList(E, raw, 'movie', true).items;
    expect(dated.map((x) => [x.digital, x.popularity, x.year])).toEqual([['2026-11-06', 12.5, 0], ['', 0, 0]]);
    const plain = sanitizeList(E, raw, 'movie').items[0];
    expect(plain.year).toBe(2026);
    expect(plain.digital).toBeUndefined();
  });
});

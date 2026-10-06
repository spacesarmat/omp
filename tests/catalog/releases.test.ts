import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cardUrl, discoverUrl, releasesOf, releaseRegions, sanitizeCard, type TmdbEndpoint } from '../../src/catalog/tmdb';
import { createCatalogClient, flushCatalogCache, resetCatalogCache, CACHE_KEY } from '../../src/catalog/client';
import { DEFAULT_DISCOVER_QUERY, discoverParams, sanitizeDiscoverQuery, addDays, type DiscoverQuery } from '../../src/catalog/discoverQuery';
import { applyLanguageSetting } from '../../src/i18n';
import type { SourceHttp } from '../../src/sources/types';
import { MOVIE_CARD } from './fixtures';

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

const RELEASES = {
  results: [
    { iso_3166_1: 'US', release_dates: [
      { type: 3, release_date: '2026-09-12T00:00:00.000Z' },
      { type: 4, release_date: '2026-11-12T00:00:00.000Z' },
      { type: 5, release_date: '2026-12-20T00:00:00.000Z' },
    ] },
    { iso_3166_1: 'RU', release_dates: [
      { type: 2, release_date: '2026-10-01T00:00:00.000Z' },
      { type: 3, release_date: '2026-10-03T00:00:00.000Z' },
      { type: 3, release_date: '2026-10-02T00:00:00.000Z' },
    ] },
    { iso_3166_1: 'DE', release_dates: [{ type: 4, release_date: '2026-10-07T00:00:00.000Z' }] },
  ],
};

beforeEach(() => {
  localStorage.clear();
  applyLanguageSetting('ru');
});
afterEach(() => flushCatalogCache());

describe('film release dates', () => {
  it('the regions follow the UI language: ru → RU then US, en → US', () => {
    expect(releaseRegions('ru')).toEqual(['RU', 'US']);
    expect(releaseRegions('en')).toEqual(['US']);
  });

  it('each type from the first region that has it, the earliest date of the region; limited only without theatrical', () => {
    expect(releasesOf(RELEASES, ['RU', 'US'])).toEqual({ theatrical: '2026-10-02', digital: '2026-11-12', physical: '2026-12-20' });
    expect(releasesOf(RELEASES, ['US'])).toEqual({ theatrical: '2026-09-12', digital: '2026-11-12', physical: '2026-12-20' });
    const limited = { results: [{ iso_3166_1: 'RU', release_dates: [{ type: 2, release_date: '2026-10-01T00:00:00.000Z' }] }] };
    expect(releasesOf(limited, ['RU', 'US'])).toEqual({ theatrical: '2026-10-01' });
  });

  it('junk is dropped: bad dates, unknown types, non-objects, other regions', () => {
    expect(releasesOf(null, ['RU'])).toEqual({});
    expect(releasesOf({ results: 'x' }, ['RU'])).toEqual({});
    expect(releasesOf({ results: [null, 5, { iso_3166_1: 'RU', release_dates: [{ type: 4, release_date: 'soon' }, { type: 'x' }, null] }] }, ['RU'])).toEqual({});
    expect(releasesOf(RELEASES, ['FR'])).toEqual({});
  });

  it('a film card asks release_dates and carries `releases`; a series card does not', () => {
    expect(params(cardUrl(E, 'movie', 101)).append_to_response).toBe('credits,release_dates');
    expect(params(cardUrl(E, 'tv', 202)).append_to_response).toBe('credits');
    const film = sanitizeCard(E, { ...MOVIE_CARD, release_dates: RELEASES }, 'movie')!;
    expect(film.releases).toEqual({ theatrical: '2026-10-02', digital: '2026-11-12', physical: '2026-12-20' });
    // no release_dates at all: known to be unknown (an empty object, not a missing field)
    expect(sanitizeCard(E, MOVIE_CARD, 'movie')!.releases).toEqual({});
    applyLanguageSetting('en');
    expect(sanitizeCard(E, { ...MOVIE_CARD, release_dates: RELEASES }, 'movie')!.releases!.theatrical).toBe('2026-09-12');
  });

  it('a film card cached before `releases` existed is fetched again', async () => {
    const urls: string[] = [];
    const http: SourceHttp = {
      get: (url) => {
        urls.push(url);
        return Promise.resolve({ status: 200, url: url, text: JSON.stringify({ ...MOVIE_CARD, release_dates: RELEASES }) });
      },
      post: () => Promise.reject(new Error('no')),
      clearCookies: () => Promise.resolve(),
    };
    const fresh = await createCatalogClient(E, http).card('movie', 101);
    expect(fresh.releases!.digital).toBe('2026-11-12');
    flushCatalogCache();
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    Object.keys(stored).forEach((k) => delete stored[k].data.releases);
    localStorage.setItem(CACHE_KEY, JSON.stringify(stored));
    resetCatalogCache();
    const again = await createCatalogClient(E, http).card('movie', 101);
    expect(urls).toHaveLength(2);
    expect(again.releases!.digital).toBe('2026-11-12');
    // a current card is served from the cache
    await createCatalogClient(E, http).card('movie', 101);
    expect(urls).toHaveLength(2);
  });
});

describe('«Скоро в цифре»', () => {
  it('is a known sort that survives the sanitizer', () => {
    expect(sanitizeDiscoverQuery({ sort: 'digitalSoon' }).sort).toBe('digitalSoon');
    expect(addDays(TODAY, 60)).toBe('2026-12-05');
    expect(addDays(TODAY, -3)).toBe('2026-10-03');
  });

  it('films with a digital release in the region from today to +60 days, soonest first', () => {
    const p = params(discoverUrl(E, 'movie', Q({ sort: 'digitalSoon' }), 1, TODAY));
    expect(p.with_release_type).toBe('4');
    expect(p['release_date.gte']).toBe('2026-10-06');
    expect(p['release_date.lte']).toBe('2026-12-05');
    expect(p.sort_by).toBe('primary_release_date.asc');
    expect(p.region).toBe('RU');
    expect(p['primary_release_date.gte']).toBeUndefined();
    expect(p['vote_count.gte']).toBeUndefined();
    applyLanguageSetting('en');
    expect(params(discoverUrl(E, 'movie', Q({ sort: 'digitalSoon' }), 1, TODAY)).region).toBe('US');
  });

  it('keeps genres, country and rating; ignores the year; series give nothing', () => {
    const p = discoverParams('movie', Q({ sort: 'digitalSoon', genres: ['drama'], country: 'US', rating: 7, year: 'last' }), TODAY, 'US')!;
    expect(p.with_genres).toBe('18');
    expect(p.with_origin_country).toBe('US');
    expect(p['vote_average.gte']).toBe(7);
    expect(p['primary_release_date.lte']).toBeUndefined();
    expect(discoverParams('tv', Q({ sort: 'digitalSoon' }), TODAY)).toBeNull();
  });

  it('the client asks films only, whatever the kind chip', async () => {
    const urls: string[] = [];
    const http: SourceHttp = {
      get: (url) => {
        urls.push(url);
        return Promise.resolve({ status: 200, url: url, text: JSON.stringify({ results: [{ id: 1, title: 'A', release_date: '2026-01-01' }], total_pages: 1 }) });
      },
      post: () => Promise.reject(new Error('no')),
      clearCookies: () => Promise.resolve(),
    };
    resetCatalogCache();
    const c = createCatalogClient(E, http, { today: () => TODAY });
    const all = await c.discover('all', Q({ sort: 'digitalSoon' }), 1);
    const tv = await c.discover('tv', Q({ sort: 'digitalSoon' }), 1);
    expect(all.items.map((x) => x.kind)).toEqual(['movie']);
    expect(tv.items.map((x) => x.kind)).toEqual(['movie']);
    expect(urls.every((u) => u.indexOf('/discover/movie?') > 0)).toBe(true);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createCatalogClient, flushCatalogCache, resetCatalogCache, CACHE_KEY, DIGITAL_FILL_MIN } from '../../src/catalog/client';
import { DEFAULT_DISCOVER_QUERY, discoverFilterCount, type DiscoverQuery } from '../../src/catalog/discoverQuery';
import { applyLanguageSetting } from '../../src/i18n';
import type { TmdbEndpoint } from '../../src/catalog/tmdb';
import type { SourceHttp } from '../../src/sources/types';
import { MOVIE_CARD, TV_SEASON } from './fixtures';

const E: TmdbEndpoint = { base: 'https://api.tmdb.mirror.test/3/', key: 'K', images: 'https://img.mirror.test' };
const Q = (patch: Partial<DiscoverQuery>): DiscoverQuery => ({ ...DEFAULT_DISCOVER_QUERY, ...patch });

function http(answer: (url: string) => unknown): { http: SourceHttp; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    http: {
      get: (url) => {
        urls.push(url);
        return Promise.resolve({ status: 200, url, text: JSON.stringify(answer(url)) });
      },
      post: () => Promise.reject(new Error('no')),
      clearCookies: () => Promise.resolve(),
    },
  };
}

/** Films digitally out on 7 October + (id mod 20) days: inside the «Скоро в цифре» window of 6 October, one id one date. */
function films(from: number, n: number) {
  const day = (id: number) => 7 + (id % 20);
  return {
    results: Array.from({ length: n }, (_, i) => ({ id: from + i, title: 'F' + (from + i), release_date: '2026-10-' + (day(from + i) < 10 ? '0' : '') + day(from + i) })),
    total_pages: 1,
  };
}

beforeEach(() => {
  localStorage.clear();
  resetCatalogCache();
  applyLanguageSetting('ru');
});
afterEach(() => flushCatalogCache());

describe('cache pressure', () => {
  it('a card asked with store: false stays out of the shared cache', async () => {
    const f = http(() => MOVIE_CARD);
    const c = createCatalogClient(E, f.http);
    await c.card('movie', 101, { store: false });
    await c.card('movie', 101, { store: false });
    expect(f.urls).toHaveLength(2);
    flushCatalogCache();
    expect(Object.keys(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'))).toHaveLength(0);
  });

  it('force fetches again even when cached', async () => {
    const f = http((u) => (u.indexOf('/season/') > 0 ? TV_SEASON : MOVIE_CARD));
    const c = createCatalogClient(E, f.http);
    await c.card('movie', 101);
    await c.card('movie', 101);
    await c.card('movie', 101, { force: true });
    await c.season(202, 2);
    await c.season(202, 2, { force: true });
    expect(f.urls).toHaveLength(4);
  });

  it('a season is stored without the episode overviews; the title card (full) fetches it again after a restart', async () => {
    const f = http(() => TV_SEASON);
    const c = createCatalogClient(E, f.http);
    const s = await c.season(202, 2, { full: true });
    expect(s.episodes.some((e) => !!e.overview)).toBe(true);
    flushCatalogCache();
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    const entry = stored[Object.keys(stored)[0]].data;
    expect(entry.lite).toBe(true);
    expect(entry.episodes.every((e: { overview: string }) => e.overview === '')).toBe(true);
    expect(entry.episodes.map((e: { title: string }) => e.title)).toEqual(s.episodes.map((e) => e.title));
    resetCatalogCache();
    const d = createCatalogClient(E, f.http);
    const lite = await d.season(202, 2);
    expect(lite.episodes[0].airDate).toBe(s.episodes[0].airDate);
    expect(f.urls).toHaveLength(1);
    await d.season(202, 2, { full: true });
    expect(f.urls).toHaveLength(2);
  });
});

describe('«Скоро в цифре» regions', () => {
  it('a thin Russian page is filled from the US, without repeats', async () => {
    const f = http((u) => (u.indexOf('region=RU') > 0 ? films(1, 3) : films(2, 5)));
    const c = createCatalogClient(E, f.http, { today: () => '2026-10-06' });
    const r = await c.discover('all', Q({ sort: 'digitalSoon' }), 1);
    expect(f.urls.map((u) => /region=(\w+)/.exec(u)![1])).toEqual(['RU', 'US']);
    expect(r.items.map((x) => x.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('the merged page is ordered by the digital date, ties by popularity; undated or out-of-window films are dropped', async () => {
    const ru = { results: [
      { id: 1, title: 'Tenzing', release_date: '2026-10-16', popularity: 5 },
      { id: 2, title: 'Under Wraps', release_date: '2026-10-09', popularity: 1 },
      { id: 3, title: 'Hurricane of Fun', release_date: '', popularity: 9 },
      { id: 4, title: 'Old', release_date: '2026-10-01', popularity: 9 },
      { id: 5, title: 'Far', release_date: '2026-12-06', popularity: 9 },
    ], total_pages: 2 };
    const us = { results: [
      { id: 6, title: 'Radical Monarchs', release_date: '2026-10-13', popularity: 3 },
      { id: 2, title: 'Under Wraps', release_date: '2026-10-02', popularity: 1 },
      { id: 7, title: 'Norjack', release_date: '2026-10-09', popularity: 4 },
      { id: 8, title: 'Edge', release_date: '2026-12-05', popularity: 0 },
    ], total_pages: 3 };
    const f = http((u) => (u.indexOf('region=RU') > 0 ? ru : us));
    const r = await createCatalogClient(E, f.http, { today: () => '2026-10-06' }).discover('all', Q({ sort: 'digitalSoon' }), 1);
    expect(r.items.map((x) => x.id + ':' + x.digital)).toEqual(['7:2026-10-09', '2:2026-10-09', '6:2026-10-13', '1:2026-10-16', '8:2026-12-05']);
    // the list's release_date is the digital one, not the film's year
    expect(r.items.every((x) => x.year === 0)).toBe(true);
    expect(r.pages).toBe(3);
  });

  it('a Russian page thin after dropping the undated films is filled from the US', async () => {
    const ru = { results: Array.from({ length: DIGITAL_FILL_MIN }, (_, i) => ({ id: i + 1, title: 'F', release_date: i ? '' : '2026-10-10' })), total_pages: 1 };
    const f = http((u) => (u.indexOf('region=RU') > 0 ? ru : films(100, 2)));
    const r = await createCatalogClient(E, f.http, { today: () => '2026-10-06' }).discover('movie', Q({ sort: 'digitalSoon' }), 1);
    expect(f.urls).toHaveLength(2);
    expect(r.items.map((x) => x.id)).toEqual([100, 101, 1]);
  });

  it('a full Russian page is kept as is; the English UI asks the US only', async () => {
    const f = http(() => films(1, DIGITAL_FILL_MIN));
    const c = createCatalogClient(E, f.http, { today: () => '2026-10-06' });
    await c.discover('movie', Q({ sort: 'digitalSoon' }), 1);
    expect(f.urls).toHaveLength(1);
    applyLanguageSetting('en');
    const g = http(() => films(1, 2));
    await createCatalogClient(E, g.http, { today: () => '2026-10-06' }).discover('movie', Q({ sort: 'digitalSoon' }), 1);
    expect(g.urls.map((u) => /region=(\w+)/.exec(u)![1])).toEqual(['US']);
  });

  it('the year filter does not count for «Скоро в цифре»', () => {
    expect(discoverFilterCount(Q({ year: 'this' }))).toBe(1);
    expect(discoverFilterCount(Q({ sort: 'digitalSoon', year: 'this' }))).toBe(0);
    expect(discoverFilterCount(Q({ sort: 'digitalSoon', year: 'this', rating: 7 }))).toBe(1);
  });
});

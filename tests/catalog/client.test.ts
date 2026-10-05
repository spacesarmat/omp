import { describe, it, expect, beforeEach } from 'vitest';
import { createCatalogClient, catalogErrorCode, CACHE_KEY } from '../../src/catalog/client';
import { applyLanguageSetting } from '../../src/i18n';
import type { TmdbEndpoint } from '../../src/catalog/tmdb';
import type { SourceHttp } from '../../src/sources/types';
import { MOVIE_LIST, TV_LIST, MOVIE_CARD } from './fixtures';

const E: TmdbEndpoint = { base: 'https://api.tmdb.mirror.test/3/', key: 'SECRETKEY', images: 'https://img.mirror.test' };

type Answer = { status: number; text: string } | 'reject';
interface Fake { http: SourceHttp; urls: string[]; answer: (url: string) => Answer; }
function fake(): Fake {
  const f: Fake = {
    urls: [],
    answer: (url) => {
      if (url.indexOf('discover/movie') >= 0) return { status: 200, text: JSON.stringify(MOVIE_LIST) };
      if (url.indexOf('tv/on_the_air') >= 0) return { status: 200, text: JSON.stringify(TV_LIST) };
      if (url.indexOf('movie/101') >= 0) return { status: 200, text: JSON.stringify(MOVIE_CARD) };
      return { status: 200, text: JSON.stringify({ results: [], total_pages: 1 }) };
    },
    http: {
      get: (url) => {
        f.urls.push(url);
        const a = f.answer(url);
        return a === 'reject' ? Promise.reject(new Error('net')) : Promise.resolve({ status: a.status, url: url, text: a.text });
      },
      post: () => Promise.reject(new Error('no')),
      clearCookies: () => Promise.resolve(),
    },
  };
  return f;
}

function failure(p: Promise<unknown>): Promise<Error> {
  return p.then(() => { throw new Error('expected rejection'); }, (e) => e as Error);
}

beforeEach(() => { localStorage.clear(); applyLanguageSetting('ru'); });

describe('catalog client', () => {
  it('interleaves movies and series for all', async () => {
    const f = fake();
    const c = createCatalogClient(E, f.http, { today: () => '2026-10-05' });
    const r = await c.novelties('all', 1);
    expect(r.items.map((i) => i.kind)).toEqual(['movie', 'tv']);
    expect(r.pages).toBe(3);
    expect(f.urls.length).toBe(2);
  });

  it('serves lists from the cache for 15 minutes, then refetches', async () => {
    const f = fake();
    let now = 1000;
    const c = createCatalogClient(E, f.http, { now: () => now, today: () => '2026-10-05' });
    await c.novelties('movie', 1);
    now += 14 * 60 * 1000;
    await c.novelties('movie', 1);
    expect(f.urls.length).toBe(1);
    now += 2 * 60 * 1000;
    await c.novelties('movie', 1);
    expect(f.urls.length).toBe(2);
  });

  it('caches cards for 24 hours', async () => {
    const f = fake();
    let now = 1000;
    const c = createCatalogClient(E, f.http, { now: () => now });
    const card = await c.card('movie', 101);
    expect(card.id).toBe(101);
    now += 23 * 60 * 60 * 1000;
    await c.card('movie', 101);
    expect(f.urls.length).toBe(1);
    now += 2 * 60 * 60 * 1000;
    await c.card('movie', 101);
    expect(f.urls.length).toBe(2);
  });

  it('does not mix languages in the cache', async () => {
    const f = fake();
    const c = createCatalogClient(E, f.http, { today: () => '2026-10-05' });
    await c.novelties('movie', 1);
    applyLanguageSetting('en');
    await c.novelties('movie', 1);
    expect(f.urls.length).toBe(2);
    expect(f.urls[0]).toContain('language=ru-RU');
    expect(f.urls[1]).toContain('language=en-US');
  });

  it('persists the cache without the key', async () => {
    const f = fake();
    const c = createCatalogClient(E, f.http, { today: () => '2026-10-05' });
    await c.novelties('movie', 1);
    const raw = localStorage.getItem(CACHE_KEY) || '';
    expect(raw.length).toBeGreaterThan(2);
    expect(raw.indexOf('SECRETKEY')).toBe(-1);
    expect(raw.indexOf('api_key')).toBe(-1);
  });

  it('caches the sanitized shape, not the raw answer', async () => {
    const f = fake();
    const c = createCatalogClient(E, f.http, { today: () => '2026-10-05' });
    await c.novelties('movie', 1);
    await c.card('movie', 101);
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    const keys = Object.keys(stored);
    expect(keys.length).toBe(2);
    const list = stored[keys.filter((k) => k.indexOf('discover') >= 0)[0]].data;
    expect(list.items[0].poster).toBe('https://img.mirror.test/t/p/w300/nw.jpg');
    expect(list.items[0].vote_count).toBeUndefined();
    expect(list.results).toBeUndefined();
    const card = stored[keys.filter((k) => k.indexOf('movie/101') >= 0)[0]].data;
    expect(card.genres).toEqual(['драма']);
    expect(card.credits).toBeUndefined();
  });

  it('maps failures to error codes', async () => {
    const f = fake();
    expect(catalogErrorCode(await failure(createCatalogClient(null, f.http).search('x', 1)))).toBe('nokey');
    const cases: Array<[Answer, string]> = [
      ['reject', 'offline'],
      [{ status: 0, text: '' }, 'offline'],
      [{ status: 401, text: '{}' }, 'nokey'],
      [{ status: 403, text: '{}' }, 'blocked'],
      [{ status: 451, text: '' }, 'blocked'],
      [{ status: 200, text: '<html>wall</html>' }, 'blocked'],
      [{ status: 500, text: '{}' }, 'bad'],
    ];
    for (let i = 0; i < cases.length; i++) {
      const g = fake();
      g.answer = () => cases[i][0];
      const e = await failure(createCatalogClient(E, g.http).search('x', 1));
      expect(catalogErrorCode(e)).toBe(cases[i][1]);
      expect(e.message.indexOf('api_key')).toBe(-1);
      expect(e.message.indexOf('SECRETKEY')).toBe(-1);
    }
    expect(catalogErrorCode(new Error('plain'))).toBe('bad');
    expect(catalogErrorCode(null)).toBe('bad');
  });

  it('keeps at most 200 entries', async () => {
    const f = fake();
    let now = 1;
    const c = createCatalogClient(E, f.http, { now: () => now });
    for (let i = 0; i < 230; i++) { now += 1; await c.search('q' + i, 1); }
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    expect(Object.keys(stored).length).toBe(200);
  });
});

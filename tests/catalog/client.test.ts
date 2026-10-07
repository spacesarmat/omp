import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCatalogClient, catalogErrorCode, flushCatalogCache, resetCatalogCache, localDate, CACHE_KEY, CACHE_BUDGET_CHARS } from '../../src/catalog/client';
import { applyLanguageSetting } from '../../src/i18n';
import type { TmdbEndpoint } from '../../src/catalog/tmdb';
import type { SourceHttp } from '../../src/sources/types';
import { MOVIE_LIST, TV_LIST, MOVIE_CARD, TV_CARD, TV_SEASON } from './fixtures';

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
      if (url.indexOf('tv/202/season/') >= 0) return { status: 200, text: JSON.stringify(TV_SEASON) };
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
afterEach(() => { flushCatalogCache(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('catalog client', () => {
  it('a series card cached before the status fields is fetched again, so the status shows at once', async () => {
    const f = fake();
    f.answer = (url) => (url.indexOf('tv/202') >= 0 ? { status: 200, text: JSON.stringify({ ...TV_CARD, status: 'Returning Series' }) } : { status: 404, text: '{}' });
    const fresh = await createCatalogClient(E, f.http).card('tv', 202);
    expect(fresh.status).toBe('returning');
    expect(fresh.nextEpisode).toEqual({ season: 2, episode: 7, airDate: '2026-10-12' });
    flushCatalogCache();
    // the stored card as an older OMP wrote it
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    Object.keys(stored).forEach((k) => {
      const d = stored[k].data;
      delete d.status;
      delete d.nextEpisode;
      delete d.lastAirDate;
      d.seasons.forEach((s: { airDate?: string }) => delete s.airDate);
    });
    localStorage.setItem(CACHE_KEY, JSON.stringify(stored));
    resetCatalogCache();
    const old = await createCatalogClient(E, f.http).card('tv', 202);
    expect(f.urls).toHaveLength(2);
    expect(old.title).toBe(fresh.title);
    expect(old.status).toBe('returning');
    expect(old.nextEpisode).toEqual({ season: 2, episode: 7, airDate: '2026-10-12' });
  });

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

  it('person(): asks combined_credits and caches for 24 hours', async () => {
    const f = fake();
    const base = f.answer;
    f.answer = (url) => (url.indexOf('person/5') >= 0 ? { status: 200, text: JSON.stringify({ id: 5, name: 'N', biography: 'Bio', combined_credits: { cast: [], crew: [] } }) } : base(url));
    let now = 1000;
    const c = createCatalogClient(E, f.http, { now: () => now });
    const p = await c.person(5);
    expect(p.name).toBe('N');
    expect(f.urls[0]).toContain('/person/5?');
    expect(f.urls[0]).toContain('append_to_response=combined_credits');
    now += 23 * 60 * 60 * 1000;
    await c.person(5);
    expect(f.urls.length).toBe(1);
    now += 2 * 60 * 60 * 1000;
    await c.person(5);
    expect(f.urls.length).toBe(2);
  });

  describe('person(): biography', () => {
    const person = (bio: string) => ({ status: 200, text: JSON.stringify({ id: 5, name: 'N', biography: bio, combined_credits: { cast: [], crew: [] } }) });
    it('ru with an empty biography asks the English one and takes it, both cached', async () => {
      const f = fake();
      f.answer = (url) => person(url.indexOf('language=en-US') >= 0 ? ' English bio ' : '');
      let now = 1000;
      const c = createCatalogClient(E, f.http, { now: () => now });
      expect((await c.person(5)).bio).toBe('English bio');
      expect(f.urls).toHaveLength(2);
      expect(f.urls[0]).toContain('language=ru-RU');
      expect(f.urls[1]).toContain('language=en-US');
      expect(f.urls[1]).not.toContain('append_to_response');
      now += 60 * 1000;
      expect((await c.person(5)).bio).toBe('English bio');
      expect(f.urls).toHaveLength(2);
    });
    it('ru with a biography makes no second request', async () => {
      const f = fake();
      f.answer = () => person('Русская биография');
      const p = await createCatalogClient(E, f.http).person(5);
      expect(p.bio).toBe('Русская биография');
      expect(f.urls).toHaveLength(1);
    });
    it('a failing English fallback keeps an empty biography', async () => {
      const f = fake();
      f.answer = (url) => (url.indexOf('language=en-US') >= 0 ? 'reject' : person(''));
      const p = await createCatalogClient(E, f.http).person(5);
      expect(p.bio).toBe('');
      expect(p.name).toBe('N');
    });
    it('the English UI with an empty biography makes no second request', async () => {
      applyLanguageSetting('en');
      const f = fake();
      f.answer = () => person('');
      expect((await createCatalogClient(E, f.http).person(5)).bio).toBe('');
      expect(f.urls).toHaveLength(1);
    });
  });

  it('caches seasons for 24 hours, per season and language, sanitized only', async () => {
    const f = fake();
    let now = 1000;
    const c = createCatalogClient(E, f.http, { now: () => now });
    const s = await c.season(202, 2);
    expect(s.episodes.map((e) => e.n)).toEqual([1, 2, 3]);
    expect(f.urls[0]).toContain('/3/tv/202/season/2?');
    now += 23 * 60 * 60 * 1000;
    await c.season(202, 2);
    expect(f.urls.length).toBe(1);
    await c.season(202, 1);
    expect(f.urls.length).toBe(2);
    applyLanguageSetting('en');
    await c.season(202, 2);
    expect(f.urls.length).toBe(3);
    applyLanguageSetting('ru');
    now += 2 * 60 * 60 * 1000;
    await c.season(202, 2);
    expect(f.urls.length).toBe(4);
    flushCatalogCache();
    const raw = localStorage.getItem(CACHE_KEY) || '';
    expect(raw.indexOf('still_path')).toBe(-1);
    expect(raw.indexOf('SECRETKEY')).toBe(-1);
  });

  it('a season error maps to a code; no key rejects', async () => {
    const f = fake();
    f.answer = () => ({ status: 404, text: '{"success":false}' });
    expect(catalogErrorCode(await failure(createCatalogClient(E, f.http).season(202, 9)))).toBe('bad');
    const g = fake();
    g.answer = () => ({ status: 200, text: '[]' });
    expect(catalogErrorCode(await failure(createCatalogClient(E, g.http).season(202, 9)))).toBe('bad');
    expect(catalogErrorCode(await failure(createCatalogClient(null, g.http).season(202, 1)))).toBe('nokey');
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
    flushCatalogCache();
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
    flushCatalogCache();
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
    flushCatalogCache();
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    expect(Object.keys(stored).length).toBe(200);
  });
  it('writes the cache once per burst of requests (debounced)', async () => {
    vi.useFakeTimers();
    const set = vi.spyOn(Storage.prototype, 'setItem');
    const f = fake();
    const c = createCatalogClient(E, f.http);
    for (let i = 0; i < 5; i++) await c.search('q' + i, 1);
    expect(set.mock.calls.filter((a) => a[0] === CACHE_KEY)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(set.mock.calls.filter((a) => a[0] === CACHE_KEY)).toHaveLength(1);
    expect(Object.keys(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'))).toHaveLength(5);
  });

  it('keeps the stored JSON within the budget, leaving out the least recently used', async () => {
    const big = 'я'.repeat(Math.floor(CACHE_BUDGET_CHARS / 10));
    const f = fake();
    f.answer = () => ({ status: 200, text: JSON.stringify({ results: [{ media_type: 'movie', id: 1, title: big, poster_path: '/p.jpg', release_date: '2026-01-01' }], total_pages: 1 }) });
    let now = 1000;
    const c = createCatalogClient(E, f.http, { now: () => now });
    for (let i = 0; i < 4; i++) { now += 10; await c.search('q' + i, 1); }
    // q0 is used again: q1 is now the least recently used
    now += 10;
    await c.search('q0', 1);
    expect(f.urls).toHaveLength(4);
    now += 10;
    await c.search('q4', 1);
    flushCatalogCache();
    const raw = localStorage.getItem(CACHE_KEY) || '';
    expect(raw.length).toBeLessThanOrEqual(CACHE_BUDGET_CHARS);
    const keys = Object.keys(JSON.parse(raw)).map((k) => (k.match(/query=([^&]+)/) || [])[1]);
    expect(keys).toContain('q0');
    expect(keys).toContain('q4');
    expect(keys).not.toContain('q1');
    // memory is not capped by the storage budget: q1 is still served this session
    now += 10;
    await c.search('q1', 1);
    expect(f.urls).toHaveLength(5);
    // used again, it is stored again (another one is left out) and a restart serves it from storage
    resetCatalogCache();
    expect((localStorage.getItem(CACHE_KEY) || '').length).toBeLessThanOrEqual(CACHE_BUDGET_CHARS);
    const d = createCatalogClient(E, f.http, { now: () => now });
    await d.search('q1', 1);
    await d.search('q0', 1);
    expect(f.urls).toHaveLength(5);
  });

  it('a failed save (quota) drops the stored cache and keeps working from memory', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ old: { at: 1, data: {} } }));
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === CACHE_KEY) throw new Error('QuotaExceededError');
      real.call(this, k, v);
    });
    const f = fake();
    const c = createCatalogClient(E, f.http, { today: () => '2026-10-05' });
    await c.novelties('movie', 1);
    flushCatalogCache();
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    const again = await c.novelties('movie', 1);
    expect(again.items.length).toBeGreaterThan(0);
    expect(f.urls).toHaveLength(1);
    // this client does not try to save again
    await c.search('x', 1);
    flushCatalogCache();
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });

  it('the stored cache keeps the language in the key: a new client serves each language its own answer', async () => {
    const f = fake();
    const c = createCatalogClient(E, f.http, { today: () => '2026-10-05' });
    await c.novelties('movie', 1);
    applyLanguageSetting('en');
    await c.novelties('movie', 1);
    flushCatalogCache();
    const keys = Object.keys(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'));
    expect(keys.filter((k) => k.indexOf('language=ru-RU') >= 0)).toHaveLength(1);
    expect(keys.filter((k) => k.indexOf('language=en-US') >= 0)).toHaveLength(1);
    const g = fake();
    const d = createCatalogClient(E, g.http, { today: () => '2026-10-05' });
    await d.novelties('movie', 1);
    applyLanguageSetting('ru');
    await d.novelties('movie', 1);
    expect(g.urls).toHaveLength(0);
  });
  it('novelties use the local date, not the UTC one', async () => {
    // 00:30 local time: in any zone east of UTC the UTC date is still the day before
    const at = new Date(2026, 9, 6, 0, 30).getTime();
    expect(localDate(at)).toBe('2026-10-06');
    expect(localDate(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
    const f = fake();
    await createCatalogClient(E, f.http, { now: () => at }).novelties('movie', 1);
    expect(f.urls[0]).toContain('2026-10-06');
  });
  it('two clients one after another share the cache: both entries survive the save', async () => {
    vi.useFakeTimers();
    const f = fake();
    const a = createCatalogClient(E, f.http, { today: () => '2026-10-05' });
    await a.novelties('movie', 1);
    const b = createCatalogClient(E, f.http, { today: () => '2026-10-05' });
    await b.card('movie', 101);
    // the old client's answer is served by the new one
    await b.novelties('movie', 1);
    expect(f.urls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5000);
    const keys = Object.keys(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'));
    expect(keys.filter((k) => k.indexOf('discover') >= 0)).toHaveLength(1);
    expect(keys.filter((k) => k.indexOf('movie/101') >= 0)).toHaveLength(1);
  });

  it('a hidden page or pagehide writes the pending save at once', async () => {
    vi.useFakeTimers();
    const f = fake();
    const c = createCatalogClient(E, f.http, { today: () => '2026-10-05' });
    await c.novelties('movie', 1);
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(Object.keys(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'))).toHaveLength(1);
    vis.mockReturnValue('visible');
    await c.card('movie', 101);
    window.dispatchEvent(new Event('pagehide'));
    expect(Object.keys(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'))).toHaveLength(2);
  });
});

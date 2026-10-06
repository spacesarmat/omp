// 0.17.0-beta.6 review fixes: the «Обзор» tile-card queue, the saved series matches, subscription matching, the
// calendar's pull to refresh and the year filter of «Скоро в цифре».
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { cachedTileCard, cancelTileCards, leaveTileCard, requestTileCard, resetTileCards } from '../src/catalog/tileCards';
import { setCatalogClientForTests } from '../src/catalog/phoneCatalog';
import { knownOver, matchSeries, resetSeriesMatches } from '../../src/lib/seriesMatch';
import { loadCalendar, pickSubShow, resetCalendar, subQueryName } from '../src/lib/calendar';
import { singleGroup } from '../../src/lib/seriesGroups';
import { DiscoverFiltersSheet } from '../src/screens/catalog/DiscoverSheets';
import { DEFAULT_DISCOVER_QUERY } from '../../src/catalog/discoverQuery';
import type { CatalogClient } from '../../src/catalog/client';
import type { CatalogCard, CatalogTitle } from '../../src/catalog/tmdb';
import type { Torrent } from '../../src/api/types';
import type { Subscription } from '../../src/monitor/types';

const NOW = new Date(2026, 9, 6, 12).getTime();

function card(id: number, patch?: Partial<CatalogCard>): CatalogCard {
  return {
    kind: 'tv', id, title: 'Show ' + id, original: 'Show ' + id, year: 2024, poster: '', rating: 0, backdrop: 'b', genres: ['g'],
    runtime: 0, overview: 'long overview', cast: [{ name: 'A', photo: '', role: '' }], seasons: [], airing: true, status: 'returning',
    nextEpisode: { season: 1, episode: 2, airDate: '2026-10-08' }, lastAirDate: '', ...patch,
  };
}
const title = (c: CatalogCard): CatalogTitle => ({ kind: c.kind, id: c.id, title: c.title, original: c.original, year: c.year, poster: '', rating: 0 });

function fake(over?: Partial<CatalogClient>) {
  const c = {
    novelties: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    discover: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    search: vi.fn((_q: string) => Promise.resolve({ items: [] as CatalogTitle[], pages: 0 })),
    card: vi.fn((_k: string, id: number) => Promise.resolve(card(id))),
    season: vi.fn(() => Promise.reject(new Error('catalog:bad'))),
    ...over,
  };
  setCatalogClientForTests(c as unknown as CatalogClient);
  return c as unknown as { [k: string]: ReturnType<typeof vi.fn> };
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  localStorage.clear();
  resetTileCards();
  resetSeriesMatches();
  resetCalendar();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  setCatalogClientForTests(null);
  vi.useRealTimers();
});

describe('«Обзор» tile-card queue', () => {
  it('the latest tile in view goes first; tiles that left the view are dropped; cards stay out of the shared cache', async () => {
    const waiting: (() => void)[] = [];
    const c = fake({ card: vi.fn((_k: string, id: number) => new Promise<CatalogCard>((res) => waiting.push(() => res(card(id))))) as never });
    [1, 2, 3, 4, 5, 6].forEach((id) => requestTileCard('tv', id));
    await flush();
    // two run at once; 3..6 wait
    expect(c.card.mock.calls.map((x) => x[1])).toEqual([1, 2]);
    expect(c.card.mock.calls[0][2]).toEqual({ store: false });
    leaveTileCard('tv', 5);
    await act(async () => waiting.splice(0).forEach((f) => f()));
    await flush();
    // the latest in view first (6, then 4: 5 left the view)
    expect(c.card.mock.calls.map((x) => x[1])).toEqual([1, 2, 6, 4]);
    await act(async () => waiting.splice(0).forEach((f) => f()));
    await flush();
    expect(c.card.mock.calls.map((x) => x[1])).toEqual([1, 2, 6, 4, 3]);
    await act(async () => waiting.splice(0).forEach((f) => f()));
    await flush();
    // a slim projection is kept: no overview or cast
    expect(cachedTileCard('tv', 5)).toBeUndefined();
    const kept = cachedTileCard('tv', 6)!;
    expect(kept.nextEpisode).toEqual({ season: 1, episode: 2, airDate: '2026-10-08' });
    expect(kept.overview).toBe('');
    expect(kept.cast).toEqual([]);
  });

  it('leaving «Обзор» clears the queue', async () => {
    const waiting: (() => void)[] = [];
    const c = fake({ card: vi.fn((_k: string, id: number) => new Promise<CatalogCard>((res) => waiting.push(() => res(card(id))))) as never });
    [1, 2, 3, 4].forEach((id) => requestTileCard('movie', id));
    await flush();
    cancelTileCards();
    await act(async () => waiting.splice(0).forEach((f) => f()));
    await flush();
    expect(c.card).toHaveBeenCalledTimes(2);
  });
});

const TOR: Torrent = { hash: 'h1', title: 'Ледяной перевал / Frost Pass (2024) S02 1080p', category: 'tv', data: '' } as Torrent;

describe('saved series matches', () => {
  it('a match outlives the page: the next start asks the card by id, no search', async () => {
    const show = card(21, { title: 'Ледяной перевал', original: 'Frost Pass' });
    const c = fake({
      search: vi.fn(() => Promise.resolve({ items: [title(show)], pages: 1 })),
      card: vi.fn(() => Promise.resolve(show)) as never,
    });
    const g = singleGroup(TOR)!;
    expect((await matchSeries(g))!.id).toBe(21);
    const searches = c.search.mock.calls.length;
    expect(searches).toBeGreaterThan(0);
    resetSeriesMatches();
    expect((await matchSeries(g))!.id).toBe(21);
    expect(c.search.mock.calls.length).toBe(searches);
    expect(c.card).toHaveBeenCalledTimes(2);
  });

  it('a show known to be over is skipped by the calendar for a week', async () => {
    const over = card(21, { title: 'Ледяной перевал', original: 'Frost Pass', status: 'ended', nextEpisode: null });
    const c = fake({
      search: vi.fn(() => Promise.resolve({ items: [title(over)], pages: 1 })),
      card: vi.fn(() => Promise.resolve(over)) as never,
    });
    await matchSeries(singleGroup(TOR)!);
    expect(knownOver(singleGroup(TOR)!.key)).toBe(true);
    resetSeriesMatches();
    c.search.mockClear();
    c.card.mockClear();
    await loadCalendar([TOR], [], false, NOW);
    expect(c.search).not.toHaveBeenCalled();
    expect(c.card).not.toHaveBeenCalled();
    vi.setSystemTime(NOW + 8 * 24 * 60 * 60 * 1000);
    expect(knownOver(singleGroup(TOR)!.key)).toBe(false);
  });
});

describe('subscription → show', () => {
  const marvel: CatalogTitle = { kind: 'tv', id: 1, title: 'Агенты «Щ.И.Т.»', original: "Marvel's Agents of S.H.I.E.L.D.", year: 2013, poster: '', rating: 0 };
  const wick: CatalogTitle = { kind: 'tv', id: 2, title: 'Континенталь', original: 'The Continental: From the World of John Wick', year: 2023, poster: '', rating: 0 };
  const f1: CatalogTitle = { kind: 'tv', id: 3, title: 'Formula 1: Drive to Survive', original: 'Formula 1: Drive to Survive', year: 2019, poster: '', rating: 0 };
  const harbor: CatalogTitle = { kind: 'tv', id: 4, title: 'Тихая гавань', original: 'Quiet Harbor', year: 2026, poster: '', rating: 0 };

  it('a film-like query (a year without a season) is no show: «Formula 1 2024»', () => {
    expect(subQueryName('Formula 1 2024')).toBe('');
    expect(subQueryName('Дюна 2021')).toBe('');
    expect(subQueryName('Тихая гавань')).toBe('Тихая гавань');
    expect(subQueryName('Тихая гавань 2026 S01')).not.toBe('');
  });

  it('the show must carry the query name: «Marvel», an actor and «Formula 1» find nothing', () => {
    expect(pickSubShow([marvel], subQueryName('Marvel'))).toBeNull();
    expect(pickSubShow([wick], subQueryName('Киану Ривз'))).toBeNull();
    expect(pickSubShow([f1], subQueryName('Formula 1'))).toBeNull();
    expect(pickSubShow([wick, harbor], subQueryName('Тихая гавань'))).toBe(harbor);
    expect(pickSubShow([wick, harbor], subQueryName('Quiet Harbor'))).toBe(harbor);
  });

  it('a generic subscription attaches nothing to the calendar', async () => {
    const c = fake({ search: vi.fn(() => Promise.resolve({ items: [marvel, f1], pages: 1 })) });
    const subs: Subscription[] = ['Marvel', 'Formula 1 2024', 'Киану Ривз'].map((q, i) => ({ id: 's' + i, query: q, quality: '', sources: null, notify: true, createdAt: 1 }));
    await loadCalendar([], subs, false, NOW);
    expect(c.card).not.toHaveBeenCalled();
    // «Formula 1 2024» is not even searched
    expect(c.search.mock.calls.map((x) => x[0])).toEqual(['Marvel', 'Киану Ривз']);
  });
});

describe('calendar pull to refresh', () => {
  it('fresh: the cards and seasons of the followed shows are fetched again past the cache', async () => {
    const show = card(21, { title: 'Ледяной перевал', original: 'Frost Pass', seasons: [{ number: 1, episodes: 8, year: 2026, aired: 1, airDate: '2026-10-01' }] });
    const c = fake({
      search: vi.fn(() => Promise.resolve({ items: [title(show)], pages: 1 })),
      card: vi.fn(() => Promise.resolve(show)) as never,
      season: vi.fn(() => Promise.resolve({ number: 1, name: '', airDate: '', overview: '', episodes: [{ n: 2, title: 'E2', airDate: '2026-10-08', runtime: 0, overview: '' }] })) as never,
    });
    await loadCalendar([TOR], [], false, NOW);
    expect(c.card.mock.calls.every((x) => x[2] === undefined)).toBe(true);
    c.card.mockClear();
    c.season.mockClear();
    await loadCalendar([TOR], [], true, NOW);
    expect(c.card.mock.calls.map((x) => x[2])).toEqual([{ force: true }]);
    expect(c.season.mock.calls.map((x) => x[2])).toEqual([{ force: true }]);
  });
});

describe('«Скоро в цифре» filters', () => {
  it('the year filter is not offered', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const el = document.getElementById('app')!;
    act(() => render(<DiscoverFiltersSheet key="a" value={{ ...DEFAULT_DISCOVER_QUERY, sort: 'digitalSoon' }} kind="all" onClose={() => undefined} />, el));
    expect(document.querySelector('[data-group="year"]')).toBeNull();
    expect(document.querySelector('[data-group="genre"]')).not.toBeNull();
    act(() => render(<DiscoverFiltersSheet key="b" value={DEFAULT_DISCOVER_QUERY} kind="all" onClose={() => undefined} />, el));
    expect(document.querySelector('[data-group="year"]')).not.toBeNull();
    act(() => render(null, el));
  });
});

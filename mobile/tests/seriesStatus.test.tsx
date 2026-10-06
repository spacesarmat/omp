import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Library } from '../src/screens/Library';
import { Series } from '../src/screens/Series';
import { TitleCard } from '../src/screens/catalog/TitleCard';
import { seriesPill, tileBadge, upcomingSeasons, airDateText } from '../../src/lib/seriesStatus';
import { setCatalogClientForTests } from '../src/catalog/phoneCatalog';
import { matchSeries, resetSeriesMatches, cachedSeriesMatch } from '../../src/lib/seriesMatch';
import { groupLibrary, type SeriesGroup } from '../../src/lib/seriesGroups';
import { navigate, resetTo } from '../src/nav';
import { toast } from '../src/ui/toast';
import { reloadTvs } from '../src/tv/tvStore';
import { updateSettings } from '../../src/store/settings';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { torrents, libraryTab, libraryQuery, librarySearchOpen } from '../../src/store/library';
import { reloadProgress, serverViewed } from '../../src/store/progress';
import { applyLanguageSetting } from '../../src/i18n';
import { addSubscription, loadSubs } from '../../src/monitor/subs';
import { TorrServerClient } from '../../src/api/torrserver';
import { torrentQuery, type CatalogCard, type CatalogTitle, type Season } from '../../src/catalog/tmdb';
import type { CatalogClient } from '../../src/catalog/client';
import type { Torrent } from '../../src/api/types';

// «today» is 6 October 2026, noon local time
const NOW = new Date(2026, 9, 6, 12).getTime();

function files(names: string[]) {
  return JSON.stringify({ TorrServer: { Files: names.map((p, i) => ({ id: i + 1, path: p, length: 1000 })) } });
}

const GB = 1024 ** 3;
const S1: Torrent = { hash: 's1', title: 'Темная материя / Dark Matter (2024) [S01] 1080p WEB-DL', category: 'tv', stat: 3, torrent_size: 4 * GB, timestamp: 1, data: files(['S01E01.mkv', 'S01E02.mkv']) };
const S2: Torrent = { hash: 's2', title: 'Тёмная материя / Dark Matter (2025) [S02] 2160p WEB-DL', category: 'tv', stat: 3, torrent_size: 6 * GB, timestamp: 4, data: files(['S02E01.mkv', 'S02E02.mkv']) };
const STAR: Torrent = { hash: 'st', title: 'Starbound Frontier S02 1080p WEB-DL', category: 'tv', stat: 3, torrent_size: 2 * GB, timestamp: 3, data: files(['S02E01.mkv', 'S02E02.mkv']) };
const FILM: Torrent = { hash: 'm1', title: 'Quiet Signal 2160p', category: 'movie', stat: 3, torrent_size: GB, timestamp: 2 };

const SHOW: CatalogCard = {
  kind: 'tv', id: 22, title: 'Тёмная материя', original: 'Dark Matter', year: 2024,
  poster: '', rating: 7.6, backdrop: '', genres: ['фантастика'], runtime: 50, overview: '', cast: [],
  seasons: [
    { number: 2, episodes: 10, year: 2025, aired: 10, airDate: '2025-05-01' },
    { number: 1, episodes: 9, year: 2024, aired: 9, airDate: '2024-05-08' },
  ],
  airing: true, status: 'returning', nextEpisode: null, lastAirDate: '2025-07-01',
};

const STAR_SHOW: CatalogCard = {
  ...SHOW, id: 31, title: 'Starbound Frontier', original: 'Starbound Frontier', year: 2023,
  seasons: [
    { number: 3, episodes: 8, year: 2026, aired: 8, airDate: '2026-03-01' },
    { number: 2, episodes: 8, year: 2025, aired: 8, airDate: '2025-03-01' },
    { number: 1, episodes: 8, year: 2023, aired: 8, airDate: '2023-03-01' },
  ],
  status: 'returning', nextEpisode: null,
};

const ITEMS: CatalogTitle[] = [
  { kind: 'tv', id: 22, title: 'Тёмная материя', original: 'Dark Matter', year: 2024, poster: '', rating: 7.6 },
];
const STAR_ITEMS: CatalogTitle[] = [
  { kind: 'tv', id: 31, title: 'Starbound Frontier', original: 'Starbound Frontier', year: 2023, poster: '', rating: 7 },
];

let search: ReturnType<typeof vi.fn<CatalogClient['search']>>;
let cards: { [id: number]: CatalogCard };

function fake(show: CatalogCard, star: CatalogCard = STAR_SHOW) {
  cards = { 22: show, 31: star };
  search = vi.fn<CatalogClient['search']>((q: string) => Promise.resolve({ items: /starbound/i.test(q) ? STAR_ITEMS : ITEMS, pages: 1 }));
  setCatalogClientForTests({
    novelties: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    discover: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    search,
    card: vi.fn((_k, id: number) => Promise.resolve(cards[id])),
    season: vi.fn((_id: number, n: number) => Promise.resolve({ number: n, name: '', airDate: '', overview: '', episodes: [] })),
  });
}

async function flush() {
  for (let round = 0; round < 3; round++) {
    await act(async () => {
      for (let i = 0; i < 15; i++) await Promise.resolve();
    });
  }
}

let el: HTMLElement | null = null;
function mount(node: preact.ComponentChild) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(node, el!));
}

const darkKey = () => (groupLibrary([S1, S2]).find((x) => x.kind === 'series') as SeriesGroup).key;
const darkGroup = () => groupLibrary([S1, S2]).find((x) => x.kind === 'series') as SeriesGroup;
const chips = () => Array.from(el!.querySelectorAll('.m-chip')) as HTMLButtonElement[];
const button = (text: string) =>
  Array.from(el!.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === text) as HTMLButtonElement | undefined;

// IntersectionObserver is not in jsdom: the stub keeps each observer so a test can bring a tile into view
let observers: { cb: IntersectionObserverCallback; els: Element[]; off: boolean }[] = [];
class FakeIO {
  entry: { cb: IntersectionObserverCallback; els: Element[]; off: boolean };
  constructor(cb: IntersectionObserverCallback) {
    this.entry = { cb, els: [], off: false };
    observers.push(this.entry);
  }
  observe(e: Element) {
    this.entry.els.push(e);
  }
  disconnect() {
    this.entry.off = true;
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}
function showTile(match: (e: Element) => boolean) {
  observers
    .filter((o) => !o.off && o.els.some(match))
    .forEach((o) => o.cb(o.els.map((e) => ({ isIntersecting: true, target: e }) as unknown as IntersectionObserverEntry), {} as IntersectionObserver));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  reloadProgress();
  serverViewed.value = [];
  resetSeriesMatches();
  observers = [];
  toast.value = '';
});

afterEach(() => {
  if (el) act(() => render(null, el!));
  el = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setCatalogClientForTests(null);
  applyLanguageSetting('ru');
});

describe('status pill', () => {
  const pill = (c: Partial<CatalogCard>) => seriesPill({ ...SHOW, ...c }, NOW);

  it('each status in Russian, with its colour', () => {
    expect(pill({ nextEpisode: { season: 3, episode: 4, airDate: '2026-10-12' } })).toEqual({ tone: 'airing', text: 'Выходит · следующая серия 12 окт.' });
    expect(pill({ status: '', nextEpisode: { season: 3, episode: 4, airDate: '2027-01-12' } })).toEqual({ tone: 'airing', text: 'Выходит · следующая серия 12 янв. 2027' });
    expect(pill({})).toEqual({ tone: 'airing', text: 'Выходит' });
    expect(pill({ status: 'ended' })).toEqual({ tone: 'ended', text: 'Завершён' });
    expect(pill({ status: 'canceled' })).toEqual({ tone: 'canceled', text: 'Отменён' });
    expect(pill({ status: 'production' })).toEqual({ tone: 'soon', text: 'В производстве' });
    expect(pill({ status: 'planned' })).toEqual({ tone: 'soon', text: 'В производстве' });
    expect(pill({ seasons: SHOW.seasons.concat([{ number: 3, episodes: 0, year: 2026, aired: 0, airDate: '2026-12-03' }]) })).toEqual({ tone: 'soon', text: 'Скоро новый сезон' });
  });

  it('each status in English', () => {
    applyLanguageSetting('en');
    expect(pill({ nextEpisode: { season: 3, episode: 4, airDate: '2026-10-12' } })).toEqual({ tone: 'airing', text: 'Airing · next episode Oct 12' });
    expect(pill({})!.text).toBe('Airing');
    expect(pill({ status: 'ended' })!.text).toBe('Ended');
    expect(pill({ status: 'canceled' })!.text).toBe('Canceled');
    expect(pill({ status: 'production' })!.text).toBe('In production');
    expect(pill({ seasons: [{ number: 3, episodes: 0, year: 2026, aired: 0, airDate: '2026-12-03' }] })!.text).toBe('New season soon');
  });

  it('a card cached without the new fields, a stale next episode and a film show none', () => {
    const old = { ...SHOW, seasons: SHOW.seasons.map((s) => ({ number: s.number, episodes: s.episodes, year: s.year, aired: s.aired })) };
    delete old.status;
    delete old.nextEpisode;
    delete old.lastAirDate;
    expect(seriesPill(old, NOW)).toBeNull();
    expect(upcomingSeasons(old, NOW)).toEqual([]);
    expect(tileBadge(old, [1, 2], NOW)).toBe('');
    expect(pill({ status: '', nextEpisode: { season: 2, episode: 5, airDate: '2026-09-01' } })).toBeNull();
    expect(seriesPill({ ...SHOW, kind: 'movie' }, NOW)).toBeNull();
  });

  it('dates: day and month, the year only when it is not this one', () => {
    expect(airDateText('2026-05-03', NOW)).toBe('3 мая');
    expect(airDateText('2027-05-03', NOW)).toBe('3 мая 2027');
    expect(airDateText('junk', NOW)).toBe('');
    applyLanguageSetting('en');
    expect(airDateText('2027-05-03', NOW)).toBe('May 3, 2027');
  });
});

describe('seasons to come and tile badges', () => {
  it('dated later, or the next episode season not started yet', () => {
    expect(upcomingSeasons({ ...SHOW, seasons: SHOW.seasons.concat([{ number: 3, episodes: 0, year: 2026, aired: 0, airDate: '2026-12-03' }]) }, NOW)).toEqual([{ number: 3, airDate: '2026-12-03' }]);
    expect(upcomingSeasons({ ...SHOW, nextEpisode: { season: 3, episode: 1, airDate: '2026-11-20' } }, NOW)).toEqual([{ number: 3, airDate: '2026-11-20' }]);
    // a season already running is not «to come»
    expect(upcomingSeasons({ ...SHOW, nextEpisode: { season: 2, episode: 7, airDate: '2026-10-12' } }, NOW)).toEqual([]);
  });

  it('«новая серия 12 окт.» (the date like the calendar and «Обзор» tiles) within 30 days, else «новый сезон» for a released season the library lacks', () => {
    expect(tileBadge({ ...SHOW, nextEpisode: { season: 2, episode: 7, airDate: '2026-10-12' } }, [1, 2], NOW)).toBe('новая серия 12 окт.');
    expect(tileBadge({ ...SHOW, nextEpisode: { season: 3, episode: 1, airDate: '2026-12-12' } }, [1, 2], NOW)).toBe('');
    expect(tileBadge(STAR_SHOW, [2], NOW)).toBe('новый сезон');
    expect(tileBadge(STAR_SHOW, [3], NOW)).toBe('');
    expect(tileBadge(STAR_SHOW, [0], NOW)).toBe('');
    applyLanguageSetting('en');
    expect(tileBadge({ ...SHOW, nextEpisode: { season: 2, episode: 7, airDate: '2026-10-12' } }, [1, 2], NOW)).toBe('new episode Oct 12');
    expect(tileBadge(STAR_SHOW, [2], NOW)).toBe('new season');
  });
});

describe('series screen', () => {
  beforeEach(() => {
    torrents.value = [S1, S2];
    resetTo({ name: 'library' });
    navigate({ name: 'series', key: darkKey() });
  });

  const NEXT_SEASON: CatalogCard = { ...SHOW, nextEpisode: { season: 3, episode: 1, airDate: '2026-11-20' } };

  it('the status pill under the meta line', async () => {
    fake(NEXT_SEASON);
    mount(<Series seriesKey={darkKey()} />);
    await flush();
    const p = el!.querySelector('.m-sh-head .m-status-pill')!;
    expect(p.textContent).toBe('Выходит · следующая серия 20 нояб.');
    expect(p.classList.contains('m-status-airing')).toBe(true);
    expect(el!.querySelector('.m-sh-meta')!.nextElementSibling).toBe(p);
  });

  it('a season to come is a chip with its date; «Напомнить» subscribes to it once', async () => {
    fake(NEXT_SEASON);
    mount(<Series seriesKey={darkKey()} />);
    await flush();
    expect(chips().map((c) => c.textContent)).toEqual(['Сезон 1', 'Сезон 2', 'Сезон 3 · с 20 нояб.']);
    const future = chips()[2];
    expect(future.classList.contains('m-chip-future')).toBe(true);
    expect(future.classList.contains('m-chip-missing')).toBe(false);
    expect(future.querySelector('svg')).toBeTruthy();

    act(() => future.click());
    expect(el!.textContent).toContain('Сезон выйдет 20 нояб.');
    expect(button('Найти раздачи')).toBeUndefined();
    expect(el!.querySelectorAll('.m-series-row').length).toBe(0);

    act(() => button('Напомнить')!.click());
    const subs = loadSubs();
    expect(subs.length).toBe(1);
    expect(subs[0]).toMatchObject({ query: torrentQuery(NEXT_SEASON, 3), quality: '', sources: null, notify: true });
    expect(toast.value).toBe('Подписка добавлена — смотрите «Новое»');
    await flush();
    expect(button('Напомнить')).toBeUndefined();
    expect(button('Напоминание включено')).toBeTruthy();
  });

  it('«Напоминание включено» when the same subscription exists already', async () => {
    addSubscription({ query: '  ' + torrentQuery(NEXT_SEASON, 3).toUpperCase(), quality: '1080', sources: null, notify: true });
    fake(NEXT_SEASON);
    mount(<Series seriesKey={darkKey()} />);
    await flush();
    act(() => chips()[2].click());
    expect(button('Напоминание включено')).toBeTruthy();
    expect(button('Напомнить')).toBeUndefined();
  });

  it('a missing past season keeps «Найти раздачи»; a dated future one is a chip too', async () => {
    fake({
      ...SHOW,
      seasons: ([
        { number: 4, episodes: 0, year: 2026, aired: 0, airDate: '2026-12-03' },
        { number: 3, episodes: 8, year: 2026, aired: 8, airDate: '2026-02-01' },
      ] as Season[]).concat(SHOW.seasons),
    });
    mount(<Series seriesKey={darkKey()} />);
    await flush();
    expect(chips().map((c) => c.textContent)).toEqual(['Сезон 1', 'Сезон 2', '+Сезон 3', 'Сезон 4 · с 3 дек.']);
    act(() => chips()[2].click());
    expect(button('Найти раздачи')).toBeTruthy();
    expect(button('Напомнить')).toBeUndefined();
    act(() => chips()[3].click());
    expect(el!.textContent).toContain('Сезон выйдет 3 дек.');
  });

  it('in English', async () => {
    applyLanguageSetting('en');
    fake(NEXT_SEASON);
    mount(<Series seriesKey={darkKey()} />);
    await flush();
    expect(el!.querySelector('.m-status-pill')!.textContent).toBe('Airing · next episode Nov 20');
    expect(chips()[2].textContent).toBe('Season 3 · from Nov 20');
    act(() => chips()[2].click());
    expect(el!.textContent).toContain('The season comes out Nov 20');
    act(() => button('Remind me')!.click());
    await flush();
    expect(button('Reminder on')).toBeTruthy();
  });
});

describe('«Мои» tiles', () => {
  beforeEach(() => {
    reloadTvs();
    for (const s of servers.value.slice()) removeServer(s.id);
    setActiveServer(addServer({ url: 'http://srv:8090' }).id);
    torrents.value = [S1, S2, STAR, FILM];
    libraryTab.value = 'all';
    libraryQuery.value = '';
    librarySearchOpen.value = false;
    updateSettings({ libraryView: 'large', librarySort: 'new' });
    resetTo({ name: 'library' });
    vi.spyOn(TorrServerClient.prototype, 'list').mockImplementation(async () => [S1, S2, STAR, FILM]);
    vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
    vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
    vi.stubGlobal('IntersectionObserver', FakeIO);
  });

  const badges = () =>
    Array.from(el!.querySelectorAll('.m-new-badge')).map((b) => ({ anchor: b.closest('[data-anchor]')!.getAttribute('data-anchor'), text: b.textContent }));

  it('a cached match gives the group its badge; an off-screen tile looks nothing up', async () => {
    fake({ ...SHOW, nextEpisode: { season: 2, episode: 7, airDate: '2026-10-12' } });
    await matchSeries(darkGroup());
    expect(search).toHaveBeenCalledTimes(1);
    mount(<Library />);
    await flush();
    expect(badges()).toEqual([
      { anchor: 'g:' + darkKey(), text: 'новая серия 12 окт.' },
      { anchor: 'st', text: '' },
    ]);
    // no film badge, and no lookup for the tile not in view
    expect(search).toHaveBeenCalledTimes(1);
    expect(cachedSeriesMatch('starbound frontier')).toBeUndefined();
  });

  it('a matched series tile is named by TMDB; its season and episodes go under the name, never into it', async () => {
    const LONE: Torrent = {
      hash: 'dm', title: 'Темная материя / Dark Matter / Сезон: 2 / Серии: 1-6 из 10 (Алик Сахаров) [2024, США, WEB-DL 1080p]',
      category: 'tv', stat: 3, torrent_size: GB, timestamp: 9, data: files(['S02E01.mkv', 'S02E02.mkv']),
    };
    torrents.value = [LONE];
    vi.spyOn(TorrServerClient.prototype, 'list').mockImplementation(async () => [LONE]);
    fake(SHOW);
    mount(<Library />);
    await flush();
    const tile = () => el!.querySelector('[data-anchor="dm"]')!;
    // not matched yet: the short name from the torrent title
    expect(tile().querySelector('.m-card-title')!.textContent).toBe('Темная материя');
    expect(tile().querySelector('.m-card-meta')!.textContent).toBe('2 сезон · серии 1–6 из 10');
    act(() => showTile((e) => e.getAttribute('data-anchor') === 'dm'));
    await flush();
    expect(tile().querySelector('.m-card-title')!.textContent).toBe('Тёмная материя');
    expect(tile().querySelector('.m-card-meta')!.textContent).toBe('2 сезон · серии 1–6 из 10');
    // the grouped series card too: the TMDB name, the count only on the poster badge
    torrents.value = [S1, S2];
    vi.spyOn(TorrServerClient.prototype, 'list').mockImplementation(async () => [S1, S2]);
    await matchSeries(darkGroup());
    act(() => render(null, el!));
    mount(<Library />);
    await flush();
    const card = el!.querySelector('.m-series-card')!;
    expect(card.querySelector('.m-card-title')!.textContent).toBe('Тёмная материя');
    expect(card.querySelector('.m-card-meta')).toBeNull();
  });

  it('a tile in view is looked up once, then shows its badge', async () => {
    fake(SHOW);
    mount(<Library />);
    await flush();
    expect(search).not.toHaveBeenCalled();
    act(() => showTile((e) => e.getAttribute('data-anchor') === 'st'));
    await flush();
    expect(search.mock.calls.every((c) => /starbound/i.test(c[0]))).toBe(true);
    const n = search.mock.calls.length;
    expect(badges().filter((b) => b.anchor === 'st')[0].text).toBe('новый сезон');
    // scrolled back into view: known, no second lookup
    act(() => showTile((e) => e.getAttribute('data-anchor') === 'st'));
    await flush();
    expect(search.mock.calls.length).toBe(n);
  });

  it('at most 2 lookups at a time', async () => {
    const waiting: (() => void)[] = [];
    fake(SHOW);
    search.mockImplementation(() => new Promise((res) => waiting.push(() => res({ items: [], pages: 1 }))));
    const more: Torrent[] = ['Alpha Line S01', 'Beta Line S01', 'Gamma Line S01'].map((title, i) => ({
      hash: 'x' + i, title: title + ' 1080p WEB-DL', category: 'tv', stat: 3, torrent_size: GB, timestamp: 10 + i,
    }));
    torrents.value = more;
    vi.spyOn(TorrServerClient.prototype, 'list').mockImplementation(async () => more);
    mount(<Library />);
    await flush();
    act(() => showTile(() => true));
    await flush();
    expect(search).toHaveBeenCalledTimes(2);
    waiting.splice(0).forEach((f) => f());
    await flush();
    expect(search.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('no badge without TMDB', async () => {
    const offline = () => Promise.reject(new Error('catalog:offline'));
    setCatalogClientForTests({ novelties: offline, discover: offline, search: offline, card: offline });
    mount(<Library />);
    await flush();
    act(() => showTile(() => true));
    await flush();
    expect(badges().every((b) => b.text === '')).toBe(true);
  });
});

describe('«Обзор» card', () => {
  beforeEach(() => {
    torrents.value = [];
    resetTo({ name: 'title', kind: 'tv', id: 22 });
  });

  it('a series has the status pill with the next episode', async () => {
    fake({ ...SHOW, nextEpisode: { season: 2, episode: 7, airDate: '2026-10-12' } });
    mount(<TitleCard kind="tv" id={22} />);
    await flush();
    const p = el!.querySelector('.m-tc-head .m-status-pill')!;
    expect(p.textContent).toBe('Выходит · следующая серия 12 окт.');
    expect(p.classList.contains('m-status-airing')).toBe(true);
  });

  it('ended and canceled series; English', async () => {
    fake({ ...SHOW, status: 'canceled' });
    mount(<TitleCard kind="tv" id={22} />);
    await flush();
    expect(el!.querySelector('.m-status-pill.m-status-canceled')!.textContent).toBe('Отменён');
    act(() => render(null, el!));
    applyLanguageSetting('en');
    fake({ ...SHOW, status: 'ended' });
    mount(<TitleCard kind="tv" id={22} />);
    await flush();
    expect(el!.querySelector('.m-status-pill.m-status-ended')!.textContent).toBe('Ended');
  });

  it('a film has none', async () => {
    fake(SHOW);
    setCatalogClientForTests({
      novelties: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
      discover: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
      search: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
      card: vi.fn(() => Promise.resolve({ ...SHOW, kind: 'movie' as const, seasons: [], status: '' as const })),
    });
    mount(<TitleCard kind="movie" id={22} />);
    await flush();
    expect(el!.querySelector('.m-tc-title')).toBeTruthy();
    expect(el!.querySelector('.m-status-pill')).toBeNull();
  });
});

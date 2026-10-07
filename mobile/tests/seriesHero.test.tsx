import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Series, heroMeta } from '../src/screens/Series';
import { setCatalogClientForTests } from '../src/catalog/phoneCatalog';
import { resetSeriesMatches, pickShow } from '../../src/lib/seriesMatch';
import { findGroup, groupLibrary, type SeriesGroup } from '../../src/lib/seriesGroups';
import { currentRoute, navigate, resetTo } from '../src/nav';
import { torrents } from '../../src/store/library';
import { reloadProgress, serverViewed } from '../../src/store/progress';
import { applyLanguageSetting, lang } from '../../src/i18n';
import { torrentQuery, type CatalogCard, type CatalogTitle, type SeasonDetails } from '../../src/catalog/tmdb';
import type { CatalogClient } from '../../src/catalog/client';
import type { Torrent } from '../../src/api/types';

function files(names: string[]) {
  return JSON.stringify({ TorrServer: { Files: names.map((p, i) => ({ id: i + 1, path: p, length: 1000 })) } });
}

const GB = 1024 ** 3;
const S1: Torrent = { hash: 's1', title: 'Темная материя / Dark Matter (2024) [S01] 1080p WEB-DL', category: 'tv', stat: 3, torrent_size: 4 * GB, timestamp: 1, data: files(['S01E01.mkv', 'S01E02.mkv']) };
const S2: Torrent = { hash: 's2', title: 'Тёмная материя / Dark Matter (2025) [S02] 2160p WEB-DL', category: 'tv', stat: 3, torrent_size: 6 * GB, timestamp: 4, data: files(['S02E01.mkv', 'S02E02.mkv']) };

const SHOW: CatalogCard = {
  kind: 'tv', id: 22, title: 'Тёмная материя', original: 'Dark Matter', year: 2024,
  poster: 'https://img.test/t/p/w300/p.jpg', rating: 7.6, backdrop: 'https://img.test/t/p/w780/b.jpg',
  genres: ['фантастика', 'драма', 'триллер'], runtime: 50, overview: 'Физик просыпается в чужой жизни.',
  cast: [],
  seasons: [
    { number: 3, episodes: 10, year: 2026, aired: 2 },
    { number: 2, episodes: 10, year: 2025, aired: 10 },
    { number: 1, episodes: 9, year: 2024, aired: 9 },
  ],
  airing: true,
};

const FOUND: CatalogTitle[] = [
  { kind: 'movie', id: 5, title: 'Тёмная материя', original: 'Dark Matter', year: 2024, poster: '', rating: 5 },
  { kind: 'tv', id: 9, title: 'Тёмная материя', original: 'Dark Matter', year: 2015, poster: '', rating: 6 },
  { kind: 'tv', id: 22, title: 'Тёмная материя', original: 'Dark Matter', year: 2024, poster: '', rating: 7.6 },
];

function seasonOf(n: number): SeasonDetails {
  return { number: n, name: n === 2 ? 'Возвращение' : 'Сезон ' + n, airDate: '', overview: 'О сезоне ' + n, episodes: [] };
}

let search: ReturnType<typeof vi.fn<CatalogClient['search']>>;
let card: ReturnType<typeof vi.fn<CatalogClient['card']>>;

function fake(opts: { items?: CatalogTitle[]; fail?: boolean } = {}) {
  search = vi.fn<CatalogClient['search']>(() =>
    opts.fail ? Promise.reject(new Error('catalog:offline')) : Promise.resolve({ items: opts.items || FOUND, pages: 1 }),
  );
  card = vi.fn<CatalogClient['card']>(() => Promise.resolve(SHOW));
  setCatalogClientForTests({
    novelties: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    discover: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    search,
    card,
    season: vi.fn((_id: number, n: number) => Promise.resolve(seasonOf(n))),
  });
}

async function flush() {
  for (let round = 0; round < 3; round++) {
    await act(async () => {
      for (let i = 0; i < 15; i++) await Promise.resolve();
    });
  }
}

let el: HTMLElement;
function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<Series seriesKey={key()} />, el));
}
function unmount() {
  act(() => render(null, el));
}

function key(): string {
  return (groupLibrary([S1, S2]).find((x) => x.kind === 'series') as SeriesGroup).key;
}

const chips = () => Array.from(el.querySelectorAll('.m-chip')) as HTMLButtonElement[];
const button = (text: string) =>
  Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === text) as HTMLButtonElement | undefined;

beforeEach(() => {
  localStorage.clear();
  reloadProgress();
  serverViewed.value = [];
  torrents.value = [S1, S2];
  resetSeriesMatches();
  resetTo({ name: 'library' });
  navigate({ name: 'series', key: key() });
});

afterEach(() => {
  if (el) unmount();
  setCatalogClientForTests(null);
  applyLanguageSetting('ru');
});

describe('series screen with TMDB', () => {
  it('a hero with the backdrop, poster, title, years · rating · genres and the overview', async () => {
    fake();
    mount();
    await flush();
    expect(search).toHaveBeenCalledWith('Тёмная материя', 1);
    expect(card).toHaveBeenCalledWith('tv', 22);
    expect((el.querySelector('.m-sh-backdrop img') as HTMLImageElement).src).toBe(SHOW.backdrop);
    expect((el.querySelector('img.m-sh-poster') as HTMLImageElement).src).toBe(SHOW.poster);
    expect(el.querySelector('.m-series-title')!.textContent).toBe('Тёмная материя');
    expect(el.querySelector('.m-sh-meta')!.textContent).toBe('2024–2026 · ★ 7,6 · Фантастика, Драма');
    expect(el.querySelector('.m-sh-overview')!.textContent).toBe(SHOW.overview);
    expect(el.querySelector('.m-series-hero')).toBeTruthy();
    expect(el.querySelector('.m-series-head')).toBeNull();
  });

  it('the meta line in English', () => {
    applyLanguageSetting('en');
    expect(heroMeta(SHOW)).toBe('2024–2026 · ★ 7.6 · Фантастика, Драма');
    expect(heroMeta({ ...SHOW, seasons: [{ number: 1, episodes: 8, year: 2024, aired: 8 }], rating: 0, genres: [] })).toBe('2024');
  });

  it('season chips with the caption and the TMDB season name; a missing season is dimmed with «Найти раздачи»', async () => {
    fake();
    mount();
    await flush();
    expect(chips().map((c) => c.textContent)).toEqual(['Сезон 1', 'Сезон 2', '+Сезон 3']);
    expect(chips()[2].classList.contains('m-chip-missing')).toBe(true);
    expect(chips()[2].getAttribute('aria-label')).toBe('Сезон 3, нет в каталоге');
    expect(chips()[1].classList.contains('on')).toBe(true);
    expect(el.querySelector('.m-sh-caption')!.textContent).toBe('10 серий · 2025');
    expect(el.querySelector('.m-sh-season-name')!.textContent).toBe('Возвращение');
    expect(el.querySelector('.m-sh-season-overview')!.textContent).toBe('О сезоне 2');
    expect(Array.from(el.querySelectorAll('.m-series-row')).map((r) => r.getAttribute('data-hash'))).toEqual(['s2']);

    act(() => chips()[0].click());
    await flush();
    // TMDB's plain «Сезон 1» name is not repeated
    expect(el.querySelector('.m-sh-season-name')).toBeNull();
    expect(el.querySelector('.m-sh-caption')!.textContent).toBe('9 серий · 2024');

    act(() => chips()[2].click());
    expect(el.textContent).toContain('Этого сезона нет в каталоге');
    expect(el.querySelector('.m-sh-caption')!.textContent).toBe('10 серий · 2026');
    expect(el.querySelectorAll('.m-series-row').length).toBe(0);
    act(() => button('Найти раздачи')!.click());
    expect(currentRoute.value).toEqual({ name: 'add', query: torrentQuery(SHOW, 3), run: true });
  });

  it('the match is kept per series: a revisit shows the hero at once without a new search', async () => {
    fake();
    mount();
    await flush();
    unmount();
    mount();
    expect(el.querySelector('.m-sh-backdrop')).toBeTruthy();
    await flush();
    expect(search).toHaveBeenCalledTimes(1);
    expect(card).toHaveBeenCalledTimes(1);
  });

  it('English: chips, caption, missing season and its button', async () => {
    applyLanguageSetting('en');
    fake();
    mount();
    await flush();
    expect(chips().map((c) => c.textContent)).toEqual(['Season 1', 'Season 2', '+Season 3']);
    expect(el.querySelector('.m-sh-caption')!.textContent).toBe('10 episodes · 2025');
    expect(el.querySelector('.m-sh-meta')!.textContent).toBe('2024–2026 · ★ 7.6 · Фантастика, Драма');
    act(() => chips()[2].click());
    expect(el.textContent).toContain('This season is not in your library');
    expect(button('Find torrents')).toBeTruthy();
  });
});

describe('series screen · cast', () => {
  it('lists the cast after the season rows; a tap opens the person', async () => {
    fake();
    card.mockImplementation(() =>
      Promise.resolve({
        ...SHOW,
        cast: [
          { id: 7, name: 'Джоэл Эдгертон', photo: '', role: 'Джейсон', job: 'cast' as const },
          { id: 8, name: 'Блейк Крауч', photo: '', role: '', job: 'creator' as const },
        ],
      }),
    );
    mount();
    await flush();
    expect(el.querySelector('.m-tc-section h2')!.textContent).toBe('В ролях');
    const people = el.querySelectorAll('.m-tc-person');
    expect(people[0].textContent).toContain('Блейк Крауч');
    act(() => (people[1] as HTMLElement).click());
    expect(currentRoute.value).toMatchObject({ name: 'person', id: 7, label: 'Джоэл Эдгертон' });
  });
  it('sits before the season rows, right after the watch button', async () => {
    fake();
    card.mockImplementation(() => Promise.resolve({ ...SHOW, cast: [{ id: 7, name: 'Джоэл Эдгертон', photo: '', role: 'Джейсон', job: 'cast' as const }] }));
    mount();
    await flush();
    const cast = el.querySelector('.m-tc-section')!;
    const rows = el.querySelector('.m-series-rows')!;
    expect(cast.compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const actions = el.querySelector('.m-tc-season-actions');
    if (actions) expect(actions.compareDocumentPosition(cast) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('is absent without a cast', async () => {
    fake();
    mount();
    await flush();
    expect(el.querySelector('.m-tc-cast')).toBeNull();
  });
});

describe('series screen without TMDB', () => {
  it('offline: the simple layout, no hero box, no error', async () => {
    fake({ fail: true });
    mount();
    await flush();
    expect(el.querySelector('.m-sh-backdrop')).toBeNull();
    expect(el.querySelector('.m-series-head')).toBeTruthy();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(chips().map((c) => c.textContent)).toEqual(['Сезон 1', 'Сезон 2']);
    expect(el.querySelector('.m-sh-caption')).toBeNull();
    expect(el.querySelector('.m-series-title')!.textContent).toBe('Тёмная материя');
  });

  it('no show found (only a film): the simple layout, and the miss is kept', async () => {
    fake({ items: [FOUND[0]] });
    mount();
    await flush();
    expect(el.querySelector('.m-sh-backdrop')).toBeNull();
    expect(card).not.toHaveBeenCalled();
    // every name variant of the title was tried once
    const tried = search.mock.calls.length;
    expect(tried).toBeGreaterThanOrEqual(1);
    unmount();
    mount();
    await flush();
    expect(search).toHaveBeenCalledTimes(tried);
  });

  it('the local name finds nothing: the original name is tried next', async () => {
    const { findShow } = await import('../../src/lib/tmdbShow');
    const show = { ...FOUND[0], kind: 'tv' as const };
    const s = vi.fn((q: string) => Promise.resolve({ items: q.indexOf('Star Trek') === 0 ? [show] : [] }));
    const hit = await findShow({ search: s }, 'Звездный путь: Странные новые миры / Star Trek: Strange New Worlds / Сезон: 4', 0);
    expect(hit && hit.id).toBe(show.id);
    expect(s.mock.calls.map((c) => c[0])).toContain('Star Trek: Strange New Worlds');
  });

  it('in English the original name is searched first: a Russian name finds another show of that name there', async () => {
    const { findShow, showQueries } = await import('../../src/lib/tmdbShow');
    const title = 'Тёмная материя / Dark Matter / Сезон: 2 / Серии: 1-8 из 10 [2026, WEB-DL 1080p]';
    // TMDB in en-US: the Russian name is only an alternative title of the 2015 show (ended, 3 seasons)
    const old = { kind: 'tv' as const, id: 62425, title: 'Dark Matter', original: 'Dark Matter', year: 2015, poster: '', rating: 7 };
    const now = { kind: 'tv' as const, id: 196322, title: 'Dark Matter', original: 'Dark Matter', year: 2024, poster: '', rating: 8 };
    const s = vi.fn((q: string) => Promise.resolve({ items: /[Ѐ-ӿ]/.test(q) ? [old] : [now, old] }));
    expect(showQueries(title, 'ru')[0]).not.toBe('Dark Matter');
    expect(showQueries(title, 'en')[0]).toBe('Dark Matter');
    lang.value = 'en';
    try {
      const hit = await findShow({ search: s }, title, 2026);
      expect(hit && hit.id).toBe(196322);
      expect(s.mock.calls[0][0]).toBe('Dark Matter');
    } finally {
      lang.value = 'ru';
    }
  });

  it('pickShow prefers a series of the year, else the first series, never a film', () => {
    expect(pickShow(FOUND, 2024)!.id).toBe(22);
    expect(pickShow(FOUND, 2030)!.id).toBe(9);
    expect(pickShow([FOUND[0]], 2024)).toBeNull();
    expect(findGroup([S1, S2], key())!.seasons).toEqual([1, 2]);
  });
});

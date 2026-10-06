import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';
import { ru } from '../../src/i18n/ru';
import { Discover } from '../src/screens/catalog/Discover';
import { clearDiscover, DISCOVER_TTL_MS } from '../src/screens/catalog/discoverCache';
import { Library } from '../src/screens/Library';
import { phoneCatalog, setCatalogClientForTests, catalogMode, setCatalogMode, OFFLINE_TITLE, OFFLINE_TEXT, NOKEY_TEXT } from '../src/catalog/phoneCatalog';
import { currentRoute, resetTo } from '../src/nav';
import { torrents, libraryTab, libraryQuery, librarySearchOpen } from '../../src/store/library';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { TorrServerClient } from '../../src/api/torrserver';
import type { CatalogClient } from '../../src/catalog/client';
import { sourceHttp } from '../src/platform/native';
import type { CatalogTitle, Kind } from '../../src/catalog/tmdb';
import type { Torrent } from '../../src/api/types';
import type { DiscoverQuery } from '../../src/catalog/discoverQuery';
// @ts-ignore node builtins
import { readFileSync } from 'node:fs';
// @ts-ignore
import { join } from 'node:path';

const MOVIE: CatalogTitle = { kind: 'movie', id: 11, title: 'Полуночный архив', original: 'Midnight Archive', year: 2026, poster: 'https://img.test/t/p/w300/a.jpg', rating: 7.4 };
const MOVIE2: CatalogTitle = { kind: 'movie', id: 12, title: 'Clockwork Harbor', original: 'Clockwork Harbor', year: 2025, poster: '', rating: 0 };
const SHOW: CatalogTitle = { kind: 'tv', id: 21, title: 'Ледяной перевал', original: 'Frost Pass', year: 2026, poster: '', rating: 8 };
const PAGE2: CatalogTitle = { kind: 'movie', id: 13, title: 'Stardust Ledger', original: 'Stardust Ledger', year: 2026, poster: '', rating: 6.1 };

function codeError(code: string): Error {
  const e = new Error('catalog:' + code);
  (e as Error & { code?: string }).code = code;
  return e;
}

type Novelties = CatalogClient['novelties'];
let queries: DiscoverQuery[] = [];

function fake(impl?: Novelties) {
  const novelties = vi.fn<Novelties>(
    impl ||
      ((kind: Kind | 'all', page: number) => {
        if (page === 2) return Promise.resolve({ items: [PAGE2], pages: 2 });
        if (kind === 'tv') return Promise.resolve({ items: [SHOW], pages: 1 });
        if (kind === 'movie') return Promise.resolve({ items: [MOVIE, MOVIE2], pages: 1 });
        return Promise.resolve({ items: [MOVIE, SHOW, MOVIE2], pages: 2 });
      }),
  );
  // the screen asks discover(kind, query, page); the mock records (kind, page), the query goes to `queries`
  queries = [];
  const c: CatalogClient = {
    novelties: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    discover: (kind, query, page) => {
      queries.push(query);
      return novelties(kind, page);
    },
    search: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    card: vi.fn(() => Promise.reject(codeError('bad'))),
    season: vi.fn(() => Promise.reject(codeError('bad'))),
  };
  setCatalogClientForTests(c);
  return novelties;
}

// IntersectionObserver is not in jsdom: the stub keeps the callback so a test can "scroll" to the sentinel
let observed: { cb: IntersectionObserverCallback; el: Element | null }[] = [];
class FakeObserver {
  cb: IntersectionObserverCallback;
  entry: { cb: IntersectionObserverCallback; el: Element | null };
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
    this.entry = { cb, el: null };
    observed.push(this.entry);
  }
  observe(el: Element) { this.entry.el = el; }
  unobserve() { this.entry.el = null; }
  disconnect() {
    this.entry.el = null;
    observed = observed.filter((o) => o !== this.entry);
  }
  takeRecords() { return []; }
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}

let el: HTMLElement;
function mount(node: preact.ComponentChild) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(node, el));
}

const button = (text: string) => Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === text) as HTMLButtonElement | undefined;
const tiles = () => Array.from(el.querySelectorAll('.m-disc-grid button.m-disc-tile')) as HTMLButtonElement[];

async function scrollToEnd() {
  const live = observed.filter((o) => o.el && o.el.classList.contains('m-disc-sentinel'));
  expect(live.length).toBe(1);
  await act(async () => {
    live[0].cb([{ isIntersecting: true, target: live[0].el } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
  });
  await flush();
}

beforeEach(() => {
  clearDiscover();
  localStorage.clear();
  observed = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  torrents.value = [];
  resetTo({ name: 'library' });
});

afterEach(() => {
  act(() => render(null, el));
  setCatalogClientForTests(null);
  setCatalogMode('mine');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('«Мои / Обзор» switch in «Каталог»', () => {
  const T: Torrent[] = [{ hash: 'h1', title: 'Neon Rivers 2024 1080p', category: 'movie', stat: 3, torrent_size: 1024, timestamp: 1 }];

  beforeEach(() => {
    for (const s of servers.value.slice()) removeServer(s.id);
    setActiveServer(addServer({ url: 'http://srv:8090' }).id);
    torrents.value = T;
    libraryTab.value = 'all';
    libraryQuery.value = '';
    librarySearchOpen.value = false;
    vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue(T);
    vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
    vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
  });

  it('shows «Мои» by default and keeps «Обзор» after a tap', async () => {
    fake();
    mount(<Library />);
    await flush();
    const list = el.querySelector('[role=tablist][aria-label="Каталог"]')!;
    expect(list).not.toBeNull();
    const tabs = Array.from(list.querySelectorAll('[role=tab]')) as HTMLElement[];
    expect(tabs.map((b) => b.textContent)).toEqual(['Мои', 'Обзор']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
    // «Мои» is the library as before
    expect(el.textContent).toContain('Neon Rivers');
    expect(el.querySelector('.m-disc-grid')).toBeNull();

    act(() => tabs[1].click());
    await flush();
    expect(JSON.parse(localStorage.getItem('tsp.catalogMode') || 'null')).toBe('discover');
    expect(catalogMode.value).toBe('discover');
    expect(el.querySelector('h2')!.textContent).toBe('Новинки');
    expect(el.textContent).toContain('Полуночный архив');
    expect(el.textContent).not.toContain('Neon Rivers');

    act(() => (el.querySelectorAll('[role=tablist][aria-label="Каталог"] [role=tab]')[0] as HTMLElement).click());
    await flush();
    expect(JSON.parse(localStorage.getItem('tsp.catalogMode') || 'null')).toBe('mine');
    expect(el.textContent).toContain('Neon Rivers');
  });

  it('switching «Мои / Обзор» starts the other mode at the top; a tap on the open mode keeps the scroll', async () => {
    let top = 0;
    const root = document.documentElement;
    Object.defineProperty(root, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => (top = v) });
    try {
      fake();
      mount(<Library />);
      await flush();
      const tab = (i: number) => el.querySelectorAll('[role=tablist][aria-label="Каталог"] [role=tab]')[i] as HTMLElement;
      top = 900;
      act(() => tab(0).click());
      await flush();
      expect(top).toBe(900);
      act(() => tab(1).click());
      await flush();
      expect(catalogMode.value).toBe('discover');
      expect(top).toBe(0);
      top = 700;
      act(() => tab(0).click());
      await flush();
      expect(top).toBe(0);
    } finally {
      delete (root as unknown as { scrollTop?: number }).scrollTop;
    }
  });

  it('opens on «Обзор» when it was chosen last time', async () => {
    fake();
    setCatalogMode('discover');
    mount(<Library />);
    await flush();
    const tabs = el.querySelectorAll('[role=tablist][aria-label="Каталог"] [role=tab]');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('.m-disc-grid')).not.toBeNull();
  });
});

describe('Discover («Новинки»)', () => {
  it('renders the feed of novelties(all, 1): posters, ratings, kinds, header and footer', async () => {
    const nov = fake();
    mount(<Discover />);
    await flush();
    expect(nov).toHaveBeenCalledWith('all', 1);
    expect(el.querySelector('h2')!.textContent).toBe('Новинки');
    expect(el.textContent).toContain('из каталога TMDB');
    const ts = tiles();
    expect(ts.map((b) => b.getAttribute('aria-label'))).toEqual(['Полуночный архив 2026', 'Ледяной перевал 2026', 'Clockwork Harbor 2025']);
    // the poster image, else a placeholder with the title
    expect(ts[0].querySelector('img')!.getAttribute('src')).toBe('https://img.test/t/p/w300/a.jpg');
    expect(ts[2].querySelector('img')).toBeNull();
    expect(ts[2].querySelector('.m-disc-ph')!.textContent).toBe('Clockwork Harbor');
    // rating with a comma, none for 0
    expect(ts[0].querySelector('.m-disc-rating')!.textContent).toBe('★ 7,4');
    expect(ts[1].querySelector('.m-disc-rating')!.textContent).toBe('★ 8,0');
    expect(ts[2].querySelector('.m-disc-rating')).toBeNull();
    expect(ts[0].textContent).toContain('Фильм');
    expect(ts[1].textContent).toContain('Сериал');
    expect(el.querySelector('.m-disc-foot')!.textContent).toBe('Данные: TMDB');
  });

  it('shows 6 skeleton tiles while loading', async () => {
    fake(() => new Promise(() => undefined));
    mount(<Discover />);
    await flush();
    expect(el.querySelectorAll('.m-disc-skel').length).toBe(6);
    expect(tiles().length).toBe(0);
  });

  it('chip «Сериалы» asks novelties(tv, 1) and shows the series', async () => {
    const nov = fake();
    mount(<Discover />);
    await flush();
    const chips = Array.from(el.querySelectorAll('.m-disc-chips button[aria-pressed]')) as HTMLButtonElement[];
    expect(chips.map((b) => b.textContent)).toEqual(['Все', 'Фильмы', 'Сериалы']);
    expect(chips[0].getAttribute('aria-pressed')).toBe('true');
    act(() => chips[2].click());
    await flush();
    expect(nov).toHaveBeenLastCalledWith('tv', 1);
    expect(chips[2].getAttribute('aria-pressed')).toBe('true');
    expect(tiles().map((b) => b.getAttribute('aria-label'))).toEqual(['Ледяной перевал 2026']);
    act(() => button('Фильмы')!.click());
    await flush();
    expect(nov).toHaveBeenLastCalledWith('movie', 1);
    expect(tiles().length).toBe(2);
  });

  it('marks «В медиатеке» on a title that matches a library torrent', async () => {
    fake();
    torrents.value = [{ hash: 'x', title: 'Полуночный архив (2026) WEB-DL 1080p', category: 'movie', stat: 3, torrent_size: 1, timestamp: 1 }];
    mount(<Discover />);
    await flush();
    const ts = tiles();
    expect(ts[0].querySelector('.m-disc-badge')!.textContent).toBe('В медиатеке');
    expect(ts[1].querySelector('.m-disc-badge')).toBeNull();
    expect(ts[2].querySelector('.m-disc-badge')).toBeNull();
  });

  it('a tap on a poster opens the title route', async () => {
    fake();
    mount(<Discover />);
    await flush();
    act(() => tiles()[1].click());
    expect(currentRoute.value).toEqual({ name: 'title', kind: 'tv', id: 21 });
  });

  it('loads the next page at the sentinel while page < pages, then stops', async () => {
    const nov = fake();
    mount(<Discover />);
    await flush();
    await scrollToEnd();
    expect(nov).toHaveBeenLastCalledWith('all', 2);
    expect(tiles().map((b) => b.getAttribute('aria-label'))).toEqual([
      'Полуночный архив 2026', 'Ледяной перевал 2026', 'Clockwork Harbor 2025', 'Stardust Ledger 2026',
    ]);
    // page 2 of 2: no sentinel any more
    expect(observed.filter((o) => o.el && o.el.classList.contains('m-disc-sentinel')).length).toBe(0);
    expect(nov).toHaveBeenCalledTimes(2);
  });

  it('a failed next page shows «Не удалось загрузить» and «Повторить» loads it again', async () => {
    let failPage2 = true;
    const nov = fake((kind, page) => {
      if (page === 2) return failPage2 ? Promise.reject(codeError('offline')) : Promise.resolve({ items: [PAGE2], pages: 2 });
      return Promise.resolve({ items: [MOVIE], pages: 2 });
    });
    mount(<Discover />);
    await flush();
    await scrollToEnd();
    const row = el.querySelector('.m-disc-more')!;
    expect(row.textContent).toContain('Не удалось загрузить');
    // the first page stays
    expect(tiles().length).toBe(1);
    failPage2 = false;
    act(() => (row.querySelector('button') as HTMLButtonElement).click());
    await flush();
    expect(nov).toHaveBeenLastCalledWith('all', 2);
    expect(el.querySelector('.m-disc-more')).toBeNull();
    expect(tiles().length).toBe(2);
  });

  it('error nokey: the title, NOKEY_TEXT and «Как получить ключ» to the FAQ item', async () => {
    fake(() => Promise.reject(codeError('nokey')));
    mount(<Discover />);
    await flush();
    expect(el.textContent).toContain(ru.discover.offlineTitle);
    expect(el.textContent).toContain('Нет ключа TMDB. Добавьте его в настройках TorrServer (TMDB → API key). Ваши раздачи — во вкладке «Мои».');
    expect(el.textContent).not.toContain(ru.discover.offlineText);
    expect(OFFLINE_TITLE).toBe('discover.offlineTitle');
    expect(NOKEY_TEXT).toBe('discover.nokeyText');
    act(() => button('Как получить ключ')!.click());
    expect(currentRoute.value).toEqual({ name: 'faq', q: 'tmdb-key' });
  });

  it('error offline: OFFLINE_TEXT, no key button; «Повторить» refetches', async () => {
    let fail = true;
    const nov = fake(() => (fail ? Promise.reject(codeError('offline')) : Promise.resolve({ items: [MOVIE], pages: 1 })));
    mount(<Discover />);
    await flush();
    expect(el.textContent).toContain('Каталог фильмов недоступен');
    expect(el.textContent).toContain('TMDB не отвечает из этой сети. Укажите зеркало TMDB в настройках TorrServer или попробуйте позже. Ваши раздачи — во вкладке «Мои».');
    expect(OFFLINE_TEXT).toBe('discover.offlineText');
    expect(button('Как получить ключ')).toBeUndefined();
    expect(nov).toHaveBeenCalledTimes(1);
    fail = false;
    act(() => button('Повторить')!.click());
    await flush();
    expect(nov).toHaveBeenCalledTimes(2);
    expect(tiles().map((b) => b.getAttribute('aria-label'))).toEqual(['Полуночный архив 2026']);
    expect(el.textContent).not.toContain('Каталог фильмов недоступен');
  });

  it('English: header, chips, kinds, rating, footer and the no-key state', async () => {
    applyLanguageSetting('en');
    try {
      fake();
      mount(<Discover />);
      await flush();
      expect(el.querySelector('h2')!.textContent).toBe('New releases');
      expect(el.textContent).toContain('from the TMDB catalog');
      expect(Array.from(el.querySelectorAll('.m-disc-chips button[aria-pressed]')).map((b) => b.textContent)).toEqual(['All', 'Movies', 'Series']);
      const ts = tiles();
      expect(ts[0].querySelector('.m-disc-rating')!.textContent).toBe('★ 7.4');
      expect(ts[0].textContent).toContain('Movie');
      expect(el.querySelector('.m-disc-foot')!.textContent).toBe('Data: TMDB');

      act(() => render(null, el));
      clearDiscover();
      fake(() => Promise.reject(codeError('nokey')));
      mount(<Discover />);
      await flush();
      expect(el.textContent).toContain('Movie catalog unavailable');
      expect(el.textContent).toContain('No TMDB key.');
      act(() => button('How to get a key')!.click());
      expect(currentRoute.value).toEqual({ name: 'faq', q: 'tmdb-key' });
    } finally {
      applyLanguageSetting('ru');
    }
  });

  it('English: the switch tabs', async () => {
    applyLanguageSetting('en');
    try {
      fake();
      for (const s of servers.value.slice()) removeServer(s.id);
      setActiveServer(addServer({ url: 'http://srv:8090' }).id);
      vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
      vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
      vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
      mount(<Library />);
      await flush();
      const list = el.querySelector('[role=tablist][aria-label="Catalog"]')!;
      expect(Array.from(list.querySelectorAll('[role=tab]')).map((b) => b.textContent)).toEqual(['Mine', 'Discover']);
    } finally {
      applyLanguageSetting('ru');
    }
  });
});

describe('«Обзор» comes back as it was', () => {
  const SHOW2: CatalogTitle = { kind: 'tv', id: 22, title: 'Copper Valley', original: 'Copper Valley', year: 2026, poster: '', rating: 0 };

  beforeEach(() => {
    for (const s of servers.value.slice()) removeServer(s.id);
    setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  });

  function series() {
    return fake((kind: Kind | 'all', page: number) => {
      if (kind === 'tv') return Promise.resolve({ items: page === 1 ? [SHOW] : [SHOW2], pages: 2 });
      return Promise.resolve({ items: [MOVIE, SHOW, MOVIE2], pages: 1 });
    });
  }

  /** «Сериалы», both pages loaded, a card opened; the screen is unmounted as the title card replaces it. */
  async function leaveFromCard() {
    mount(<Discover />);
    await flush();
    act(() => button('Сериалы')!.click());
    await flush();
    await scrollToEnd();
    expect(tiles().map((b) => b.querySelector('.m-card-title')!.textContent)).toEqual(['Ледяной перевал', 'Copper Valley']);
    act(() => tiles()[1].click());
    expect(currentRoute.value).toEqual({ name: 'title', kind: 'tv', id: 22 });
    act(() => render(null, el));
  }

  it('Back from a title card: the same chip and both pages, with no new request', async () => {
    const nov = series();
    await leaveFromCard();
    const calls = nov.mock.calls.length;
    mount(<Discover />);
    expect(button('Сериалы')!.getAttribute('aria-pressed')).toBe('true');
    expect(tiles().length).toBe(2);
    await flush();
    expect(tiles().length).toBe(2);
    expect(nov.mock.calls.length).toBe(calls);
  });

  it('another server, another language or an old feed: fetched again from «Все»', async () => {
    const nov = series();
    await leaveFromCard();
    setActiveServer(addServer({ url: 'http://other:8090' }).id);
    nov.mockClear();
    mount(<Discover />);
    await flush();
    expect(nov).toHaveBeenCalledWith('all', 1);
    expect(button('Все')!.getAttribute('aria-pressed')).toBe('true');
    expect(tiles().length).toBe(3);
    act(() => render(null, el));

    // the language
    applyLanguageSetting('en');
    try {
      nov.mockClear();
      mount(<Discover />);
      await flush();
      expect(nov).toHaveBeenCalledWith('all', 1);
      act(() => render(null, el));
    } finally {
      applyLanguageSetting('ru');
    }

    // 15 minutes later
    mount(<Discover />);
    await flush();
    act(() => render(null, el));
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + DISCOVER_TTL_MS + 1000);
    nov.mockClear();
    mount(<Discover />);
    await flush();
    expect(nov).toHaveBeenCalledWith('all', 1);
  });

  it('a failed load is not kept', async () => {
    const nov = fake(() => Promise.reject(codeError('offline')));
    mount(<Discover />);
    await flush();
    act(() => render(null, el));
    nov.mockClear();
    mount(<Discover />);
    await flush();
    // nothing was kept from a failed load: the next visit asks again
    expect(nov).toHaveBeenCalledWith('all', 1);
  });
});

describe('«Обзор»: sort, filters, title and year', () => {
  const stored = () => JSON.parse(localStorage.getItem('tsp.discoverQuery') || 'null');
  const sortBtn = () => el.querySelector('.m-disc-head .m-sort') as HTMLButtonElement;
  const filtersBtn = () => el.querySelector('.m-disc-filters') as HTMLButtonElement;
  const sheet = () => document.querySelector('.m-sheet') as HTMLElement | null;
  const inSheet = (text: string) => Array.from(sheet()!.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === text) as HTMLButtonElement;

  it('under each poster: the type and the year («Фильм · 2026»), the type alone without a year', async () => {
    fake(() => Promise.resolve({ items: [MOVIE, SHOW, { ...MOVIE2, year: 0 }], pages: 1 }));
    mount(<Discover />);
    await flush();
    expect(tiles().map((b) => b.querySelector('.m-disc-meta')!.textContent)).toEqual(['Фильм · 2026', 'Сериал · 2026', 'Фильм']);
    expect(tiles()[0].querySelector('.m-disc-title')!.textContent).toBe('Полуночный архив');
  });

  it('the title is clamped to exactly two lines (no third line peeking out), also with 3 posters per row', () => {
    const css = readFileSync(join('mobile', 'src', 'mobile.css'), 'utf8');
    const rule = (sel: string) => {
      const i = css.indexOf(sel + ' {');
      expect(i).toBeGreaterThanOrEqual(0);
      return css.slice(i, css.indexOf('}', i));
    };
    const two = rule('.m-disc-tile .m-disc-title');
    expect(two).toContain('-webkit-line-clamp: 2');
    expect(two).toContain('display: -webkit-box');
    expect(two).toContain('overflow: hidden');
    expect(two).toContain('line-height: 19px');
    expect(two).toContain('max-height: 38px');
    expect(two).toContain('flex: none');
    const three = rule('.m-cols-3 .m-disc-tile .m-disc-title');
    expect(three).toContain('line-height: 16px');
    expect(three).toContain('max-height: 32px');
    expect(three).toContain('min-height: 0');
    // no two lines kept for a one-line title, no date line kept without a date (no 24px .m-empty padding either)
    expect(two).toContain('min-height: 0');
    expect(rule('.m-disc-when-none')).toContain('display: none');
    expect(rule('.m-disc-when')).not.toContain('min-height');
  });

  it('default «Популярные»; the sort sheet picks «По рейтингу»: kept, page 1 fetched again, scrolled to the top', async () => {
    let top = 0;
    const root = document.documentElement;
    Object.defineProperty(root, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => (top = v) });
    try {
      const nov = fake();
      mount(<Discover />);
      await flush();
      expect(queries[0].sort).toBe('popular');
      expect(sortBtn().getAttribute('aria-label')).toBe('Сортировка: Популярные');
      top = 800;
      act(() => sortBtn().click());
      expect(Array.from(sheet()!.querySelectorAll('.m-opt')).map((b) => b.textContent)).toEqual(['Популярные', 'По рейтингу', 'По дате выхода', 'Самые ожидаемые', 'Скоро в цифре']);
      expect(inSheet('Популярные').getAttribute('aria-pressed')).toBe('true');
      nov.mockClear();
      act(() => inSheet('По рейтингу').click());
      await flush();
      expect(sheet()).toBeNull();
      expect(nov).toHaveBeenCalledWith('all', 1);
      expect(queries[queries.length - 1].sort).toBe('rating');
      expect(stored().sort).toBe('rating');
      expect(top).toBe(0);
      expect(sortBtn().getAttribute('aria-label')).toBe('Сортировка: По рейтингу');
      // the same sort again: nothing new
      nov.mockClear();
      act(() => sortBtn().click());
      act(() => inSheet('По рейтингу').click());
      await flush();
      expect(nov).not.toHaveBeenCalled();
    } finally {
      delete (root as unknown as { scrollTop?: number }).scrollTop;
    }
  });

  it('the filters sheet: genre, year, country, rating; applied on «Показать» as «Фильтры · N»', async () => {
    const nov = fake();
    mount(<Discover />);
    await flush();
    expect(filtersBtn().textContent).toBe('Фильтры');
    act(() => filtersBtn().click());
    const labels = Array.from(sheet()!.querySelectorAll('.m-filter-label')).map((x) => x.textContent);
    expect(labels).toEqual(['Жанр', 'Год', 'Страна / язык', 'Мин. рейтинг']);
    // «Все»: series genres are offered too
    expect(inSheet('Ток-шоу')).toBeTruthy();
    nov.mockClear();
    act(() => inSheet('Драма').click());
    act(() => inSheet('Комедия').click());
    act(() => inSheet('Прошлый').click());
    act(() => inSheet('Корея').click());
    act(() => inSheet('7+').click());
    await flush();
    // nothing is asked while the sheet is open
    expect(nov).not.toHaveBeenCalled();
    act(() => inSheet('Показать').click());
    await flush();
    expect(sheet()).toBeNull();
    expect(nov).toHaveBeenCalledTimes(1);
    const q = queries[queries.length - 1];
    expect(q).toEqual({ sort: 'popular', genres: ['drama', 'comedy'], year: 'last', from: 0, to: 0, country: 'KR', rating: 7 });
    expect(stored()).toEqual(q);
    expect(filtersBtn().textContent).toBe('Фильтры · 5');
    expect(filtersBtn().className).toContain('on');

    // «Сбросить» keeps the sort, clears the filters
    act(() => filtersBtn().click());
    act(() => (sheet()!.querySelector('.m-sheet-head .m-link-btn') as HTMLButtonElement).click());
    act(() => inSheet('Показать').click());
    await flush();
    expect(stored()).toEqual({ sort: 'popular', genres: [], year: 'any', from: 0, to: 0, country: '', rating: 0 });
    expect(filtersBtn().textContent).toBe('Фильтры');
  });

  it('a year range from–to', async () => {
    fake();
    mount(<Discover />);
    await flush();
    act(() => filtersBtn().click());
    act(() => inSheet('Диапазон').click());
    const inputs = sheet()!.querySelectorAll('.m-filter-size input');
    expect(inputs.length).toBe(2);
    act(() => {
      (inputs[0] as HTMLInputElement).value = '1990';
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      (inputs[1] as HTMLInputElement).value = '1999';
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => inSheet('Показать').click());
    await flush();
    expect(stored()).toMatchObject({ year: 'range', from: 1990, to: 1999 });
  });

  it('«Фильмы»: only film genres, plus a chosen series one so it can be turned off', async () => {
    localStorage.setItem('tsp.discoverQuery', JSON.stringify({ genres: ['talk'] }));
    fake();
    mount(<Discover />);
    await flush();
    act(() => button('Фильмы')!.click());
    await flush();
    act(() => filtersBtn().click());
    expect(inSheet('Ужасы')).toBeTruthy();
    expect(inSheet('Новости')).toBeUndefined();
    expect(inSheet('Ток-шоу').getAttribute('aria-pressed')).toBe('true');
  });

  it('the kept sort and filters are used on the next launch; junk is sanitized', async () => {
    localStorage.setItem('tsp.discoverQuery', JSON.stringify({ sort: 'upcoming', genres: ['war', 'bogus'], rating: 99 }));
    fake();
    mount(<Discover />);
    await flush();
    expect(queries[0]).toEqual({ sort: 'upcoming', genres: ['war'], year: 'any', from: 0, to: 0, country: '', rating: 0 });
    expect(sortBtn().getAttribute('aria-label')).toBe('Сортировка: Самые ожидаемые');
    expect(filtersBtn().textContent).toBe('Фильтры · 1');
  });

  it('the kept feed is keyed on the sort and filters: changed ones fetch again on return', async () => {
    for (const s of servers.value.slice()) removeServer(s.id);
    setActiveServer(addServer({ url: 'http://srv:8090' }).id);
    const nov = fake();
    mount(<Discover />);
    await flush();
    act(() => render(null, el));
    nov.mockClear();
    // same query: kept, no request
    mount(<Discover />);
    await flush();
    expect(nov).not.toHaveBeenCalled();
    act(() => render(null, el));
    // the query changed meanwhile (e.g. restored from a backup): fetched again
    localStorage.setItem('tsp.discoverQuery', JSON.stringify({ sort: 'date' }));
    mount(<Discover />);
    await flush();
    expect(nov).toHaveBeenCalledWith('all', 1);
    expect(queries[queries.length - 1].sort).toBe('date');
  });

  it('an empty answer says so', async () => {
    fake(() => Promise.resolve({ items: [], pages: 0 }));
    mount(<Discover />);
    await flush();
    expect(el.querySelector('.m-disc-empty')!.textContent).toBe('Ничего не нашлось');
  });

  it('English: sort sheet, filters sheet and the year line', async () => {
    applyLanguageSetting('en');
    try {
      fake();
      mount(<Discover />);
      await flush();
      expect(tiles()[0].querySelector('.m-disc-meta')!.textContent).toBe('Movie · 2026');
      expect(tiles()[1].querySelector('.m-disc-meta')!.textContent).toBe('Series · 2026');
      expect(sortBtn().getAttribute('aria-label')).toBe('Sort: Popular');
      act(() => sortBtn().click());
      expect(Array.from(sheet()!.querySelectorAll('.m-opt')).map((b) => b.textContent)).toEqual(['Popular', 'Top rated', 'Newest', 'Most anticipated', 'Coming to digital']);
      act(() => inSheet('Top rated').click());
      await flush();
      expect(filtersBtn().textContent).toBe('Filters');
      act(() => filtersBtn().click());
      expect(Array.from(sheet()!.querySelectorAll('.m-filter-label')).map((x) => x.textContent)).toEqual(['Genre', 'Year', 'Country / language', 'Min. rating']);
      act(() => inSheet('Drama').click());
      act(() => inSheet('Show').click());
      await flush();
      expect(filtersBtn().textContent).toBe('Filters · 1');
    } finally {
      applyLanguageSetting('ru');
    }
  });
});

describe('phoneCatalog', () => {
  beforeEach(() => {
    setCatalogClientForTests(null);
    for (const s of servers.value.slice()) removeServer(s.id);
    setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  });

  it('asks the server for its TMDB settings once and reuses the client', async () => {
    const spy = vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue({ APIKey: 'own' });
    const a = await phoneCatalog();
    const b = await phoneCatalog();
    expect(a).toBe(b);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('without any key: novelties fail with nokey, and the server is asked again next time', async () => {
    const spy = vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
    const c = await phoneCatalog();
    await expect(c.novelties('all', 1)).rejects.toMatchObject({ code: 'nokey' });
    await phoneCatalog();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  const answer = (title: string) => ({
    status: 200,
    url: '',
    text: JSON.stringify({ results: [{ id: 5, title, original_title: title, release_date: '2026-03-01', vote_average: 7 }], total_pages: 1 }),
  });

  it('a failed settings read is not kept: «Повторить» reads them again and uses the server key', async () => {
    const settingsSpy = vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValueOnce(null).mockResolvedValue({ APIKey: 'own' });
    const get = vi.spyOn(sourceHttp, 'get').mockImplementation(async () => answer('Полуночный архив'));
    mount(<Discover />);
    await flush();
    expect(el.textContent).toContain(ru.discover.nokeyText);
    expect(get).not.toHaveBeenCalled();
    act(() => button('Повторить')!.click());
    await flush();
    expect(settingsSpy).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalled();
    expect(String(get.mock.calls[0][0])).toContain('api_key=own');
    expect(tiles().length).toBeGreaterThan(0);
  });

  it('a new Discover picks up a changed TMDB mirror of the same server', async () => {
    const settingsSpy = vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue({ APIKey: 'own', APIURL: 'https://mirror-a.test' });
    const get = vi.spyOn(sourceHttp, 'get').mockImplementation(async () => answer('Clockwork Harbor'));
    mount(<Discover />);
    await flush();
    expect(String(get.mock.calls[0][0]).indexOf('https://mirror-a.test/3/')).toBe(0);
    act(() => render(null, el));
    // a later visit: the kept feed has expired
    clearDiscover();
    settingsSpy.mockResolvedValue({ APIKey: 'own', APIURL: 'https://mirror-b.test' });
    get.mockClear();
    mount(<Discover />);
    await flush();
    expect(get).toHaveBeenCalled();
    expect(get.mock.calls.every((c) => String(c[0]).indexOf('https://mirror-b.test/3/') === 0)).toBe(true);
    // the chips and the next pages keep the client of this visit: no extra settings reads
    const reads = settingsSpy.mock.calls.length;
    act(() => button('Фильмы')!.click());
    await flush();
    expect(settingsSpy.mock.calls.length).toBe(reads);
  });

  it('another server gets its own client', async () => {
    const spy = vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue({ APIKey: 'own' });
    const a = await phoneCatalog();
    setActiveServer(addServer({ url: 'http://other:8090' }).id);
    const b = await phoneCatalog();
    expect(a).not.toBe(b);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

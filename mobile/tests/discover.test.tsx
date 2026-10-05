import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';
import { ru } from '../../src/i18n/ru';
import { Discover } from '../src/screens/catalog/Discover';
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
  const c: CatalogClient = {
    novelties,
    search: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    card: vi.fn(() => Promise.reject(codeError('bad'))),
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
  const live = observed.filter((o) => o.el);
  expect(live.length).toBe(1);
  await act(async () => {
    live[0].cb([{ isIntersecting: true, target: live[0].el } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
  });
  await flush();
}

beforeEach(() => {
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
    const chips = Array.from(el.querySelectorAll('.m-disc-chips button')) as HTMLButtonElement[];
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
    expect(observed.filter((o) => o.el).length).toBe(0);
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
      expect(Array.from(el.querySelectorAll('.m-disc-chips button')).map((b) => b.textContent)).toEqual(['All', 'Movies', 'Series']);
      const ts = tiles();
      expect(ts[0].querySelector('.m-disc-rating')!.textContent).toBe('★ 7.4');
      expect(ts[0].textContent).toContain('Movie');
      expect(el.querySelector('.m-disc-foot')!.textContent).toBe('Data: TMDB');

      act(() => render(null, el));
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

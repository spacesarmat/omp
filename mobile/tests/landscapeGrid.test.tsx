import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { GRID_MIN, cardWidth, gridCols, gridTemplate } from '../src/ui/landscapeCols';
import { DISCOVER_COLS_KEY, migrateDiscoverView, readDiscoverCols, saveDiscoverCols } from '../src/screens/catalog/discoverCols';
import { Library } from '../src/screens/Library';
import { Discover } from '../src/screens/catalog/Discover';
import { Person } from '../src/screens/catalog/Person';
import { clearDiscover } from '../src/screens/catalog/discoverCache';
import { DEFAULT_DISCOVER_QUERY } from '../../src/catalog/discoverQuery';
import { saveDiscoverQuery } from '../src/screens/catalog/discoverQueryStore';
import { setCatalogClientForTests, setCatalogMode } from '../src/catalog/phoneCatalog';
import { resetTo } from '../src/nav';
import { updateSettings } from '../../src/store/settings';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { torrents, torrentsAt, libraryTab, libraryQuery, librarySearchOpen } from '../../src/store/library';
import { TorrServerClient } from '../../src/api/torrserver';
import type { CatalogClient } from '../../src/catalog/client';
import type { CatalogTitle, PersonCard } from '../../src/catalog/tmdb';
import type { Torrent } from '../../src/api/types';
import type { LibraryView } from '../../src/lib/libraryView';

const PORTRAIT = { w: 360, h: 800, content: 328 };
const LANDSCAPE = { w: 800, h: 360, content: 768 };
const VIEWS: LibraryView[] = ['large', 'small', 'list', 'compact'];

describe('catalog columns from the content width', () => {
  it('keeps a readable card in portrait and landscape, and grows a short row', () => {
    expect(gridCols(PORTRAIT.content, 'large')).toBe(2);
    expect(gridCols(PORTRAIT.content, 'small')).toBe(3);
    expect(gridCols(LANDSCAPE.content, 'large')).toBe(4);
    expect(gridCols(LANDSCAPE.content, 'small')).toBe(6);
    expect(cardWidth(PORTRAIT.content, 'large')).toBeGreaterThanOrEqual(GRID_MIN.large);
    expect(cardWidth(PORTRAIT.content, 'small')).toBeGreaterThanOrEqual(GRID_MIN.small);
    expect(cardWidth(LANDSCAPE.content, 'large')).toBeGreaterThanOrEqual(GRID_MIN.large);
    expect(cardWidth(LANDSCAPE.content, 'small')).toBeGreaterThanOrEqual(GRID_MIN.small);
    // a phone on its side no longer collapses to a dozen tiny posters
    expect(gridCols(LANDSCAPE.content, 'large')).toBeLessThan(8);
    expect(gridCols(LANDSCAPE.content, 'small')).toBeLessThan(8);
    for (const mode of ['large', 'small'] as const) {
      const tpl = gridTemplate(mode);
      expect(tpl).toContain('auto-fit');
      expect(tpl).toContain('100%');
      expect(tpl).toContain(GRID_MIN[mode] + 'px');
      expect(tpl).not.toContain('repeat(12');
    }
    // narrower than one minimum: one column, the card is the row (auto-fit + 100%)
    expect(gridCols(120, 'large')).toBe(1);
    expect(gridCols(0, 'small')).toBe(1);
  });

  it('migrates the old 2, 3 and 4 column store onto the four modes', () => {
    expect(migrateDiscoverView(2)).toBe('large');
    expect(migrateDiscoverView(3)).toBe('small');
    expect(migrateDiscoverView(4)).toBe('small');
    expect(migrateDiscoverView('list')).toBe('list');
    expect(migrateDiscoverView('compact')).toBe('compact');
    expect(migrateDiscoverView(7)).toBeNull();
    expect(migrateDiscoverView('4')).toBeNull();
    localStorage.setItem(DISCOVER_COLS_KEY, '2');
    expect(readDiscoverCols()).toBe('large');
    expect(localStorage.getItem(DISCOVER_COLS_KEY)).toBe('"large"');
    localStorage.setItem(DISCOVER_COLS_KEY, '4');
    expect(readDiscoverCols()).toBe('small');
    localStorage.setItem(DISCOVER_COLS_KEY, '"compact"');
    expect(readDiscoverCols()).toBe('compact');
    localStorage.setItem(DISCOVER_COLS_KEY, 'garbage');
    expect(readDiscoverCols()).toBe('large');
  });
});

let el: HTMLElement;
let contentWidth = 768;
function mount(node: preact.ComponentChild) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(node, el));
}
async function flush() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}
function windowSize(w: number, h: number, width: number) {
  contentWidth = width;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
}
async function resize() {
  await act(async () => {
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('orientationchange'));
    await new Promise((r) => setTimeout(r, 30));
  });
}
const realW = window.innerWidth;
const realH = window.innerHeight;

const ITEMS: CatalogTitle[] = [
  { kind: 'movie', id: 11, title: 'Midnight Archive', original: 'Midnight Archive', year: 2026, poster: '', rating: 7.2 },
  { kind: 'tv', id: 21, title: 'Frost Pass', original: 'Frost Pass', year: 2026, poster: '', rating: 8 },
];
const PERSON: PersonCard = {
  id: 7,
  name: 'Test Person',
  photo: '',
  birth: '1970-05-01',
  death: '',
  bio: '',
  known: 'acting',
  acting: ITEMS.map((item) => ({ ...item, roles: ['Hero'], genreIds: [18], date: '2026-01-01' })),
  directing: [],
};

function catalog(discover: CatalogClient['discover'], home?: CatalogClient['home']): CatalogClient {
  return {
    novelties: vi.fn(() => Promise.resolve({ items: ITEMS, pages: 1 })),
    discover,
    home: home || vi.fn(() => Promise.resolve([{ id: 'popularMovies' as const, items: ITEMS }])),
    search: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    card: vi.fn(() => Promise.reject(new Error('x'))),
    season: vi.fn(() => Promise.reject(new Error('x'))),
    person: vi.fn(() => Promise.resolve(PERSON)),
    similar: vi.fn(() => Promise.resolve([])),
    posters: vi.fn(() => Promise.resolve([])),
  };
}

describe('«Обзор» four modes, portrait and landscape', () => {
  let discover: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    clearDiscover();
    localStorage.clear();
    saveDiscoverQuery({ ...DEFAULT_DISCOVER_QUERY, sort: 'rating' });
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} takeRecords() { return []; } });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => contentWidth);
    torrents.value = [];
    resetTo({ name: 'library' });
    discover = vi.fn(() => Promise.resolve({ items: ITEMS, pages: 1 }));
    setCatalogClientForTests(catalog(discover as CatalogClient['discover']));
  });
  afterEach(() => {
    act(() => render(null, el));
    setCatalogClientForTests(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: realW });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: realH });
  });

  const grid = () => el.querySelector('[data-view]') as HTMLElement;
  const titles = () => Array.from(el.querySelectorAll('.m-disc-title')).map((n) => n.textContent);

  for (const orient of [PORTRAIT, LANDSCAPE]) {
    const name = orient === PORTRAIT ? 'portrait' : 'landscape';
    for (const view of VIEWS) {
      it(name + ' ' + view + ': the mode is marked, readable, and does not overflow', async () => {
        saveDiscoverCols(view);
        windowSize(orient.w, orient.h, orient.content);
        mount(<Discover />);
        await flush();
        const root = grid();
        expect(root.getAttribute('data-view')).toBe(view);
        expect(el.querySelector('.m-view-btn')!.getAttribute('data-current-view')).toBe(view);
        expect(el.querySelector('.m-view-btn')!.getAttribute('aria-label')).toContain(
          view === 'large' ? 'Большие карточки' : view === 'small' ? 'Средние карточки' : view === 'list' ? 'Список с картинками' : 'Список',
        );
        if (view === 'large' || view === 'small') {
          const mode = view === 'small' ? 'small' : 'large';
          expect(root.style.gridTemplateColumns).toBe(gridTemplate(mode));
          expect(root.getAttribute('data-cols')).toBe(String(gridCols(orient.content, mode)));
          expect(root.querySelectorAll('.m-disc-poster').length).toBe(ITEMS.length);
          expect(root.querySelector('.m-disc-rating')).not.toBeNull();
        } else if (view === 'list') {
          expect(root.classList.contains('m-disc-rows')).toBe(true);
          expect(root.querySelectorAll('.m-vrow').length).toBe(ITEMS.length);
          expect(root.querySelectorAll('.m-disc-poster').length).toBe(ITEMS.length);
          expect(root.style.gridTemplateColumns).toBe('');
        } else {
          expect(root.classList.contains('m-clist')).toBe(true);
          expect(root.querySelectorAll('.m-crow').length).toBe(ITEMS.length);
          expect(root.querySelector('.m-disc-poster')).toBeNull();
          expect(root.textContent).toContain('7,2');
        }
        expect(titles().join(' ')).toContain('Midnight');
      });
    }
  }

  it('rotation reflows the columns and keeps the loaded feed', async () => {
    saveDiscoverCols('large');
    windowSize(LANDSCAPE.w, LANDSCAPE.h, LANDSCAPE.content);
    mount(<Discover />);
    await flush();
    expect(discover).toHaveBeenCalledTimes(1);
    expect(grid().getAttribute('data-cols')).toBe(String(gridCols(LANDSCAPE.content, 'large')));
    const before = titles();
    windowSize(PORTRAIT.w, PORTRAIT.h, PORTRAIT.content);
    await resize();
    expect(grid().getAttribute('data-cols')).toBe(String(gridCols(PORTRAIT.content, 'large')));
    expect(grid().style.gridTemplateColumns).toBe(gridTemplate('large'));
    expect(titles()).toEqual(before);
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it('the view sheet marks the selected mode and keeps it', async () => {
    windowSize(PORTRAIT.w, PORTRAIT.h, PORTRAIT.content);
    mount(<Discover />);
    await flush();
    act(() => (el.querySelector('.m-view-btn') as HTMLElement).click());
    const sheet = document.querySelector('[data-sheet-view]')!;
    const labels = Array.from(sheet.querySelectorAll('[data-view]')).map((b) => ({
      view: b.getAttribute('data-view'),
      text: (b.textContent || '').trim(),
      on: b.getAttribute('aria-checked'),
    }));
    expect(labels).toEqual([
      { view: 'large', text: 'Большие карточки', on: 'true' },
      { view: 'small', text: 'Средние карточки', on: 'false' },
      { view: 'list', text: 'Список с картинками', on: 'false' },
      { view: 'compact', text: 'Список', on: 'false' },
    ]);
    act(() => (sheet.querySelector('[data-view="list"]') as HTMLElement).click());
    await flush();
    expect(readDiscoverCols()).toBe('list');
    expect(el.querySelector('.m-disc-rows')).not.toBeNull();
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it('the homepage uses all four modes in portrait and landscape, and a switch does not reload', async () => {
    const home = vi.fn(() => Promise.resolve([{ id: 'popularMovies' as const, items: ITEMS }]));
    setCatalogClientForTests(catalog(discover as CatalogClient['discover'], home));
    saveDiscoverQuery(DEFAULT_DISCOVER_QUERY);
    for (const orient of [PORTRAIT, LANDSCAPE]) {
      for (const view of VIEWS) {
        saveDiscoverCols(view);
        windowSize(orient.w, orient.h, orient.content);
        mount(<Discover />);
        await flush();
        const root = el.querySelector('.m-disc-home') as HTMLElement;
        expect(root.getAttribute('data-view')).toBe(view);
        const rails = root.querySelectorAll('.m-disc-rail-row');
        const pictures = root.querySelectorAll('.m-vrow .m-disc-poster');
        const plain = root.querySelectorAll('.m-crow');
        if (view === 'large' || view === 'small') {
          expect(rails.length).toBeGreaterThan(0);
          expect(pictures.length).toBe(0);
          expect(plain.length).toBe(0);
          expect(root.style.getPropertyValue('--m-rail-w')).toBe(view === 'large' ? '156px' : '112px');
          expect(root.querySelector('.m-disc-rating, .m-disc-tile')).not.toBeNull();
        } else if (view === 'list') {
          expect(rails.length).toBe(0);
          expect(pictures.length).toBe(ITEMS.length);
          expect(plain.length).toBe(0);
          expect(root.style.getPropertyValue('--m-rail-w')).toBe('');
          expect(root.textContent).toContain('Сериал');
        } else {
          expect(rails.length).toBe(0);
          expect(root.querySelector('.m-disc-poster')).toBeNull();
          expect(plain.length).toBe(ITEMS.length);
          expect(root.textContent).toContain('7,2');
        }
        expect(root.textContent).toContain('Midnight');
        act(() => render(null, el));
      }
    }
    saveDiscoverCols('large');
    windowSize(LANDSCAPE.w, LANDSCAPE.h, LANDSCAPE.content);
    home.mockClear();
    mount(<Discover />);
    await flush();
    expect(home).toHaveBeenCalledTimes(1);
    act(() => (el.querySelector('.m-view-btn') as HTMLElement).click());
    act(() => (document.querySelector('[data-view="list"]') as HTMLElement).click());
    await flush();
    expect(el.querySelector('.m-disc-home .m-vrow .m-disc-poster')).not.toBeNull();
    expect(el.querySelector('.m-disc-rail-row')).toBeNull();
    expect(home).toHaveBeenCalledTimes(1);
    windowSize(PORTRAIT.w, PORTRAIT.h, PORTRAIT.content);
    await resize();
    expect(el.querySelector('.m-disc-home')!.getAttribute('data-view')).toBe('list');
    expect(el.querySelectorAll('.m-vrow .m-disc-poster').length).toBe(ITEMS.length);
    expect(home).toHaveBeenCalledTimes(1);
    act(() => render(null, el));
  });

  it('home rails stay a readable width in landscape, including after a cached feed is not the home', async () => {
    saveDiscoverQuery(DEFAULT_DISCOVER_QUERY);
    saveDiscoverCols('large');
    windowSize(LANDSCAPE.w, LANDSCAPE.h, LANDSCAPE.content);
    mount(<Discover />);
    await flush();
    const home = el.querySelector('.m-disc-home') as HTMLElement;
    expect(home.style.getPropertyValue('--m-rail-w')).toBe('156px');
    act(() => render(null, el));
    saveDiscoverCols('small');
    mount(<Discover />);
    await flush();
    expect((el.querySelector('.m-disc-home') as HTMLElement).style.getPropertyValue('--m-rail-w')).toBe('112px');
  });

  it('person filmography uses the same width rule and the saved list mode', async () => {
    windowSize(LANDSCAPE.w, LANDSCAPE.h, LANDSCAPE.content);
    saveDiscoverCols('large');
    mount(<Person id={7} />);
    await flush();
    const g = () => el.querySelector('[data-cols]') as HTMLElement;
    expect(g().getAttribute('data-cols')).toBe(String(gridCols(LANDSCAPE.content, 'large')));
    act(() => render(null, el));
    saveDiscoverCols('compact');
    mount(<Person id={7} />);
    await flush();
    expect(el.querySelector('.m-disc-poster')).toBeNull();
    expect(el.querySelectorAll('.m-crow').length).toBe(ITEMS.length);
    expect(el.textContent).toContain('Hero');
  });
});

const T: Torrent[] = [
  { hash: 'h1', title: 'Starbound Frontier S02 1080p', poster: 'https://img.test/a.jpg', category: 'tv', stat: 3, torrent_size: 63 * 1024 ** 3, timestamp: 3 },
  { hash: 'h2', title: 'Quiet Signal 2160p', poster: 'https://img.test/b.jpg', category: 'movie', stat: 3, torrent_size: 14.5 * 1024 ** 3, timestamp: 2 },
];

describe('«Мои» four modes, rotation and the cached banner', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const s of servers.value.slice()) removeServer(s.id);
    setActiveServer(addServer({ url: 'http://srv:8090' }).id);
    torrents.value = T;
    torrentsAt.value = new Date(2026, 0, 2, 20, 24).getTime();
    libraryTab.value = 'all';
    libraryQuery.value = '';
    librarySearchOpen.value = false;
    setCatalogMode('mine');
    resetTo({ name: 'library' });
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} takeRecords() { return []; } });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => contentWidth);
    vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue(T);
    vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
    vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
  });
  afterEach(() => {
    act(() => render(null, el));
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    updateSettings({ libraryView: 'large' });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: realW });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: realH });
  });

  const box = () => el.querySelector('[data-view]') as HTMLElement;

  for (const orient of [PORTRAIT, LANDSCAPE]) {
    const name = orient === PORTRAIT ? 'portrait' : 'landscape';
    for (const view of VIEWS) {
      it(name + ' ' + view + ' keeps badges, titles and a full-width grid', async () => {
        windowSize(orient.w, orient.h, orient.content);
        updateSettings({ libraryView: view });
        mount(<Library />);
        await flush();
        const root = box();
        expect(root.getAttribute('data-view')).toBe(view);
        if (view === 'large' || view === 'small') {
          const mode = view === 'small' ? 'small' : 'large';
          expect(root.style.gridTemplateColumns).toBe(gridTemplate(mode));
          expect(root.getAttribute('data-cols')).toBe(String(gridCols(orient.content, mode)));
          expect(Number(root.getAttribute('data-card-min'))).toBeGreaterThanOrEqual(GRID_MIN[mode]);
          expect(root.querySelectorAll('.m-poster').length).toBeGreaterThan(0);
          if (view === 'large') expect(root.textContent).toMatch(/ГБ|MB|GB/);
        } else if (view === 'list') {
          expect(root.querySelectorAll('.m-poster-row').length).toBeGreaterThan(0);
          expect(root.querySelector('.m-badge-inline, .m-badge, .m-poster')).not.toBeNull();
        } else {
          expect(root.querySelector('.m-poster')).toBeNull();
          expect(root.querySelectorAll('.m-crow').length).toBeGreaterThan(0);
        }
        expect(root.textContent).toContain('Starbound');
      });
    }
  }

  it('a failed refresh keeps the cached list, the banner, and landscape cards that are not a tiny strip', async () => {
    vi.spyOn(TorrServerClient.prototype, 'list').mockRejectedValue(new Error('Сервер недоступен'));
    windowSize(LANDSCAPE.w, LANDSCAPE.h, LANDSCAPE.content);
    updateSettings({ libraryView: 'large' });
    mount(<Library />);
    await flush();
    expect(el.textContent).toContain('Каталог недоступен');
    expect(el.textContent).toContain('20:24');
    expect(el.querySelector('.m-warn-row .m-btn')!.textContent).toContain('Повторить');
    const root = box();
    expect(root.getAttribute('data-cols')).toBe(String(gridCols(LANDSCAPE.content, 'large')));
    expect(Number(root.getAttribute('data-card-min'))).toBeGreaterThanOrEqual(GRID_MIN.large);
    expect(root.style.gridTemplateColumns).toContain('auto-fit');
    const calls = (TorrServerClient.prototype.list as ReturnType<typeof vi.fn>).mock.calls.length;
    windowSize(PORTRAIT.w, PORTRAIT.h, PORTRAIT.content);
    await resize();
    expect(box().getAttribute('data-cols')).toBe(String(gridCols(PORTRAIT.content, 'large')));
    expect(box().textContent).toContain('Starbound');
    expect(el.textContent).toContain('Каталог недоступен');
    expect((TorrServerClient.prototype.list as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
  });
});

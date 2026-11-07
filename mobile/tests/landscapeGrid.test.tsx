import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { colsToFit, landscapeCols, visibleHeight, LANDSCAPE_MARGIN, LANDSCAPE_MIN_COLS, LANDSCAPE_ROWS, type CardFit } from '../src/ui/landscapeCols';
import { DISCOVER_FITS, discoverLandscapeCols, saveDiscoverCols, type DiscoverCols } from '../src/screens/catalog/discoverCols';
import { Discover } from '../src/screens/catalog/Discover';
import { Person } from '../src/screens/catalog/Person';
import { clearDiscover } from '../src/screens/catalog/discoverCache';
import { Library, LIBRARY_FITS } from '../src/screens/Library';
import { DEFAULT_DISCOVER_QUERY } from '../../src/catalog/discoverQuery';
import { saveDiscoverQuery } from '../src/screens/catalog/discoverQueryStore';
import { setCatalogClientForTests, setCatalogMode } from '../src/catalog/phoneCatalog';
import { resetTo } from '../src/nav';
import { updateSettings } from '../../src/store/settings';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { torrents, libraryTab, libraryQuery, librarySearchOpen } from '../../src/store/library';
import { TorrServerClient } from '../../src/api/torrserver';
import type { CatalogClient } from '../../src/catalog/client';
import type { CatalogTitle, PersonCard } from '../../src/catalog/tmdb';
import type { Torrent } from '../../src/api/types';

/** The height of a whole card when `width` px are shared by `n` columns. */
function cardHeight(width: number, n: number, fit: CardFit): number {
  const w = (width - fit.gap * (n - 1)) / n;
  return w * fit.aspect + fit.caption;
}

// Galaxy S21 on its side: 800x360 CSS px, a 48px tab bar, 16px screen padding each side
const S21 = { width: 800 - 32, height: 360 - 48 };
// a 915x412 phone (Pixel 7 class)
const WIDE = { width: 915 - 32, height: 412 - 48 };

describe('landscape columns', () => {
  it('the S21 on its side: 12, 13 and 14 posters per row in two-row «Обзор»', () => {
    expect(landscapeCols(S21.width, S21.height, DISCOVER_FITS)).toEqual([12, 13, 14]);
    expect(landscapeCols(WIDE.width, WIDE.height, DISCOVER_FITS)).toEqual([11, 12, 13]);
    expect(landscapeCols(740 - 32, 360 - 48, DISCOVER_FITS)).toEqual([11, 12, 13]);
    // camera cutout and the system bar on the sides, the status bar on top
    expect(landscapeCols(800 - 32 - 80, 360 - 48 - 24, DISCOVER_FITS)).toEqual([12, 13, 14]);
  });

  it('every size with enough room fits one of two rows, and one column fewer would not', () => {
    for (let width = 560; width <= 1400; width += 37) {
      for (let height = 260; height <= 700; height += 23) {
        const rowHeight = height / LANDSCAPE_ROWS;
        for (const fits of [DISCOVER_FITS, LIBRARY_FITS]) {
          const cols = landscapeCols(width, height, fits);
          cols.forEach((n, i) => {
            const fit = fits[i];
            if (rowHeight - fit.caption - 2 * LANDSCAPE_MARGIN > 0) {
              expect(cardHeight(width, n, fit)).toBeLessThanOrEqual(rowHeight - 2 * LANDSCAPE_MARGIN + 0.01);
            } else {
              expect(n).toBe(i === 0 ? LANDSCAPE_MIN_COLS : cols[i - 1] + 1);
            }
            if (i > 0) expect(n).toBeGreaterThan(cols[i - 1]);
          });
          const fit0 = colsToFit(width, rowHeight, fits[0]);
          if (fit0 > LANDSCAPE_MIN_COLS) expect(cardHeight(width, fit0 - 1, fits[0])).toBeGreaterThan(rowHeight - 2 * LANDSCAPE_MARGIN);
        }
      }
    }
  });

  it('the biggest size keeps at least three per row when two tall rows leave extra room', () => {
    expect(landscapeCols(1280 - 32, 1600, DISCOVER_FITS)[0]).toBe(LANDSCAPE_MIN_COLS);
    expect(discoverLandscapeCols(2, 1248, 1600)).toBe(3);
    expect(discoverLandscapeCols(3, 1248, 1600)).toBe(4);
    expect(discoverLandscapeCols(4, 1248, 1600)).toBe(5);
  });

  it('measures free height from the actual grid top to the tab bar', () => {
    const grid = document.createElement('div');
    const nav = document.createElement('nav');
    nav.className = 'm-nav';
    const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 800, width: 800, x: 0, y: top, toJSON() {} }) as DOMRect;
    grid.getBoundingClientRect = () => rect(120, 500);
    nav.getBoundingClientRect = () => rect(360, 48);
    document.body.append(grid, nav);
    try {
      expect(visibleHeight({ current: grid })).toBe(240);
    } finally {
      grid.remove();
      nav.remove();
    }
  });

  it('clamps inverted bounds and does not count off-screen space above the viewport', () => {
    const grid = document.createElement('div');
    const nav = document.createElement('nav');
    nav.className = 'm-nav';
    const rect = (top: number) => ({ top, bottom: top + 48, height: 48, left: 0, right: 800, width: 800, x: 0, y: top, toJSON() {} }) as DOMRect;
    nav.getBoundingClientRect = () => rect(360);
    document.body.append(grid, nav);
    try {
      grid.getBoundingClientRect = () => rect(400);
      expect(visibleHeight({ current: grid })).toBe(0);
      grid.getBoundingClientRect = () => rect(-600);
      expect(visibleHeight({ current: grid })).toBe(360);
    } finally {
      grid.remove();
      nav.remove();
    }
  });

  it('fits two complete rows with compact captions in 240px', () => {
    const fits: CardFit[] = [
      { aspect: 1.5, caption: 48, gap: 12 },
      { aspect: 1.5, caption: 42, gap: 8 },
      { aspect: 1.5, caption: 36, gap: 6 },
    ];
    const height = 240;
    for (let width = 560; width <= 1400; width += 37) {
      const cols = landscapeCols(width, height, fits);
      cols.forEach((n, i) => {
        expect(LANDSCAPE_ROWS * cardHeight(width, n, fits[i])).toBeLessThanOrEqual(height - LANDSCAPE_ROWS * 2 * LANDSCAPE_MARGIN + 0.01);
        if (i > 0) expect(n).toBeGreaterThan(cols[i - 1]);
      });
      const fit0 = colsToFit(width, height / LANDSCAPE_ROWS, fits[0]);
      if (fit0 > LANDSCAPE_MIN_COLS) {
        expect(LANDSCAPE_ROWS * cardHeight(width, fit0 - 1, fits[0])).toBeGreaterThan(height - LANDSCAPE_ROWS * 2 * LANDSCAPE_MARGIN);
      }
    }
  });

  it('a screen too short for any poster still gives a sane number', () => {
    expect(colsToFit(700, 50, DISCOVER_FITS[0])).toBe(1);
    expect(landscapeCols(700, 50, DISCOVER_FITS)).toEqual([3, 4, 5]);
    expect(colsToFit(0, 300, DISCOVER_FITS[0])).toBe(1);
  });
});

// --- the grids in a landscape window (jsdom has no layout: the window and the grid width are set by hand)
let el: HTMLElement;
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
function windowSize(w: number, h: number, contentWidth: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(contentWidth);
}
function rectAt(top: number, height = 48): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 800, width: 800, x: 0, y: top, toJSON() {} } as DOMRect;
}
function tabBar(top: number): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'm-nav';
  nav.getBoundingClientRect = () => rectAt(top);
  document.body.appendChild(nav);
  return nav;
}
async function resize() {
  await act(async () => {
    window.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 30));
  });
}
const realW = window.innerWidth;
const realH = window.innerHeight;

const ITEMS: CatalogTitle[] = [
  { kind: 'movie', id: 11, title: 'Midnight Archive', original: 'Midnight Archive', year: 2026, poster: '', rating: 7 },
  { kind: 'tv', id: 21, title: 'Frost Pass', original: 'Frost Pass', year: 2026, poster: '', rating: 0 },
];
const PERSON: PersonCard = {
  id: 7,
  name: 'Test Person',
  photo: '',
  birth: '1970-05-01',
  death: '',
  bio: '',
  known: 'acting',
  acting: ITEMS.map((item) => ({ ...item, roles: [], genreIds: [18], date: '2026-01-01' })),
  directing: [],
};

describe('«Обзор» on its side', () => {
  beforeEach(() => {
    clearDiscover();
    localStorage.clear();
    saveDiscoverQuery({ ...DEFAULT_DISCOVER_QUERY, sort: 'rating' });
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} takeRecords() { return []; } });
    torrents.value = [];
    resetTo({ name: 'library' });
    const c: CatalogClient = {
      novelties: vi.fn(() => Promise.resolve({ items: ITEMS, pages: 1 })),
      discover: vi.fn(() => Promise.resolve({ items: ITEMS, pages: 1 })),
      home: vi.fn(() => Promise.resolve([])),
      search: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
      card: vi.fn(() => Promise.reject(new Error('x'))),
      season: vi.fn(() => Promise.reject(new Error('x'))),
      person: vi.fn(() => Promise.reject(new Error('x'))),
      similar: vi.fn(() => Promise.resolve([])),
      posters: vi.fn(() => Promise.resolve([])),
    };
    setCatalogClientForTests(c);
  });
  afterEach(() => {
    act(() => render(null, el));
    setCatalogClientForTests(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: realW });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: realH });
  });
  const grid = () => el.querySelector('.m-disc-grid') as HTMLElement;

  it('portrait: the size classes decide, no inline columns', async () => {
    windowSize(360, 800, 328);
    mount(<Discover />);
    await flush();
    expect(grid().getAttribute('style') || '').toBe('');
  });

  it('switching from the discover home to a grid measures the newly mounted grid', async () => {
    saveDiscoverQuery(DEFAULT_DISCOVER_QUERY);
    windowSize(800, 360, 768);
    mount(<Discover />);
    await flush();
    act(() => (el.querySelector('.m-sort') as HTMLElement).click());
    await flush();
    act(() => (el.querySelectorAll('.m-disc-sort-opt')[1] as HTMLElement).click());
    await flush();
    expect(grid().style.gridTemplateColumns).toBe('repeat(10, minmax(0, 1fr))');
  });

  for (const [cols, want] of [[2, 12], [3, 13], [4, 14]] as [DiscoverCols, number][]) {
    it(`landscape 800x360, size ${cols}: ${want} posters per row and two rows from the grid top`, async () => {
      saveDiscoverCols(cols);
      windowSize(800, 360, 768);
      mount(<Discover />);
      await flush();
      // no tab bar in this test: the whole window height is the screen
      expect(grid().style.gridTemplateColumns).toBe(`repeat(${discoverLandscapeCols(cols, 768, 360)}, minmax(0, 1fr))`);
      expect(discoverLandscapeCols(cols, 768, 312)).toBe(want);
      const nav = tabBar(360);
      grid().getBoundingClientRect = () => rectAt(120, 500);
      try {
        await resize();
        expect(grid().style.gridTemplateColumns).toBe(`repeat(${discoverLandscapeCols(cols, 768, 240)}, minmax(0, 1fr))`);
      } finally {
        nav.remove();
      }
    });
  }

  it('person filmography measures its own grid and clears inline columns in portrait', async () => {
    setCatalogClientForTests({
      novelties: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
      discover: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
      home: vi.fn(() => Promise.resolve([])),
      search: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
      card: vi.fn(() => Promise.reject(new Error('x'))),
      season: vi.fn(() => Promise.reject(new Error('x'))),
      person: vi.fn(() => Promise.resolve(PERSON)),
      similar: vi.fn(() => Promise.resolve([])),
      posters: vi.fn(() => Promise.resolve([])),
    });
    windowSize(800, 360, 768);
    mount(<Person id={7} />);
    await flush();
    const nav = tabBar(360);
    grid().getBoundingClientRect = () => rectAt(120, 500);
    try {
      await resize();
      expect(grid().style.gridTemplateColumns).toBe(`repeat(${discoverLandscapeCols(2, 768, 240)}, minmax(0, 1fr))`);
    } finally {
      nav.remove();
    }
    act(() => render(null, el));
    windowSize(360, 800, 328);
    mount(<Person id={7} />);
    await flush();
    expect(grid().style.gridTemplateColumns).toBe('');
  });

  it('turning the phone back to portrait drops the inline columns', async () => {
    windowSize(800, 360, 768);
    mount(<Discover />);
    await flush();
    expect(grid().style.gridTemplateColumns).not.toBe('');
    windowSize(360, 800, 328);
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(grid().style.gridTemplateColumns).toBe('');
  });

  it('a linked TV: the mini-player does not change the columns (only the tab bar counts)', async () => {
    windowSize(800, 360, 768);
    mount(<Discover />);
    await flush();
    const bar = (cls: string, top: number, height: number) => {
      const n = document.createElement('div');
      n.className = cls;
      n.getBoundingClientRect = () => ({ top, bottom: top + height, height, left: 0, right: 800, width: 800, x: 0, y: top, toJSON() {} }) as DOMRect;
      document.body.appendChild(n);
    };
    bar('m-nav', 312, 48);
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
      await new Promise((r) => setTimeout(r, 30));
    });
    const without = grid().style.gridTemplateColumns;
    expect(without).toBe(`repeat(${discoverLandscapeCols(2, 768, 312)}, minmax(0, 1fr))`);
    bar('m-mini', 240, 64);
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(grid().style.gridTemplateColumns).toBe(without);
  });

  it('a shorter window without the keyboard (split screen) does count: more, smaller posters', async () => {
    windowSize(800, 500, 768);
    mount(<Discover />);
    await flush();
    expect(grid().style.gridTemplateColumns).toBe(`repeat(${discoverLandscapeCols(2, 768, 500)}, minmax(0, 1fr))`);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 360 });
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(grid().style.gridTemplateColumns).toBe(`repeat(${discoverLandscapeCols(2, 768, 360)}, minmax(0, 1fr))`);
    expect(discoverLandscapeCols(2, 768, 360)).toBeGreaterThan(discoverLandscapeCols(2, 768, 500));
  });

  it('the soft keyboard (same width, shorter window) does not shrink the posters', async () => {
    windowSize(800, 360, 768);
    mount(<Discover />);
    await flush();
    const before = grid().style.gridTemplateColumns;
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 180 });
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
      await new Promise((r) => setTimeout(r, 30));
    });
    // 800x180 is still wider than tall: landscape, but the keyboard's height is not taken off
    expect(grid().style.gridTemplateColumns).toBe(before);
  });
});

const T: Torrent[] = [
  { hash: 'h1', title: 'Starbound Frontier S02 1080p', category: 'tv', stat: 3, torrent_size: 1024, timestamp: 3 },
  { hash: 'h2', title: 'Quiet Signal 2160p', category: 'movie', stat: 3, torrent_size: 1024, timestamp: 2 },
];

describe('«Мои» on its side', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const s of servers.value.slice()) removeServer(s.id);
    setActiveServer(addServer({ url: 'http://srv:8090' }).id);
    torrents.value = T;
    libraryTab.value = 'all';
    libraryQuery.value = '';
    librarySearchOpen.value = false;
    setCatalogMode('mine');
    resetTo({ name: 'library' });
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} takeRecords() { return []; } });
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

  it('large and small posters fit two rows from the grid top; portrait and the list views stay untouched', async () => {
    windowSize(800, 360, 768);
    updateSettings({ libraryView: 'large' });
    mount(<Library />);
    await flush();
    const g = () => el.querySelector('.m-grid') as HTMLElement;
    const large = landscapeCols(768, 360, LIBRARY_FITS);
    expect(g().style.gridTemplateColumns).toBe(`repeat(${large[0]}, minmax(0, 1fr))`);
    act(() => updateSettings({ libraryView: 'small' }));
    await flush();
    expect(g().style.gridTemplateColumns).toBe(`repeat(${large[1]}, minmax(0, 1fr))`);
    act(() => updateSettings({ libraryView: 'large' }));
    await flush();

    const compact = landscapeCols(768, 240, LIBRARY_FITS);
    const nav = tabBar(360);
    g().getBoundingClientRect = () => rectAt(120, 500);
    try {
      await resize();
      expect(g().style.gridTemplateColumns).toBe(`repeat(${compact[0]}, minmax(0, 1fr))`);
      act(() => updateSettings({ libraryView: 'small' }));
      await flush();
      expect(g().style.gridTemplateColumns).toBe(`repeat(${compact[1]}, minmax(0, 1fr))`);
      compact.forEach((n, i) => {
        expect(LANDSCAPE_ROWS * cardHeight(768, n, LIBRARY_FITS[i])).toBeLessThanOrEqual(240 - LANDSCAPE_ROWS * 2 * LANDSCAPE_MARGIN + 0.01);
      });
    } finally {
      nav.remove();
    }
    expect(landscapeCols(768, 312, LIBRARY_FITS)).toEqual([13, 14]);

    act(() => render(null, el));
    windowSize(360, 800, 328);
    updateSettings({ libraryView: 'large' });
    mount(<Library />);
    await flush();
    expect(g().style.gridTemplateColumns).toBe('');
  });

  it('remeasures when content above the grid changes its position', async () => {
    let notify = () => {};
    const observed: Element[] = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: ResizeObserverCallback) { notify = () => cb([], {} as ResizeObserver); }
      observe(node: Element) { observed.push(node); }
      unobserve() {}
      disconnect() {}
    });
    windowSize(800, 360, 768);
    updateSettings({ libraryView: 'large' });
    mount(<Library />);
    await flush();
    const g = () => el.querySelector('.m-grid') as HTMLElement;
    const nav = tabBar(360);
    g().getBoundingClientRect = () => rectAt(120, 500);
    await resize();
    try {
      g().getBoundingClientRect = () => rectAt(40, 500);
      expect(observed).toContain(g().parentElement);
      await act(async () => {
        notify();
        await new Promise((r) => setTimeout(r, 30));
      });
      expect(g().style.gridTemplateColumns).toBe('repeat(13, minmax(0, 1fr))');
    } finally {
      nav.remove();
    }
  });
});

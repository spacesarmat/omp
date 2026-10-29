import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { colsToFit, landscapeCols, LANDSCAPE_MARGIN, LANDSCAPE_MIN_COLS, type CardFit } from '../src/ui/landscapeCols';
import { DISCOVER_FITS, discoverLandscapeCols, saveDiscoverCols, type DiscoverCols } from '../src/screens/catalog/discoverCols';
import { Discover } from '../src/screens/catalog/Discover';
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
import type { CatalogTitle } from '../../src/catalog/tmdb';
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
  it('the S21 on its side: 6, 7 and 8 posters per row in «Обзор» (was 2, 3 and 4)', () => {
    expect(landscapeCols(S21.width, S21.height, DISCOVER_FITS)).toEqual([6, 7, 8]);
    expect(landscapeCols(WIDE.width, WIDE.height, DISCOVER_FITS)).toEqual([5, 6, 7]);
    expect(landscapeCols(740 - 32, 360 - 48, DISCOVER_FITS)).toEqual([5, 6, 7]);
    // camera cutout and the system bar on the sides, the status bar on top
    expect(landscapeCols(800 - 32 - 80, 360 - 48 - 24, DISCOVER_FITS)).toEqual([6, 7, 8]);
  });

  it('every size: a whole card fits the height, and one column fewer would not', () => {
    for (let width = 560; width <= 1400; width += 37) {
      for (let height = 260; height <= 700; height += 23) {
        for (const fits of [DISCOVER_FITS, LIBRARY_FITS]) {
          const cols = landscapeCols(width, height, fits);
          cols.forEach((n, i) => {
            expect(cardHeight(width, n, fits[i])).toBeLessThanOrEqual(height - 2 * LANDSCAPE_MARGIN + 0.01);
            if (i > 0) expect(n).toBeGreaterThan(cols[i - 1]);
          });
          const fit0 = colsToFit(width, height, fits[0]);
          if (fit0 > LANDSCAPE_MIN_COLS) expect(cardHeight(width, fit0 - 1, fits[0])).toBeGreaterThan(height - 2 * LANDSCAPE_MARGIN);
        }
      }
    }
  });

  it('the biggest size keeps at least three per row on a tall landscape screen (a tablet)', () => {
    expect(landscapeCols(1280 - 32, 800 - 48, DISCOVER_FITS)[0]).toBe(LANDSCAPE_MIN_COLS);
    expect(discoverLandscapeCols(2, 1248, 752)).toBe(3);
    expect(discoverLandscapeCols(3, 1248, 752)).toBe(4);
    expect(discoverLandscapeCols(4, 1248, 752)).toBe(5);
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
const realW = window.innerWidth;
const realH = window.innerHeight;

const ITEMS: CatalogTitle[] = [
  { kind: 'movie', id: 11, title: 'Midnight Archive', original: 'Midnight Archive', year: 2026, poster: '', rating: 7 },
  { kind: 'tv', id: 21, title: 'Frost Pass', original: 'Frost Pass', year: 2026, poster: '', rating: 0 },
];

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

  for (const [cols, want] of [[2, 6], [3, 7], [4, 8]] as [DiscoverCols, number][]) {
    it(`landscape 800x360, size ${cols}: ${want} posters per row`, async () => {
      saveDiscoverCols(cols);
      windowSize(800, 360, 768);
      mount(<Discover />);
      await flush();
      // no tab bar in this test: the whole window height is the screen
      expect(grid().style.gridTemplateColumns).toBe(`repeat(${discoverLandscapeCols(cols, 768, 360)}, minmax(0, 1fr))`);
      expect(discoverLandscapeCols(cols, 768, 312)).toBe(want);
    });
  }

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

  it('the soft keyboard (same width, shorter window) does not shrink the posters', async () => {
    windowSize(800, 360, 768);
    mount(<Discover />);
    await flush();
    const before = grid().style.gridTemplateColumns;
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

  it('large and small posters: as many per row as fit the height; portrait and the list views untouched', async () => {
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
    // the S21 with its tab bar: 6 large, 7 small (was 2 and 3)
    expect(landscapeCols(768, 312, LIBRARY_FITS)).toEqual([6, 7]);
    act(() => render(null, el));
    windowSize(360, 800, 328);
    updateSettings({ libraryView: 'large' });
    mount(<Library />);
    await flush();
    expect(g().style.gridTemplateColumns).toBe('');
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Library } from '../src/screens/Library';
import { Discover } from '../src/screens/catalog/Discover';
import { clearDiscover } from '../src/screens/catalog/discoverCache';
import { DISCOVER_COLS_KEY, readDiscoverCols } from '../src/screens/catalog/discoverCols';
import {
  pinchScale,
  pinchStepsOf,
  pinchTarget,
  PINCH_MIN,
  PINCH_MAX,
  PINCH_SETTLE_MS,
  PINCH_LIVE_CLASS,
} from '../src/ui/usePinchStep';
import { BACKUP_KEYS } from '../src/lib/backup';
import { setCatalogClientForTests, setCatalogMode } from '../src/catalog/phoneCatalog';
import { currentRoute, resetTo } from '../src/nav';
import { settings, updateSettings } from '../../src/store/settings';
import { zoomView } from '../../src/lib/libraryView';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { torrents, libraryTab, libraryQuery, librarySearchOpen } from '../../src/store/library';
import { reloadProgress, serverViewed } from '../../src/store/progress';
import { TorrServerClient } from '../../src/api/torrserver';
import type { CatalogClient } from '../../src/catalog/client';
import type { CatalogTitle } from '../../src/catalog/tmdb';
import type { Torrent } from '../../src/api/types';

const T: Torrent[] = [
  { hash: 'h1', title: 'Starbound Frontier S02 1080p', category: 'tv', stat: 3, torrent_size: 1024, timestamp: 3 },
  { hash: 'h2', title: 'Quiet Signal 2160p', category: 'movie', stat: 3, torrent_size: 1024, timestamp: 2 },
];
const ITEMS: CatalogTitle[] = [
  { kind: 'movie', id: 11, title: 'Midnight Archive', original: 'Midnight Archive', year: 2026, poster: '', rating: 7 },
  { kind: 'tv', id: 21, title: 'Frost Pass', original: 'Frost Pass', year: 2026, poster: '', rating: 0 },
];

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

type Pt = [number, number];
function touch(target: Element, type: string, pts: Pt[]): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  const list = pts.map(([x, y], i) => ({ identifier: i, clientX: x, clientY: y, target }));
  Object.defineProperty(ev, 'touches', { value: list });
  Object.defineProperty(ev, 'changedTouches', { value: list.slice(-1) });
  act(() => {
    target.dispatchEvent(ev);
  });
  return ev;
}

/** Two fingers 100 px apart, moved to `to` px apart, then lifted. Returns the two-finger move event. */
function pinch(target: Element, to: number): Event {
  touch(target, 'touchstart', [[100, 100]]);
  touch(target, 'touchstart', [[100, 100], [200, 100]]);
  const half = to / 2;
  const mv = touch(target, 'touchmove', [[150 - half, 100], [150 + half, 100]]);
  touch(target, 'touchend', [[150 - half, 100]]);
  touch(target, 'touchend', []);
  return mv;
}

function pointer(target: Element, type: string) {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 10, clientY: 10 }));
  });
}

let vibrate: ReturnType<typeof vi.fn>;
let reduced = true;

beforeEach(() => {
  localStorage.clear();
  vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
  // most tests: reduced motion, so the step lands as the fingers are lifted
  reduced = true;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches: reduced && q.indexOf('reduce') >= 0, media: q, addEventListener() {}, removeEventListener() {} }),
  });
});

describe('pinch step', () => {
  it('the live scale follows the finger distance ratio and is clamped', () => {
    expect(pinchScale(1)).toBe(1);
    expect(pinchScale(1.2)).toBeCloseTo(1.2);
    expect(pinchScale(0.75)).toBeCloseTo(0.75);
    expect(pinchScale(3)).toBe(PINCH_MAX);
    expect(pinchScale(0.1)).toBe(PINCH_MIN);
    expect(pinchScale(NaN)).toBe(1);
    expect(pinchScale(0)).toBe(1);
    expect(pinchScale(Infinity)).toBe(1);
  });

  it('a release picks the nearest step, more than one for a big pinch', () => {
    expect(pinchStepsOf(1)).toBe(0);
    expect(pinchStepsOf(1.1)).toBe(0);
    expect(pinchStepsOf(0.9)).toBe(0);
    expect(pinchStepsOf(1.15)).toBe(1);
    expect(pinchStepsOf(1.3)).toBe(1);
    expect(pinchStepsOf(1.35)).toBe(2);
    expect(pinchStepsOf(1.6)).toBe(3);
    expect(pinchStepsOf(0.86)).toBe(-1);
    expect(pinchStepsOf(0.74)).toBe(-2);
    expect(pinchStepsOf(0.6)).toBe(-3);
    expect(pinchStepsOf(NaN)).toBe(0);
    // kept inside the range
    expect(pinchTarget(1, 4, 1.6)).toBe(3);
    expect(pinchTarget(1, 4, 0.6)).toBe(0);
    expect(pinchTarget(2, 3, 1.2)).toBe(2);
    expect(pinchTarget(1, 3, 1.05)).toBe(1);
  });

  it('the backup keeps four posters per row', () => {
    const k = BACKUP_KEYS.find((x) => x.key === 'tsp.discoverCols')!;
    expect(k.clean(4)).toBe(4);
    expect(k.clean(3)).toBe(3);
    expect(k.clean(5)).toBeUndefined();
    expect(k.clean('4')).toBeUndefined();
  });

  it('steps the library views in the size order and stops at the ends', () => {
    expect(zoomView('compact', 1)).toBe('list');
    expect(zoomView('list', 1)).toBe('small');
    expect(zoomView('small', 1)).toBe('large');
    expect(zoomView('large', 1)).toBe('large');
    expect(zoomView('large', -1)).toBe('small');
    expect(zoomView('small', -1)).toBe('list');
    expect(zoomView('list', -1)).toBe('compact');
    expect(zoomView('compact', -1)).toBe('compact');
  });
});

describe('pinch in «Мои»', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    reloadProgress();
    for (const s of servers.value.slice()) removeServer(s.id);
    setActiveServer(addServer({ url: 'http://srv:8090' }).id);
    torrents.value = T;
    serverViewed.value = [];
    libraryTab.value = 'all';
    libraryQuery.value = '';
    librarySearchOpen.value = false;
    setCatalogMode('mine');
    resetTo({ name: 'library' });
    vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue(T);
    vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
    vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
  });

  afterEach(() => {
    act(() => render(null, el));
    vi.useRealTimers();
    vi.restoreAllMocks();
    updateSettings({ libraryView: 'large' });
  });

  const body = () => el.querySelector('.m-lib-body') as HTMLElement;

  it('spreading the fingers saves the next bigger view, with a short vibration', async () => {
    updateSettings({ libraryView: 'list' });
    mount(<Library />);
    await flush();
    const mv = pinch(body(), 125);
    await flush();
    expect(mv.defaultPrevented).toBe(true);
    expect(settings.value.libraryView).toBe('small');
    expect(el.querySelector('.m-grid.m-view-small')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('tsp.settings') || '{}').libraryView).toBe('small');
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('pinching saves a smaller view; the last finger distance decides how many steps', async () => {
    updateSettings({ libraryView: 'large' });
    mount(<Library />);
    await flush();
    touch(body(), 'touchstart', [[100, 100], [300, 100]]);
    touch(body(), 'touchmove', [[175, 100], [225, 100]]);
    // back out to 160 of 200: 0.8 = one step
    touch(body(), 'touchmove', [[120, 100], [280, 100]]);
    touch(body(), 'touchend', []);
    await flush();
    expect(settings.value.libraryView).toBe('small');
    pinch(body(), 72);
    await flush();
    expect(settings.value.libraryView).toBe('compact');
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('a big spread goes up more than one step, in proportion', async () => {
    updateSettings({ libraryView: 'compact' });
    mount(<Library />);
    await flush();
    pinch(body(), 140);
    await flush();
    expect(settings.value.libraryView).toBe('small');
  });

  it('the list follows the fingers, then settles with an animation and the transform is cleared', async () => {
    reduced = false;
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => setTimeout(() => f(0), 16));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    updateSettings({ libraryView: 'list' });
    mount(<Library />);
    await flush();
    const b = body();
    touch(b, 'touchstart', [[100, 100], [200, 100]]);
    expect(b.style.willChange).toBe('transform');
    expect(document.documentElement.classList.contains(PINCH_LIVE_CLASS)).toBe(true);
    touch(b, 'touchmove', [[90, 100], [210, 100]]);
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(b.style.transform).toBe('scale(1.2000)');
    expect(b.style.transformOrigin).not.toBe('');
    touch(b, 'touchmove', [[0, 100], [300, 100]]);
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(b.style.transform).toBe('scale(' + PINCH_MAX.toFixed(4) + ')');
    // back to 1.2: one step bigger
    touch(b, 'touchmove', [[90, 100], [210, 100]]);
    touch(b, 'touchend', []);
    expect(b.style.transition).toContain(PINCH_SETTLE_MS + 'ms');
    expect(b.style.transform).toBe('scale(1.2500)');
    expect(settings.value.libraryView).toBe('list');
    act(() => {
      vi.advanceTimersByTime(PINCH_SETTLE_MS);
    });
    await flush();
    expect(settings.value.libraryView).toBe('small');
    expect(b.style.transform).toBe('');
    expect(b.style.willChange).toBe('');
    expect(b.style.transition).toBe('transform .25s ease');
    expect(document.documentElement.classList.contains(PINCH_LIVE_CLASS)).toBe(false);
    vi.unstubAllGlobals();
  });

  it('with reduced motion the step lands at once and the transform is cleared', async () => {
    updateSettings({ libraryView: 'list' });
    mount(<Library />);
    await flush();
    const b = body();
    touch(b, 'touchstart', [[100, 100], [200, 100]]);
    touch(b, 'touchmove', [[90, 100], [210, 100]]);
    touch(b, 'touchend', []);
    expect(settings.value.libraryView).toBe('small');
    expect(b.style.transition).not.toContain(PINCH_SETTLE_MS + 'ms');
    await flush();
    expect(b.style.transform).toBe('');
    expect(b.style.willChange).toBe('');
  });

  it('a release short of a step springs back with no change', async () => {
    reduced = false;
    updateSettings({ libraryView: 'list' });
    mount(<Library />);
    await flush();
    const b = body();
    pinch(b, 110);
    expect(b.style.transform).toBe('scale(1.0000)');
    act(() => {
      vi.advanceTimersByTime(PINCH_SETTLE_MS);
    });
    await flush();
    expect(b.style.transform).toBe('');
    expect(settings.value.libraryView).toBe('list');
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('does nothing at the ends of the range', async () => {
    updateSettings({ libraryView: 'large' });
    mount(<Library />);
    await flush();
    pinch(body(), 160);
    await flush();
    expect(settings.value.libraryView).toBe('large');
    updateSettings({ libraryView: 'compact' });
    await flush();
    pinch(body(), 50);
    await flush();
    expect(settings.value.libraryView).toBe('compact');
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('a small finger movement changes nothing', async () => {
    updateSettings({ libraryView: 'small' });
    mount(<Library />);
    await flush();
    pinch(body(), 110);
    await flush();
    expect(settings.value.libraryView).toBe('small');
  });

  it('the long press menu and the tap do not fire during a pinch', async () => {
    updateSettings({ libraryView: 'large' });
    mount(<Library />);
    await flush();
    const card = el.querySelector('.m-card') as HTMLElement;
    pointer(card, 'pointerdown');
    touch(card, 'touchstart', [[100, 100]]);
    touch(card, 'touchstart', [[100, 100], [200, 100]]);
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(document.querySelector('.m-sheet')).toBeNull();
    touch(card, 'touchmove', [[110, 100], [190, 100]]);
    touch(card, 'touchend', [[110, 100]]);
    touch(card, 'touchend', []);
    pointer(card, 'pointerup');
    act(() => card.click());
    expect(currentRoute.value.name).toBe('library');
    expect(document.querySelector('.m-sheet')).toBeNull();
    // later taps work as before
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => (el.querySelector('.m-card') as HTMLElement).click());
    expect(currentRoute.value.name).toBe('torrent');
  });

  it('one finger keeps its normal behaviour', async () => {
    updateSettings({ libraryView: 'list' });
    mount(<Library />);
    await flush();
    touch(body(), 'touchstart', [[100, 400]]);
    const mv = touch(body(), 'touchmove', [[100, 300]]);
    touch(body(), 'touchend', []);
    expect(mv.defaultPrevented).toBe(false);
    expect(settings.value.libraryView).toBe('list');
  });
});

describe('pinch in «Обзор»', () => {
  beforeEach(() => {
    clearDiscover();
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} takeRecords() { return []; } });
    torrents.value = [];
    resetTo({ name: 'library' });
    const c: CatalogClient = {
      novelties: vi.fn(() => Promise.resolve({ items: ITEMS, pages: 1 })),
      discover: vi.fn(() => Promise.resolve({ items: ITEMS, pages: 1 })),
      search: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
      card: vi.fn(() => Promise.reject(new Error('x'))),
      season: vi.fn(() => Promise.reject(new Error('x'))),
    };
    setCatalogClientForTests(c);
  });

  afterEach(() => {
    act(() => render(null, el));
    setCatalogClientForTests(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const grid = () => el.querySelector('.m-disc-grid') as HTMLElement;

  it('two posters per row by default; pinching makes three or four and it is kept', async () => {
    mount(<Discover />);
    await flush();
    const root = () => el.querySelector('.m-discover')!;
    expect(grid().classList.contains('m-cols-3')).toBe(false);
    pinch(root(), 80);
    await flush();
    expect(grid().classList.contains('m-cols-3')).toBe(true);
    expect(grid().classList.contains('m-cols-4')).toBe(false);
    expect(localStorage.getItem(DISCOVER_COLS_KEY)).toBe('3');
    expect(vibrate).toHaveBeenCalledTimes(1);
    act(() => render(null, el));
    mount(<Discover />);
    await flush();
    expect(grid().classList.contains('m-cols-3')).toBe(true);
    pinch(root(), 80);
    await flush();
    expect(grid().classList.contains('m-cols-4')).toBe(true);
    expect(localStorage.getItem(DISCOVER_COLS_KEY)).toBe('4');
    pinch(root(), 60);
    await flush();
    expect(vibrate).toHaveBeenCalledTimes(2);
    // a big spread: four straight to two
    pinch(root(), 150);
    await flush();
    expect(grid().classList.contains('m-cols-3')).toBe(false);
    expect(localStorage.getItem(DISCOVER_COLS_KEY)).toBe('2');
    expect(grid().style.transform).toBe('');
  });

  it('only the grid is scaled, not the header', async () => {
    mount(<Discover />);
    await flush();
    const root = el.querySelector('.m-discover') as HTMLElement;
    touch(root, 'touchstart', [[100, 100], [200, 100]]);
    expect(grid().style.willChange).toBe('transform');
    expect(root.style.willChange).toBe('');
    touch(root, 'touchend', []);
    await flush();
    expect(grid().style.willChange).toBe('');
  });

  it('a pinch does not open the title under the fingers', async () => {
    mount(<Discover />);
    await flush();
    const tile = el.querySelector('.m-disc-tile') as HTMLElement;
    pinch(tile, 60);
    act(() => tile.click());
    expect(currentRoute.value.name).toBe('library');
  });

  it('a bad stored value falls back to two', () => {
    for (const bad of ['7', '5', '1', '"3"', 'garbage', '{}', '0', '2.5']) {
      localStorage.setItem(DISCOVER_COLS_KEY, bad);
      expect(readDiscoverCols()).toBe(2);
    }
    localStorage.setItem(DISCOVER_COLS_KEY, '3');
    expect(readDiscoverCols()).toBe(3);
    localStorage.setItem(DISCOVER_COLS_KEY, '4');
    expect(readDiscoverCols()).toBe(4);
  });
});

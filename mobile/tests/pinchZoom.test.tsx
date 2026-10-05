import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Library } from '../src/screens/Library';
import { Discover } from '../src/screens/catalog/Discover';
import { clearDiscover } from '../src/screens/catalog/discoverCache';
import { DISCOVER_COLS_KEY, readDiscoverCols } from '../src/screens/catalog/discoverCols';
import { pinchDir, pinchTarget, PINCH_UP, PINCH_DOWN, PINCH_FLIP_MS, PINCH_MORPH_MS, PINCH_TEXT_DELAY_MS, PINCH_TEXT_MS } from '../src/ui/usePinchStep';
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

/** Element.animate is missing in jsdom: a recording stand-in. */
let animate: ReturnType<typeof vi.fn>;
function mockAnimate() {
  animate = vi.fn(() => ({ cancel: vi.fn() }));
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, writable: true, value: animate });
}
function unmockAnimate() {
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
}
/** requestAnimationFrame on the fake clock. */
function stubFrame() {
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => setTimeout(() => f(0), 1));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
}
/**
 * Cards laid out in a column, 150 px apart (50 px for compact rows): 200 px wide in the large grid, 60 px at three
 * posters, 100 px otherwise. A row's poster is 56 x 84 at (0, 28) in the row; a tile's poster fills its width, 1.4 high.
 */
function cardRect(card: Element): DOMRect {
  const i = Array.prototype.indexOf.call(card.parentElement!.children, card);
  const w = card.closest('.m-view-large') ? 200 : card.closest('.m-cols-3') ? 60 : 100;
  return new DOMRect(0, 10 + i * (card.closest('.m-clist') ? 50 : 150), w, 140);
}
function mockRects() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.hasAttribute('data-poster')) {
      const card = this.closest('[data-anchor]');
      if (!card || !card.parentElement) return new DOMRect(0, 0, 0, 0);
      const c = cardRect(card);
      return this.classList.contains('m-poster-row') ? new DOMRect(0, c.top + 28, 56, 84) : new DOMRect(0, c.top, c.width, c.width * 1.4);
    }
    if (!this.hasAttribute('data-anchor') || !this.parentElement) return new DOMRect(0, 0, 0, 0);
    return cardRect(this);
  });
}
type Frames = Record<string, unknown>[];
const framesOf = (call: unknown[]) => call[0] as Frames;
const optsOf = (call: unknown[]) => call[1] as KeyframeAnimationOptions;

let vibrate: ReturnType<typeof vi.fn>;
let reduced = true;

beforeEach(() => {
  localStorage.clear();
  vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
  // most tests: reduced motion, so the step lands with no animation
  reduced = true;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches: reduced && q.indexOf('reduce') >= 0, media: q, addEventListener() {}, removeEventListener() {} }),
  });
});

describe('pinch step', () => {
  it('a step fires past x1.2 apart or x0.83 together, not before', () => {
    expect(PINCH_UP).toBe(1.2);
    expect(PINCH_DOWN).toBe(0.83);
    expect(pinchDir(1)).toBe(0);
    expect(pinchDir(1.19)).toBe(0);
    expect(pinchDir(0.84)).toBe(0);
    expect(pinchDir(1.2)).toBe(1);
    expect(pinchDir(3)).toBe(1);
    expect(pinchDir(0.83)).toBe(-1);
    expect(pinchDir(0.2)).toBe(-1);
    expect(pinchDir(NaN)).toBe(0);
    expect(pinchDir(0)).toBe(0);
    expect(pinchDir(Infinity)).toBe(0);
    // one step, kept inside the range
    expect(pinchTarget(1, 4, 1)).toBe(2);
    expect(pinchTarget(3, 4, 1)).toBe(3);
    expect(pinchTarget(0, 4, -1)).toBe(0);
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    unmockAnimate();
    updateSettings({ libraryView: 'large' });
  });

  const body = () => el.querySelector('.m-lib-body') as HTMLElement;

  it('one step fires as soon as the fingers pass x1.2, with a vibration, and only once per gesture', async () => {
    updateSettings({ libraryView: 'list' });
    mount(<Library />);
    await flush();
    const b = body();
    touch(b, 'touchstart', [[100, 100]]);
    touch(b, 'touchstart', [[100, 100], [200, 100]]);
    const mv = touch(b, 'touchmove', [[85, 100], [210, 100]]);
    await flush();
    // before the fingers lift
    expect(mv.defaultPrevented).toBe(true);
    expect(settings.value.libraryView).toBe('small');
    expect(el.querySelector('.m-grid.m-view-small')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('tsp.settings') || '{}').libraryView).toBe('small');
    expect(vibrate).toHaveBeenCalledTimes(1);
    // the rest of the gesture is ignored, both ways, but still keeps the page from scrolling
    const more = touch(b, 'touchmove', [[0, 100], [300, 100]]);
    touch(b, 'touchmove', [[140, 100], [160, 100]]);
    touch(b, 'touchend', [[140, 100]]);
    touch(b, 'touchend', []);
    await flush();
    expect(more.defaultPrevented).toBe(true);
    expect(settings.value.libraryView).toBe('small');
    expect(vibrate).toHaveBeenCalledTimes(1);
    // the next gesture steps again
    pinch(b, 80);
    await flush();
    expect(settings.value.libraryView).toBe('list');
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('a big pinch is still one step', async () => {
    updateSettings({ libraryView: 'compact' });
    mount(<Library />);
    await flush();
    pinch(body(), 300);
    await flush();
    expect(settings.value.libraryView).toBe('list');
  });

  it('nothing is scaled while the fingers move', async () => {
    reduced = false;
    mockAnimate();
    stubFrame();
    updateSettings({ libraryView: 'small' });
    mount(<Library />);
    await flush();
    const b = body();
    const transforms = () =>
      [b, ...Array.from(b.querySelectorAll<HTMLElement>('*'))].map((x) => x.style.transform).filter(Boolean);
    touch(b, 'touchstart', [[100, 100], [200, 100]]);
    touch(b, 'touchmove', [[95, 100], [210, 100]]);
    expect(transforms()).toEqual([]);
    expect(b.style.willChange).toBe('');
    touch(b, 'touchmove', [[80, 100], [220, 100]]);
    act(() => {
      vi.advanceTimersByTime(20);
    });
    await flush();
    expect(settings.value.libraryView).toBe('large');
    expect(transforms()).toEqual([]);
    touch(b, 'touchend', []);
  });

  it('after the change the cards on screen move from their old place to the new one (FLIP)', async () => {
    reduced = false;
    mockAnimate();
    stubFrame();
    mockRects();
    updateSettings({ libraryView: 'small' });
    mount(<Library />);
    await flush();
    const cards = Array.from(el.querySelectorAll('.m-card'));
    expect(cards.length).toBe(2);
    pinch(body(), 130);
    expect(settings.value.libraryView).toBe('large');
    // played in the next frame, after the new layout rendered
    expect(animate).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    await flush();
    const now = Array.from(el.querySelectorAll('.m-card'));
    expect(now).toEqual(cards);
    expect(animate).toHaveBeenCalledTimes(now.length);
    for (const call of animate.mock.calls) {
      const f = framesOf(call);
      expect(String(f[0].transform)).toContain('scale(0.5000)');
      expect(f[1].transform).toBe('none');
      expect(optsOf(call).duration).toBe(PINCH_FLIP_MS);
    }
    expect(animate.mock.contexts).toEqual(now);
  });

  it('from rows to poster tiles each poster morphs from its old box and the rest of the card fades in', async () => {
    reduced = false;
    mockAnimate();
    stubFrame();
    mockRects();
    updateSettings({ libraryView: 'list' });
    mount(<Library />);
    await flush();
    expect(el.querySelectorAll('.m-vrow [data-poster]').length).toBe(2);
    pinch(body(), 130);
    // the step lands at once, nothing fades out first
    expect(settings.value.libraryView).toBe('small');
    expect(animate).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    await flush();
    const cards = Array.from(el.querySelectorAll<HTMLElement>('.m-card'));
    expect(cards.length).toBe(2);
    const calls = animate.mock.calls.map((c, k) => ({ el: animate.mock.contexts[k] as HTMLElement, f: framesOf(c), o: optsOf(c) }));
    for (const card of cards) {
      const hash = card.getAttribute('data-anchor')!;
      const poster = card.querySelector('[data-poster]') as HTMLElement;
      expect(poster.getAttribute('data-poster')).toBe(hash);
      // the poster: from the 56 x 84 thumbnail 28 px down the row to the 100 x 140 tile poster
      const p = calls.filter((x) => x.el === poster);
      expect(p.length).toBe(1);
      expect(p[0].f[0].transform).toBe('translate(0.0px,28.0px) scale(0.5600,0.6000)');
      expect(p[0].f[0].transformOrigin).toBe('0 0');
      expect(p[0].f[1].transform).toBe('none');
      expect(p[0].o.duration).toBe(PINCH_MORPH_MS);
      // the rest of the card fades in a little later; the card itself is not moved
      const text = calls.filter((x) => x.el !== poster && card.contains(x.el));
      expect(text.length).toBeGreaterThan(0);
      expect(text.some((x) => x.el.classList.contains('m-card-title'))).toBe(true);
      for (const x of text) {
        expect(x.f).toEqual([{ opacity: 0 }, { opacity: 1 }]);
        expect(x.o.delay).toBe(PINCH_TEXT_DELAY_MS);
        expect(x.o.duration).toBe(PINCH_TEXT_MS);
      }
      expect(calls.some((x) => x.el === card)).toBe(false);
    }
    // nothing else moves: only the posters carry a transform
    expect(calls.filter((x) => x.f.some((f) => 'transform' in f)).map((x) => x.el)).toEqual(cards.map((c) => c.querySelector('[data-poster]')));
  });

  it('and back: the tile posters shrink into the row thumbnails', async () => {
    reduced = false;
    mockAnimate();
    stubFrame();
    mockRects();
    updateSettings({ libraryView: 'small' });
    mount(<Library />);
    await flush();
    pinch(body(), 70);
    expect(settings.value.libraryView).toBe('list');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    await flush();
    const posters = Array.from(el.querySelectorAll('.m-vrow [data-poster]'));
    expect(posters.length).toBe(2);
    const moved = animate.mock.calls.map((c, k) => ({ el: animate.mock.contexts[k], f: framesOf(c) })).filter((x) => x.f.some((f) => 'transform' in f));
    expect(moved.map((x) => x.el)).toEqual(posters);
    for (const x of moved) expect(x.f[0].transform).toBe('translate(0.0px,-28.0px) scale(1.7857,1.6667)');
  });

  it('between two row views the rows move FLIP style, like the poster grids', async () => {
    reduced = false;
    mockAnimate();
    stubFrame();
    mockRects();
    updateSettings({ libraryView: 'list' });
    mount(<Library />);
    await flush();
    pinch(body(), 70);
    expect(settings.value.libraryView).toBe('compact');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    await flush();
    const rows = Array.from(el.querySelectorAll('.m-clist [data-anchor]'));
    expect(rows.length).toBe(2);
    // the first row stays put; the second comes from 150 px down to 50 px down
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.contexts[0]).toBe(rows[1]);
    const f = framesOf(animate.mock.calls[0]);
    expect(f[0].transform).toBe('translate(0.0px,100.0px) scale(1.0000)');
    expect(f[1].transform).toBe('none');
    expect(optsOf(animate.mock.calls[0]).duration).toBe(PINCH_FLIP_MS);
  });

  it('a pinch that lands on a row view and one more in the same gesture: still one step, one set of animations', async () => {
    reduced = false;
    mockAnimate();
    stubFrame();
    mockRects();
    updateSettings({ libraryView: 'list' });
    mount(<Library />);
    await flush();
    const b = body();
    touch(b, 'touchstart', [[100, 100], [200, 100]]);
    touch(b, 'touchmove', [[85, 100], [215, 100]]);
    touch(b, 'touchmove', [[0, 100], [300, 100]]);
    touch(b, 'touchend', []);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    await flush();
    expect(settings.value.libraryView).toBe('small');
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls.filter((c) => framesOf(c).some((f) => 'transform' in f)).length).toBe(2);
  });
  it('with reduced motion the view switches at once, with no animation', async () => {
    mockAnimate();
    mockRects();
    updateSettings({ libraryView: 'list' });
    mount(<Library />);
    await flush();
    const b = body();
    touch(b, 'touchstart', [[100, 100], [200, 100]]);
    touch(b, 'touchmove', [[90, 100], [210, 100]]);
    expect(settings.value.libraryView).toBe('small');
    touch(b, 'touchend', []);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    await flush();
    expect(animate).not.toHaveBeenCalled();
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
    pinch(body(), 115);
    pinch(body(), 85);
    await flush();
    expect(settings.value.libraryView).toBe('small');
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('the long press menu and the tap do not fire during or right after a pinch', async () => {
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
    touch(card, 'touchmove', [[105, 100], [195, 100]]);
    touch(card, 'touchend', [[105, 100]]);
    touch(card, 'touchend', []);
    pointer(card, 'pointerup');
    act(() => card.click());
    expect(currentRoute.value.name).toBe('library');
    expect(document.querySelector('.m-sheet')).toBeNull();
    // a step down: a tap on the new view right after it is still swallowed
    pinch(body(), 70);
    await flush();
    expect(settings.value.libraryView).toBe('small');
    act(() => (el.querySelector('.m-card') as HTMLElement).click());
    expect(currentRoute.value.name).toBe('library');
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
    unmockAnimate();
  });

  const grid = () => el.querySelector('.m-disc-grid') as HTMLElement;

  it('two posters per row by default; one pinch makes three, the next four, and it is kept', async () => {
    mount(<Discover />);
    await flush();
    const root = () => el.querySelector('.m-discover')!;
    expect(grid().classList.contains('m-cols-3')).toBe(false);
    pinch(root(), 60);
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
    // the end of the range
    pinch(root(), 50);
    await flush();
    expect(vibrate).toHaveBeenCalledTimes(2);
    // a big spread is still one step: four to three
    pinch(root(), 250);
    await flush();
    expect(grid().classList.contains('m-cols-4')).toBe(false);
    expect(grid().classList.contains('m-cols-3')).toBe(true);
    expect(localStorage.getItem(DISCOVER_COLS_KEY)).toBe('3');
    expect(grid().style.transform).toBe('');
  });

  it('the posters move to their new place by their TMDB key; nothing is scaled during the gesture', async () => {
    reduced = false;
    mockAnimate();
    mockRects();
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => setTimeout(() => f(0), 1));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    mount(<Discover />);
    await flush();
    const root = el.querySelector('.m-discover') as HTMLElement;
    touch(root, 'touchstart', [[100, 100], [200, 100]]);
    touch(root, 'touchmove', [[95, 100], [205, 100]]);
    expect(grid().style.transform).toBe('');
    expect(root.style.transform).toBe('');
    touch(root, 'touchmove', [[110, 100], [190, 100]]);
    touch(root, 'touchend', []);
    await flush();
    expect(grid().classList.contains('m-cols-3')).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    await flush();
    const tiles = Array.from(el.querySelectorAll('.m-disc-tile'));
    expect(tiles.length).toBe(2);
    expect(animate.mock.contexts).toEqual(tiles);
    expect(grid().style.transform).toBe('');
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

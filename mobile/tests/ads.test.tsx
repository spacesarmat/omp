import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Library } from '../src/screens/Library';
import { Discover } from '../src/screens/catalog/Discover';
import { clearDiscover } from '../src/screens/catalog/discoverCache';
import { setCatalogClientForTests, setCatalogMode } from '../src/catalog/phoneCatalog';
import { saveDiscoverQuery } from '../src/screens/catalog/discoverQueryStore';
import { DEFAULT_DISCOVER_QUERY } from '../../src/catalog/discoverQuery';
import { saveDiscoverCols } from '../src/screens/catalog/discoverCols';
import { resetTo } from '../src/nav';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { torrents, libraryTab, libraryQuery, librarySearchOpen } from '../../src/store/library';
import { reloadProgress, serverViewed } from '../../src/store/progress';
import { settings, updateSettings } from '../../src/store/settings';
import { TorrServerClient } from '../../src/api/torrserver';
import { cachedAdsConfig, pickBanner, saveAdsConfig, type AdBanner } from '../../src/ads/ads';
import { pendingAdEvents, resetAdEvents } from '../../src/ads/events';
import { adsConfig, setAdsIo } from '../src/ads/phoneAds';
import { markAdImagesLoaded } from '../src/ads/useAdSlots';
import { ACCESS_KEY, ompSubscribed, saveBillingAccess } from '../../src/billing/entitlement';
import { emitBillingChange, saveBillingSession } from '../../src/billing/session';
import type { Torrent } from '../../src/api/types';
import type { CatalogClient } from '../../src/catalog/client';
import type { CatalogTitle } from '../../src/catalog/tmdb';

const DAY = 24 * 60 * 60 * 1000;
const IMG = 'https://billing.omp-player.online/v1/ads/img/' + 'a'.repeat(24);
const BANNER = {
  id: 'abc123def456',
  title: 'ТВ-приставка со скидкой',
  text: 'Доставка за день',
  advertiser: 'ООО Ромашка',
  erid: '2SDnjcVm1aB',
  url: 'https://shop.example/tv?erid=2SDnjcVm1aB',
  image: '/v1/ads/img/' + 'a'.repeat(24),
  weight: 1,
  from: null,
  to: null,
  platforms: ['phone'],
  sections: ['mine', 'discoverGrid', 'discoverRails'],
  tvMode: 'qr',
};
const CONFIG = {
  v: 1,
  enabled: true,
  provider: 'house',
  everyN: 10,
  firstAfter: 10,
  afterInstallDays: 3,
  maxPerScreen: 1,
  railsEvery: 3,
  sections: { mine: true, discoverGrid: true, discoverRails: true },
  platforms: { phone: true, androidTv: false, webos: false },
  hideForSubscribers: true,
  tvHideIfLinkedSubscriber: true,
  minAppVersion: '',
  banners: [BANNER],
  ttlSec: 300,
};

const T: Torrent[] = Array.from({ length: 25 }, (_, i) => ({
  hash: 'h' + i,
  title: 'Фильм номер ' + (i + 1) + ' (2026)',
  category: 'movie',
  stat: 3,
  torrent_size: 1024 ** 3,
  timestamp: 100 - i,
}));

class FakeObserver {
  constructor(_cb: IntersectionObserverCallback) {}
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

/** Fires as soon as a cell is observed, the way a visible cell does in the browser. */
class VisibleObserver {
  cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe(el: Element) {
    this.cb([{ isIntersecting: true, intersectionRatio: 1, target: el } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

let el: HTMLElement;
let top = 2000;
let get: ReturnType<typeof vi.fn<() => Promise<{ status: number; text: string }>>>;

async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

function mount(node: preact.ComponentChild) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(node, el));
}

beforeEach(() => {
  localStorage.clear();
  resetAdEvents();
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  // an install from 10 days ago: past the 3 days without ads
  localStorage.setItem('tsp.firstRun', String(Date.now() - 10 * DAY));
  saveAdsConfig(CONFIG);
  adsConfig.value = { ...adsConfig.value };
  get = vi.fn<() => Promise<{ status: number; text: string }>>(async () => ({ status: 200, text: JSON.stringify(CONFIG) }));
  setAdsIo({ get, post: vi.fn(async () => ({ status: 200 })) });
  markAdImagesLoaded([IMG]);
  top = 2000;
  // every card is below the screen unless a test says otherwise
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ top, bottom: top + 100, left: 0, right: 100, width: 100, height: 100, x: 0, y: top, toJSON: () => ({}) }) as DOMRect);
  reloadProgress();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  torrents.value = T;
  serverViewed.value = [];
  libraryTab.value = 'all';
  libraryQuery.value = '';
  librarySearchOpen.value = false;
  setCatalogMode('mine');
  updateSettings({ libraryView: 'large' });
  resetTo({ name: 'library' });
  vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue(T);
  vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
});

afterEach(() => {
  act(() => render(null, el));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setAdsIo(null);
  setCatalogClientForTests(null);
  setCatalogMode('mine');
});

const adIndex = (list: Element) => Array.from(list.children).findIndex((c) => c.classList.contains('m-ad') || c.classList.contains('m-ad-wrap'));

describe('ads in «Мои»', () => {
  it('a card-size cell after the 10th card, then every 10 (wider when a screen holds more), in every view', async () => {
    mount(<Library />);
    await flush();
    await flush();
    const grid = el.querySelector('.m-grid.m-view-large')!;
    // 25 cards: after the 10th and the 20th
    expect(grid.querySelectorAll('.m-ad')).toHaveLength(2);
    expect(adIndex(grid)).toBe(10);
    expect(grid.children[21].classList.contains('m-ad')).toBe(true);
    const cell = grid.querySelector('.m-ad')!;
    expect(cell.classList.contains('m-card')).toBe(true);
    expect(cell.querySelector('.m-ad-badge')!.textContent).toBe('Реклама');
    expect(cell.querySelector('.m-card-title')!.textContent).toBe(BANNER.title);
    expect(cell.querySelector('.m-ad-who')!.textContent).toBe('ООО Ромашка');
    expect(cell.querySelector('.m-ad-erid')!.textContent).toBe('erid: 2SDnjcVm1aB');
    expect(cell.querySelector('img')!.getAttribute('src')).toBe(IMG);

    // 3 columns and compact hold about 12 cards a screen: the second ad comes after the 22nd
    for (const [view, sel, cls, second] of [
      ['small', '.m-grid.m-view-small', 'm-card', 23],
      ['list', '.m-vlist', 'm-vrow', 21],
      ['compact', '.m-clist', 'm-crow', 23],
    ] as const) {
      act(() => updateSettings({ libraryView: view }));
      await flush();
      const list = el.querySelector(sel)!;
      const at = Array.from(list.children).map((c, i) => (c.classList.contains('m-ad') || c.classList.contains('m-ad-wrap') ? i : -1)).filter((i) => i >= 0);
      expect(at).toEqual([10, second]);
      expect(adIndex(list)).toBe(10);
      expect(list.querySelector('.m-ad')!.classList.contains(cls)).toBe(true);
      expect(list.textContent).toContain('erid: 2SDnjcVm1aB');
    }
    expect(settings.value.libraryView).toBe('compact');
  });

  it('a click opens the advertiser in the browser and counts a click', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    mount(<Library />);
    await flush();
    await flush();
    act(() => (el.querySelector('.m-ad') as HTMLElement).click());
    expect(open).toHaveBeenCalledWith(BANNER.url, '_system');
    expect(pendingAdEvents()).toEqual([{ b: BANNER.id, s: 'mine', p: 'phone', t: 'c', n: 1 }]);
  });

  it('never pushes visible cards: a position already on the screen gets no ad', async () => {
    top = 100;
    mount(<Library />);
    await flush();
    await flush();
    expect(el.querySelectorAll('.m-ad')).toHaveLength(0);
  });

  it('none in History, a search, for a subscriber, in the first days, or when the switch is off', async () => {
    libraryTab.value = 'history';
    mount(<Library />);
    await flush();
    expect(el.querySelectorAll('.m-ad')).toHaveLength(0);
    act(() => render(null, el));

    libraryTab.value = 'all';
    libraryQuery.value = 'Фильм';
    mount(<Library />);
    await flush();
    expect(el.querySelectorAll('.m-grid .m-card').length).toBeGreaterThan(10);
    expect(el.querySelectorAll('.m-ad')).toHaveLength(0);
    act(() => render(null, el));
    libraryQuery.value = '';

    saveBillingSession({ token: 'tok', deviceId: 'd'.repeat(32), paidUntil: Date.now() + 10 * DAY } as never);
    saveBillingAccess({ active: true, accessUntil: Date.now() + 10 * DAY });
    expect(ompSubscribed()).toBe(true);
    mount(<Library />);
    await flush();
    expect(el.querySelectorAll('.m-ad')).toHaveLength(0);
    act(() => render(null, el));
    saveBillingSession(null as never);

    localStorage.setItem('tsp.firstRun', String(Date.now() - DAY));
    mount(<Library />);
    await flush();
    expect(el.querySelectorAll('.m-ad')).toHaveLength(0);
    act(() => render(null, el));

    localStorage.setItem('tsp.firstRun', String(Date.now() - 10 * DAY));
    saveAdsConfig({ v: 1, enabled: false, ttlSec: 300 });
    get.mockImplementation(async () => ({ status: 200, text: JSON.stringify({ v: 1, enabled: false, ttlSec: 300 }) }));
    mount(<Library />);
    await flush();
    await flush();
    expect(el.querySelectorAll('.m-grid .m-card')).toHaveLength(25);
    expect(el.querySelectorAll('.m-ad')).toHaveLength(0);
    act(() => render(null, el));

    // control: the same screen with the switch on shows them again
    saveAdsConfig(CONFIG);
    mount(<Library />);
    await flush();
    await flush();
    expect(el.querySelectorAll('.m-ad').length).toBeGreaterThan(0);
  });

  function subscribe() {
    saveBillingSession({ token: 'tok', deviceId: 'd'.repeat(32), paidUntil: Date.now() + 10 * DAY } as never);
    saveBillingAccess({ active: true, accessUntil: Date.now() + 10 * DAY });
  }

  it('drops the ads when a renewal lands while the catalog stays open', async () => {
    mount(<Library />);
    await flush();
    await flush();
    expect(el.querySelectorAll('.m-ad').length).toBeGreaterThan(0);
    const calls = get.mock.calls.length;
    subscribe();
    act(() => emitBillingChange());
    await flush();
    expect(ompSubscribed()).toBe(true);
    expect(el.querySelectorAll('.m-ad')).toHaveLength(0);
    expect(el.querySelectorAll('.m-grid .m-card').length).toBeGreaterThan(10);
    expect(get.mock.calls.length).toBe(calls);
  });

  it('drops the ads when the app resumes onto a subscription the background check saved', async () => {
    mount(<Library />);
    await flush();
    await flush();
    expect(el.querySelectorAll('.m-ad').length).toBeGreaterThan(0);
    const calls = get.mock.calls.length;
    subscribe();
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(el.querySelectorAll('.m-ad')).toHaveLength(0);
    expect(get.mock.calls.length).toBe(calls);
  });

  it('drops the ads when the background page writes the subscription while the catalog stays open', async () => {
    mount(<Library />);
    await flush();
    await flush();
    expect(el.querySelectorAll('.m-ad').length).toBeGreaterThan(0);
    const calls = get.mock.calls.length;
    subscribe();
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: ACCESS_KEY }));
    });
    await flush();
    expect(ompSubscribed()).toBe(true);
    expect(el.querySelectorAll('.m-ad')).toHaveLength(0);
    expect(el.querySelectorAll('.m-grid .m-card').length).toBeGreaterThan(10);
    expect(get.mock.calls.length).toBe(calls);
  });

  it('counts an impression for a banner that replaces the one already on screen', async () => {
    vi.stubGlobal('IntersectionObserver', VisibleObserver);
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    try {
      mount(<Library />);
      await flush();
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(pendingAdEvents()).toEqual([{ b: BANNER.id, s: 'mine', p: 'phone', t: 'i', n: 2 }]);
      // same image, already loaded: the cell switches at once and the new banner gets its own impression
      const next = { ...BANNER, id: 'bbbbbbbbbbbb', title: 'Другой баннер' };
      saveAdsConfig({ ...CONFIG, banners: [next] });
      act(() => {
        adsConfig.value = cachedAdsConfig();
      });
      await flush();
      expect(el.querySelector('.m-ad .m-card-title')!.textContent).toBe(next.title);
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(pendingAdEvents()).toEqual([
        { b: BANNER.id, s: 'mine', p: 'phone', t: 'i', n: 2 },
        { b: next.id, s: 'mine', p: 'phone', t: 'i', n: 2 },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  /** One slot (every 30), so a weight can move the pick without a second slot staying on the old banner. */
  function oneSlot() {
    saveAdsConfig({ ...CONFIG, everyN: 30 });
    adsConfig.value = cachedAdsConfig();
  }

  /** A weight 1..100 for which this slot's daily pick is `next`, while `BANNER` stays eligible. 0 if none. */
  function weightBeside(next: typeof BANNER): number {
    const now = Date.now();
    for (let w = 1; w <= 100; w++) {
      const candidate = { ...next, weight: w };
      if (pickBanner([BANNER, candidate] as AdBanner[], 'mine:10', now)?.id === candidate.id) return w;
    }
    return 0;
  }

  it('keeps an eligible banner until the replacement image has loaded', async () => {
    const pending: Array<{ onload: (() => void) | null }> = [];
    class Img {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        pending.push(this);
      }
    }
    vi.stubGlobal('Image', Img);
    vi.stubGlobal('IntersectionObserver', VisibleObserver);
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    try {
      oneSlot();
      mount(<Library />);
      await flush();
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      const nextImg = 'https://billing.omp-player.online/v1/ads/img/' + 'b'.repeat(24);
      const next = { ...BANNER, id: 'bbbbbbbbbbbb', title: 'Другой баннер', image: '/v1/ads/img/' + 'b'.repeat(24), weight: 1 };
      const weight = weightBeside(next);
      expect(weight).toBeGreaterThan(0);
      saveAdsConfig({ ...CONFIG, everyN: 30, banners: [BANNER, { ...next, weight }] });
      act(() => {
        adsConfig.value = cachedAdsConfig();
      });
      await flush();
      expect(el.querySelector('.m-ad .m-card-title')!.textContent).toBe(BANNER.title);
      expect(el.querySelector('.m-ad img')!.getAttribute('src')).toBe(IMG);
      expect(pendingAdEvents().map((e) => e.b)).toEqual([BANNER.id]);
      expect(pending.length).toBeGreaterThan(0);
      await act(async () => {
        for (let i = 0; i < pending.length; i++) if (pending[i].onload) pending[i].onload!();
      });
      await flush();
      expect(el.querySelector('.m-ad .m-card-title')!.textContent).toBe('Другой баннер');
      expect(el.querySelector('.m-ad img')!.getAttribute('src')).toBe(nextImg);
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(pendingAdEvents()).toContainEqual({ b: next.id, s: 'mine', p: 'phone', t: 'i', n: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a withdrawn banner without waiting for the replacement image', async () => {
    const pending: Array<{ onload: (() => void) | null; onerror: (() => void) | null }> = [];
    class Img {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        pending.push(this);
      }
    }
    vi.stubGlobal('Image', Img);
    vi.stubGlobal('IntersectionObserver', VisibleObserver);
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    try {
      oneSlot();
      mount(<Library />);
      await flush();
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(el.querySelectorAll('.m-ad')).toHaveLength(1);
      const next = { ...BANNER, id: 'dddddddddddd', title: 'Другой баннер', image: '/v1/ads/img/' + 'd'.repeat(24) };
      saveAdsConfig({ ...CONFIG, everyN: 30, banners: [next] });
      act(() => {
        adsConfig.value = cachedAdsConfig();
      });
      await flush();
      expect(el.querySelectorAll('.m-ad')).toHaveLength(0);
      expect(pendingAdEvents().map((e) => e.b)).toEqual([BANNER.id]);
      expect(pending.length).toBeGreaterThan(0);
      const failed = pending.slice();
      await act(async () => {
        for (let i = 0; i < failed.length; i++) if (failed[i].onerror) failed[i].onerror!();
      });
      await flush();
      expect(el.querySelectorAll('.m-ad')).toHaveLength(0);

      const again = { ...next, id: 'cccccccccccc', image: '/v1/ads/img/' + 'c'.repeat(24) };
      const nextImg = 'https://billing.omp-player.online/v1/ads/img/' + 'c'.repeat(24);
      saveAdsConfig({ ...CONFIG, everyN: 30, banners: [again] });
      act(() => {
        adsConfig.value = cachedAdsConfig();
      });
      await flush();
      expect(el.querySelectorAll('.m-ad')).toHaveLength(0);
      const fresh = pending.filter((img) => failed.indexOf(img) < 0);
      expect(fresh.length).toBeGreaterThan(0);
      await act(async () => {
        for (let i = 0; i < fresh.length; i++) if (fresh[i].onload) fresh[i].onload!();
      });
      await flush();
      expect(el.querySelector('.m-ad .m-card-title')!.textContent).toBe(again.title);
      expect(el.querySelector('.m-ad img')!.getAttribute('src')).toBe(nextImg);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads the server a moment after the screen opens, and never for a subscriber', async () => {
    localStorage.removeItem('tsp.adsConfig');
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    try {
      mount(<Library />);
      await flush();
      expect(get).not.toHaveBeenCalled();
      expect(el.querySelectorAll('.m-ad')).toHaveLength(0);
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      await flush();
      expect(get).toHaveBeenCalledTimes(1);
      await flush();
      expect(el.querySelectorAll('.m-ad').length).toBeGreaterThan(0);
      act(() => render(null, el));

      localStorage.removeItem('tsp.adsConfig');
      get.mockClear();
      saveBillingSession({ token: 'tok', deviceId: 'd'.repeat(32), paidUntil: Date.now() + 10 * DAY } as never);
      saveBillingAccess({ active: true, accessUntil: Date.now() + 10 * DAY });
      expect(ompSubscribed()).toBe(true);
      mount(<Library />);
      await act(async () => {
        vi.advanceTimersByTime(6 * 60 * 1000);
      });
      await flush();
      expect(get).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ads in «Обзор»', () => {
  const items: CatalogTitle[] = Array.from({ length: 30 }, (_, i) => ({ kind: 'movie', id: 100 + i, title: 'Фильм ' + i, original: 'Film ' + i, year: 2026, poster: '', rating: 7 }));
  function fakeCatalog(rails: number) {
    const c = {
      novelties: vi.fn(async () => ({ items: [], pages: 0 })),
      discover: vi.fn(async () => ({ items, pages: 1 })),
      home: vi.fn(async () => Array.from({ length: rails }, (_, i) => ({ id: (['trending', 'popularMovies', 'popularTv', 'nowPlaying', 'upcoming', 'onTheAir'] as const)[i], items: items.slice(0, 6) }))),
      search: vi.fn(async () => ({ items: [], pages: 0 })),
      card: vi.fn(() => Promise.reject(new Error('x'))),
      season: vi.fn(() => Promise.reject(new Error('x'))),
      person: vi.fn(() => Promise.reject(new Error('x'))),
      similar: vi.fn(async () => []),
      posters: vi.fn(async () => []),
    } as unknown as CatalogClient;
    setCatalogClientForTests(c);
  }

  beforeEach(() => clearDiscover());

  it('the feed grid: a poster-size cell in 2, 3 and 4 columns', async () => {
    fakeCatalog(0);
    saveDiscoverQuery({ ...DEFAULT_DISCOVER_QUERY, sort: 'rating' });
    for (const cols of [2, 3, 4] as const) {
      saveDiscoverCols(cols);
      mount(<Discover />);
      await flush();
      await flush();
      const grid = el.querySelector('.m-disc-grid')!;
      // 30 posters: every 10 in 2 columns, 12 in 3, 20 in 4 (about one screen each)
      const at = Array.from(grid.children).map((c, i) => (c.classList.contains('m-ad') ? i : -1)).filter((i) => i >= 0);
      expect(at).toEqual(cols === 2 ? [10, 21] : cols === 3 ? [10, 23] : [10]);
      expect(grid.querySelector('.m-ad')!.classList.contains('m-disc-tile')).toBe(true);
      expect(grid.querySelector('.m-ad .m-ad-badge')!.textContent).toBe('Реклама');
      act(() => render(null, el));
    }
  });

  it('the home: an ad block after the second rail, then after every 3 rails', async () => {
    fakeCatalog(6);
    saveDiscoverQuery(DEFAULT_DISCOVER_QUERY);
    mount(<Discover />);
    await flush();
    await flush();
    const home = el.querySelector('.m-disc-home')!;
    const kids = Array.from(home.children).filter((c) => c.tagName === 'SECTION');
    expect(kids.map((k) => (k.classList.contains('m-ad-rail') ? 'ad' : 'rail'))).toEqual(['rail', 'rail', 'ad', 'rail', 'rail', 'rail', 'ad', 'rail']);
    expect(home.querySelector('.m-ad-rail .m-disc-rail-title')!.textContent).toBe('Реклама');
    expect(home.querySelector('.m-ad-rail')!.textContent).toContain('erid: 2SDnjcVm1aB');
  });
});

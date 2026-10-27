import { tvNoOmp, tvState } from '../src/tv/tvClient';
import { settings, updateSettings } from '../../src/store/settings';
import { describe, it, expect, beforeEach, afterEach, onTestFinished, vi } from 'vitest';
// @ts-ignore node builtins
import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Library } from '../src/screens/Library';
import { SearchMine } from '../src/screens/SearchMine';
import { setWatchActions, noWifi } from '../src/watch';
import { localServer, setLocalServerDeps } from '../src/server/localServer';
import { currentRoute, resetTo } from '../src/nav';
import { reloadTvs, saveTv } from '../src/tv/tvStore';
import { toast } from '../src/ui/toast';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { torrents, torrentsAt, libraryTab, libraryQuery, librarySearchOpen } from '../../src/store/library';
import { saveProgress, reloadProgress, serverViewed } from '../../src/store/progress';
import { TorrServerClient } from '../../src/api/torrserver';
import { posterImageSize } from '../../src/catalog/tmdb';
import { applyLanguageSetting } from '../../src/i18n';
import type { Torrent } from '../../src/api/types';

function files(names: string[]) {
  return JSON.stringify({ TorrServer: { Files: names.map((p, i) => ({ id: i + 1, path: p, length: 1000 })) } });
}

const T: Torrent[] = [
  { hash: 'h1', title: 'Starbound Frontier S02 1080p WEB-DL', category: 'tv', stat: 3, torrent_size: 2 * 1024 ** 3, timestamp: 3, data: files(['S02E01.mkv', 'S02E02.mkv']) },
  { hash: 'h2', title: 'Тихий сигнал 2160p', category: 'movie', stat: 3, torrent_size: 1024 ** 3, timestamp: 2, data: files(['movie.mkv']) },
  { hash: 'h3', title: 'Neon Rivers', category: 'movie', stat: 3, torrent_size: 500 * 1024 ** 2, timestamp: 1 },
];

const byText = (text: string) => Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes(text));

async function flush() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}

let el: HTMLElement;
let listSpy: ReturnType<typeof vi.spyOn>;

function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<Library />, el));
}

/** «История»: the clock in the header (no chip any more). */
function historyButton(): HTMLElement {
  return el.querySelector('[data-lib-history]') as HTMLElement;
}

function tab(label: string): HTMLElement {
  return Array.from(el.querySelectorAll('[role=tab]')).find((b) => b.textContent === label) as HTMLElement;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  localStorage.clear();
  reloadTvs();
  reloadProgress();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  torrents.value = T;
  serverViewed.value = [];
  libraryTab.value = 'all';
  libraryQuery.value = '';
  librarySearchOpen.value = false;
  toast.value = '';
  resetTo({ name: 'library' });
  listSpy = vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue(T);
  vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
  // background poster lookup after a refresh: no TMDB key unless a test sets one
  vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
});

afterEach(() => {
  act(() => render(null, el));
  vi.useRealTimers();
  vi.restoreAllMocks();
  setWatchActions(null);
  setLocalServerDeps(null);
  localServer.value = { supported: false, running: false };
});

describe('Library posters', () => {
  it('after a refresh, looks up posters for torrents without one, each torrent once', async () => {
    vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue({ APIKey: 'k' });
    vi.spyOn(TorrServerClient.prototype, 'get').mockImplementation(async (h: string) => T.find((t) => t.hash === h)!);
    const setPoster = vi.spyOn(TorrServerClient.prototype, 'setPoster').mockResolvedValue(undefined);
    const tmdb = vi.fn(async (u: string) => new Response(JSON.stringify({ results: u.includes('Neon') ? [{ poster_path: '/n.jpg' }] : [] })));
    vi.stubGlobal('fetch', tmdb);
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    mount();
    for (let i = 0; i < 6; i++) await flush();
    expect(tmdb).toHaveBeenCalledTimes(3);
    expect(setPoster).toHaveBeenCalledTimes(1);
    expect(torrents.value.find((t) => t.hash === 'h3')!.poster).toBe('https://imagetmdb.com/t/p/' + posterImageSize() + '/n.jpg');
    expect(JSON.parse(localStorage.getItem('tsp.posterTried')!).sort()).toEqual(['h1', 'h2', 'h3']);
    // the next refresh does not search again
    act(() => render(null, el));
    mount();
    for (let i = 0; i < 6; i++) await flush();
    expect(tmdb).toHaveBeenCalledTimes(3);
  });
});

describe('Library', () => {
  it('renders a grid card per torrent with size and badge', async () => {
    mount();
    await flush();
    const cards = el.querySelectorAll('.m-grid .m-card');
    expect(cards.length).toBe(3);
    expect(cards[0].querySelector('.m-card-title')!.textContent).toBe('Starbound Frontier');
    expect(cards[0].querySelector('.m-card-meta')!.textContent).toBe('2 сезон');
    expect(cards[0].textContent).toContain('2,0 ГБ');
    expect(cards[1].querySelector('.m-badge')!.textContent).toBe('4K');
  });

  it('compact header: the small logo, the «Мои | Обзор» switch, then the icon buttons, all in one row', async () => {
    mount();
    await flush();
    const head = el.querySelector('.m-lib-head')!;
    const brand = head.querySelector('.m-lib-brand')!;
    expect(brand.querySelector('svg.logo')!.getAttribute('width')).toBe('24');
    // no big wordmark: the name is for screen readers only
    expect(head.querySelector('.m-brand-name')).toBeNull();
    expect(brand.querySelector('.m-sr')!.textContent).toBe('OMP');
    const kids = Array.from(head.children);
    const seg = head.querySelector('.m-seg[role=tablist]')!;
    expect(seg).toBeTruthy();
    expect(Array.from(seg.querySelectorAll('[role=tab]')).map((b) => b.textContent)).toEqual(['Мои', 'Обзор']);
    expect(kids.indexOf(brand)).toBe(0);
    expect(kids.indexOf(seg)).toBe(1);
    expect(kids.indexOf(head.querySelector('.m-sort')!)).toBeGreaterThan(1);
    expect(kids.indexOf(head.querySelector('[data-lib-history]')!)).toBeGreaterThan(1);
    // sort and view are one button now
    expect(head.querySelector('.m-view')).toBeNull();
    // the switch is not a separate row any more
    expect(el.querySelectorAll('.m-seg').length).toBe(1);
    expect(seg.parentElement).toBe(head);
  });

  it('shows short titles, the season and episodes on the line under them, in every view and in the search results', async () => {
    const list: Torrent[] = [
      { hash: 's1', title: 'Темная материя / Dark Matter / Сезон: 2 / Серии: 1-6 из 10 (Алик Сахаров) [2026, США, WEB-DL 1080p]', category: 'tv', stat: 3, torrent_size: 3, timestamp: 3 },
      { hash: 's2', title: 'Человек-паук: Новый день / Spider-Man: Brand New Day (2026) WEB-DL 1080p', category: 'movie', stat: 3, torrent_size: 2, timestamp: 2 },
      { hash: 's3', title: 'Мой любимый фильм', category: 'movie', stat: 3, torrent_size: 1, timestamp: 1 },
    ];
    torrents.value = list;
    listSpy.mockResolvedValue(list);
    updateSettings({ librarySort: 'new' });
    const want = ['Темная материя', 'Человек-паук: Новый день', 'Мой любимый фильм'];
    for (const view of ['large', 'small', 'list', 'compact'] as const) {
      updateSettings({ libraryView: view });
      mount();
      await flush();
      const sel = view === 'compact' ? '.m-crow-title' : '.m-card-title';
      expect(Array.from(el.querySelectorAll(sel)).map((n) => n.textContent), view).toEqual(want);
      expect(Array.from(el.querySelectorAll('.m-tile-meta')).map((n) => n.textContent), view).toEqual(['2 сезон · серии 1-6 из 10', '2026']);
      expect(el.querySelector('.m-title-meta'), view).toBeNull();
      act(() => render(null, el));
    }
    updateSettings({ libraryView: 'large' });
    // «Поиск» → «Мои»
    act(() => render(<SearchMine query="spider" onCatalog={() => undefined} onSources={() => undefined} />, el));
    expect(Array.from(el.querySelectorAll('.m-card-title')).map((n) => n.textContent)).toEqual(['Человек-паук: Новый день']);
  });

  it('list rows: the name on its own first line, the meta, the badge and the size on the second; the separator under the whole row', async () => {
    const list: Torrent[] = [
      { hash: 's1', title: 'Американская история преступлений / American Crime Story / Сезон: 1 / Серии: 1-10 из 10 [2016, WEB-DL 1080p]', category: 'tv', stat: 3, torrent_size: 3 * 1024 ** 3, timestamp: 3 },
    ];
    torrents.value = list;
    listSpy.mockResolvedValue(list);
    updateSettings({ libraryView: 'compact' });
    mount();
    await flush();
    const row = el.querySelector('.m-clist .m-crow')!;
    const main = row.querySelector('.m-crow-main')!;
    expect(main.children[0].classList.contains('m-crow-title')).toBe(true);
    expect(main.querySelector('.m-crow-title')!.textContent).toBe('Американская история преступлений');
    const sub = main.querySelector('.m-crow-sub')!;
    expect(Array.from(sub.children).map((c) => c.className.split(' ').filter((x) => /^m-(crow-meta|new-badge|crow-size)$/.test(x))[0])).toEqual([
      'm-crow-meta',
      'm-new-badge',
      'm-crow-size',
    ]);
    // nothing of the second line sits next to the name
    expect(row.querySelector(':scope > .m-crow-size, :scope > .m-new-badge, :scope > .m-crow-meta')).toBeNull();
    const css = (readFileSync('mobile/src/mobile.css', 'utf8') as string).replace(/\r\n/g, '\n');
    const rule = (sel: string) => {
      const i = css.indexOf('\n' + sel + ' {');
      return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
    };
    expect(rule('.m-clist > .m-row-wrap')).toMatch(/border-bottom:/);
    expect(rule('.m-crow')).not.toMatch(/border-bottom:\s*1px/);
    expect(rule('.m-crow')).not.toMatch(/(^|[^-])height:\s*48px/);
    expect(rule('.m-crow-title')).toMatch(/-webkit-line-clamp:\s*2/);
    expect(rule('.m-crow-size')).toMatch(/margin-left:\s*auto/);
  });

  it('English: the meta line is translated', async () => {
    const list: Torrent[] = [{ hash: 's1', title: 'Темная материя / Dark Matter / Сезон: 2 / Серии: 1-6 из 10 [2026, WEB-DL 1080p]', category: 'tv', stat: 3, torrent_size: 3, timestamp: 3 }];
    torrents.value = list;
    listSpy.mockResolvedValue(list);
    updateSettings({ libraryView: 'large' });
    // after updateSettings: saving the settings re-applies their language
    applyLanguageSetting('en');
    onTestFinished(() => applyLanguageSetting('ru'));
    mount();
    await flush();
    expect(el.querySelector('.m-card-title')!.textContent).toBe('Темная материя');
    expect(el.querySelector('.m-card-meta')!.textContent).toBe('season 2 · episodes 1-6 of 10');
    expect(Array.from(el.querySelectorAll('.m-lib-head [role=tab]')).map((b) => b.textContent)).toEqual(['Mine', 'Discover']);
  });

  it('filters by tab and search', async () => {
    mount();
    await flush();
    act(() => tab('Сериалы').click());
    expect(el.querySelectorAll('.m-card').length).toBe(1);
    act(() => tab('Все').click());
    // the search is the «Поиск» tab on «Мои»
    act(() => (el.querySelector('[aria-label="Поиск"]') as HTMLElement).click());
    expect(currentRoute.value).toEqual({ name: 'add', scope: 'mine' });
    act(() => render(<SearchMine query="neon" onCatalog={() => undefined} onSources={() => undefined} />, el));
    const rows = el.querySelectorAll('[data-mine-item]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Neon');
  });

  it('opens a torrent on card tap', async () => {
    mount();
    await flush();
    act(() => (el.querySelector('.m-card') as HTMLElement).click());
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: 'h1' });
  });

  it('TV chip is icon-only: neutral without a TV or when offline, green when connected', async () => {
    mount();
    const chip = () => el.querySelector('.m-tvchip') as HTMLElement;
    expect(chip().getAttribute('aria-label')).toBe('Выбрать телевизор');
    expect(chip().textContent).toBe('');
    act(() => saveTv({ ip: '192.168.1.5', name: 'LG OLED' }));
    expect(chip().getAttribute('aria-label')).toBe('Телевизор «LG OLED» не подключён');
    expect(el.querySelector('.m-tvchip.on')).toBeNull();
    act(() => {
      tvState.value = 'connected';
    });
    expect(chip().getAttribute('aria-label')).toBe('Телевизор «LG OLED» подключён');
    expect(el.querySelector('.m-tvchip.on')).not.toBeNull();
    act(() => chip().click());
    expect(currentRoute.value.name).toBe('tv');
    act(() => {
      tvState.value = 'idle';
    });
  });

  describe('pull to refresh', () => {
    const touch = (type: string, y: number, target: Element = el.querySelector('.m-lib-head')!) => {
      const ev = new Event(type, { bubbles: true, cancelable: true }) as any;
      const t = { clientX: 10, clientY: y };
      ev.touches = type === 'touchend' ? [] : [t];
      ev.changedTouches = [t];
      act(() => {
        target.dispatchEvent(ev);
      });
      return ev as Event;
    };

    it('a long drag from the top reloads the list and shows the pill', async () => {
      mount();
      await flush();
      listSpy.mockClear();
      let release!: (v: Torrent[]) => void;
      listSpy.mockReturnValue(new Promise<Torrent[]>((r) => (release = r)));
      touch('touchstart', 100);
      const mv = touch('touchmove', 260);
      expect(mv.defaultPrevented).toBe(true);
      touch('touchend', 260);
      expect(listSpy).toHaveBeenCalledTimes(1);
      expect(el.querySelector('.m-ptr')!.textContent).toContain('Обновляю…');
      release(T);
      await flush();
      expect(el.querySelector('.m-ptr')).toBeNull();
    });

    it('only the list follows the finger and the icon arms past the threshold', async () => {
      // jsdom has requestAnimationFrame but never paints, so frames are driven by a timer here
      vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => setTimeout(() => f(0), 0));
      vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
      onTestFinished(() => {
        vi.unstubAllGlobals();
      });
      mount();
      await flush();
      touch('touchstart', 100);
      touch('touchmove', 140);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 40));
      });
      // only the list moves; the header with the logo, the tabs and the screen itself stay put
      const body = el.querySelector('.m-lib-body') as HTMLElement;
      expect(body.style.transform).toBe('translateY(20px)');
      expect((el.querySelector('.m-library') as HTMLElement).style.transform).toBe('');
      expect(el.querySelector('.m-lib-pull .m-ptr')).not.toBeNull();
      expect(el.querySelector('.m-lib-head')!.closest('.m-lib-pull')).toBeNull();
      expect(el.querySelector('.m-tabs')!.closest('.m-lib-pull')).toBeNull();
      expect(el.querySelector('.m-ptr')).not.toBeNull();
      expect(el.querySelector('.m-ptr.armed')).toBeNull();
      touch('touchmove', 260);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 40));
      });
      expect(el.querySelector('.m-ptr.armed')).not.toBeNull();
      touch('touchcancel', 260);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 40));
      });
      expect(el.querySelector('.m-ptr')).toBeNull();
    });

    it('a short drag, a drag away from the top and a chip-row drag do nothing', async () => {
      mount();
      await flush();
      listSpy.mockClear();
      touch('touchstart', 100);
      touch('touchend', 150);
      expect(listSpy).not.toHaveBeenCalled();
      const spy = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(300);
      touch('touchstart', 100);
      touch('touchend', 300);
      expect(listSpy).not.toHaveBeenCalled();
      spy.mockRestore();
      touch('touchstart', 100, el.querySelector('.m-tabs')!);
      touch('touchend', 300, el.querySelector('.m-tabs')!);
      expect(listSpy).not.toHaveBeenCalled();
      expect(el.querySelector('.m-ptr')).toBeNull();
    });

    it('works on the history tab too', async () => {
      mount();
      await flush();
      act(() => historyButton().click());
      listSpy.mockClear();
      touch('touchstart', 100);
      touch('touchend', 260);
      expect(listSpy).toHaveBeenCalledTimes(1);
      await flush();
    });
  });

  it('history tab lists started items with a continue-on-TV button', async () => {
    saveProgress('h1', 2, 1394, 3651);
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    const launch = vi.fn().mockResolvedValue(undefined);
    setWatchActions({ recordWatch: async () => undefined, ompVersion: async () => null, reportUrl: async () => null, launchOnTv: launch, remoteDelayMs: 0 });
    mount();
    await flush();
    act(() => historyButton().click());
    const rows = el.querySelectorAll('.m-hrow');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Сезон 2 · Серия 2');
    expect(rows[0].textContent).toContain('23:14');
    act(() => (el.querySelector('[aria-label="Продолжить на ТВ"]') as HTMLElement).click());
    await flush();
    expect(launch).not.toHaveBeenCalled();
    expect(el.querySelector('[role=dialog]')!.textContent).toContain('Продолжить с 23:14');
    expect(el.querySelector('[role=dialog]')!.textContent).toContain('Осталось 38 мин');
    act(() => byText('Продолжить с 23:14')!.click());
    await flush();
    expect(launch).toHaveBeenCalledWith({ server: 'http://srv:8090', torrent: 'h1', file: 2, t: 1394, from: 'Телефон' });
    expect(toast.value).toContain('Запустил на LG OLED');
  });

  it('history play without a TV plays on the phone from the position', async () => {
    saveProgress('h1', 2, 100, 3000);
    const open = vi.fn();
    const launch = vi.fn();
    setWatchActions({ recordWatch: async () => undefined, ompVersion: async () => null, reportUrl: async () => null, launchOnTv: launch, openExternal: open, remoteDelayMs: 0 });
    mount();
    await flush();
    act(() => historyButton().click());
    expect(el.querySelector('[aria-label="Продолжить на ТВ"]')).toBeNull();
    act(() => (el.querySelector('.m-history [aria-label="Продолжить просмотр"]') as HTMLElement).click());
    await flush();
    expect(launch).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
    expect(String(open.mock.calls[0][0])).toContain('link=h1&index=2');
    expect(currentRoute.value.name).toBe('library');
  });

  it('«Продолжить просмотр» on top of «Мои»: a card per started item, «Вся история» opens the history', async () => {
    saveProgress('h1', 2, 1394, 3651);
    mount();
    await flush();
    const row = el.querySelector('[data-code="P02.19"]')!;
    expect(row).toBeTruthy();
    expect(row.querySelector('.m-resume-title')!.textContent).toBe('Продолжить просмотр');
    const cards = row.querySelectorAll('[data-resume-hash]');
    expect(cards.length).toBe(1);
    expect(cards[0].getAttribute('data-resume-hash')).toBe('h1');
    expect(cards[0].textContent).toContain('осталось 38 мин');
    // the chips have no «История» any more
    expect(tab('История')).toBeUndefined();
    act(() => (row.querySelector('[data-code="P02.21"]') as HTMLElement).click());
    expect(libraryTab.value).toBe('history');
    expect(el.querySelector('[data-code="P02.19"]')).toBeNull();
    expect(el.querySelectorAll('.m-history .m-hrow').length).toBe(1);
  });

  it('two releases of one film are one card with «2 раздачи»; a tap opens the release that leads', async () => {
    const list: Torrent[] = [
      { hash: 'f1', title: 'Полуночный архив / Midnight Archive (2026) WEB-DL 1080p', category: 'movie', stat: 3, torrent_size: 2 * 1024 ** 3, timestamp: 3 },
      { hash: 'f2', title: 'Полуночный архив / Midnight Archive (2026) BDRip 2160p', category: 'movie', stat: 3, torrent_size: 1024 ** 3, timestamp: 2 },
      { hash: 'n1', title: 'Neon Rivers (2025) 1080p', category: 'movie', stat: 3, torrent_size: 1, timestamp: 1 },
    ];
    torrents.value = list;
    listSpy.mockResolvedValue(list);
    updateSettings({ libraryView: 'large' });
    mount();
    await flush();
    const cards = el.querySelectorAll('.m-grid .m-card');
    expect(cards.length).toBe(2);
    expect(cards[0].classList.contains('m-film-card')).toBe(true);
    expect(cards[0].querySelector('.m-badge')!.textContent).toBe('2 раздачи');
    // the size of both releases
    expect(cards[0].textContent).toContain('3,0 ГБ');
    act(() => (cards[0] as HTMLElement).click());
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: 'f1' });
  });

  it('shows empty states', async () => {
    torrents.value = [];
    listSpy.mockResolvedValue([]);
    mount();
    await flush();
    expect(el.textContent).toContain('Нет торрентов');
    act(() => historyButton().click());
    expect(el.textContent).toContain('История пуста');
  });

  it('polls every 15 s while mounted and stops after unmount', async () => {
    mount();
    await flush();
    const n = listSpy.mock.calls.length;
    expect(n).toBeGreaterThanOrEqual(1);
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    await flush();
    expect(listSpy.mock.calls.length).toBe(n + 1);
    act(() => render(null, el));
    await act(async () => {
      vi.advanceTimersByTime(60000);
    });
    expect(listSpy.mock.calls.length).toBe(n + 1);
  });

  it('history play ignores repeated taps while launching', async () => {
    saveProgress('h1', 2, 100, 3000);
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    let release!: () => void;
    const launch = vi.fn().mockReturnValue(new Promise<void>((r) => (release = r)));
    setWatchActions({ recordWatch: async () => undefined, ompVersion: async () => null, reportUrl: async () => null, launchOnTv: launch, remoteDelayMs: 0 });
    mount();
    await flush();
    act(() => historyButton().click());
    const b = el.querySelector('[aria-label="Продолжить на ТВ"]') as HTMLElement;
    act(() => b.click());
    act(() => b.click());
    await flush();
    act(() => byText('Сначала')!.click());
    await flush();
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith({ server: 'http://srv:8090', torrent: 'h1', file: 2, t: 0, from: 'Телефон' });
    release();
    await flush();
  });

  it('history play with no OMP on the TV offers the install guide', async () => {
    saveProgress('h1', 2, 100, 3000);
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    setWatchActions({ recordWatch: async () => undefined, ompVersion: async () => null, reportUrl: async () => null, launchOnTv: vi.fn().mockRejectedValue(new Error(tvNoOmp())), remoteDelayMs: 0 });
    mount();
    await flush();
    act(() => historyButton().click());
    act(() => (el.querySelector('[aria-label="Продолжить на ТВ"]') as HTMLElement).click());
    await flush();
    act(() => byText('Сначала')!.click());
    await flush();
    expect(el.textContent).toContain('Как установить OMP на телевизор');
  });

  it('without Wi-Fi a local server launch fails before the player-state server starts', async () => {
    setActiveServer(addServer({ url: 'http://127.0.0.1:8090' }).id);
    saveProgress('h1', 2, 100, 3000);
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    const report = vi.fn().mockResolvedValue('http://192.168.1.9:8123/p');
    const launch = vi.fn().mockResolvedValue(undefined);
    setWatchActions({ recordWatch: async () => undefined, ompVersion: async () => null, reportUrl: report, localIpv4: async () => null, launchOnTv: launch, remoteDelayMs: 0 });
    mount();
    await flush();
    act(() => historyButton().click());
    act(() => (el.querySelector('[aria-label="Продолжить на ТВ"]') as HTMLElement).click());
    await flush();
    act(() => byText('Сначала')!.click());
    await flush();
    expect(el.textContent).toContain(noWifi());
    expect(report).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  it('a stopped phone server can be started from the unavailable state', async () => {
    setActiveServer(addServer({ url: 'http://127.0.0.1:8090' }).id);
    let running = false;
    const start = vi.fn(async () => {
      running = true;
      return { supported: true, running: true };
    });
    setLocalServerDeps({
      native: { localServerInfo: async () => ({ supported: true, running }), startLocalServer: start } as any,
    });
    localServer.value = { supported: true, running: false };
    listSpy.mockImplementation(async () => {
      if (!running) throw new Error('Сервер недоступен');
      return T;
    });
    torrents.value = [];
    mount();
    await flush();
    expect(el.querySelector('.m-offline')).not.toBeNull();
    const n = listSpy.mock.calls.length;
    await act(async () => byText('Запустить сервер')!.click());
    await flush();
    await flush();
    expect(start).toHaveBeenCalledTimes(1);
    expect(listSpy.mock.calls.length).toBeGreaterThan(n);
    expect(el.textContent).not.toContain('Каталог недоступен');
    expect(byText('Запустить сервер')).toBeUndefined();
  });

  it('without the downloaded binary the start leads to the download, never a silent refusal', async () => {
    setActiveServer(addServer({ url: 'http://127.0.0.1:8090' }).id);
    const start = vi.fn(async () => ({ supported: true, running: true }));
    setLocalServerDeps({
      native: {
        localServerInfo: async () => ({ supported: true, running: false, binary: 'missing', downloadBytes: 64174032 }),
        startLocalServer: start,
      } as any,
    });
    localServer.value = { supported: true, running: false, binary: 'missing', downloadBytes: 64174032 };
    listSpy.mockRejectedValue(new Error('Сервер недоступен'));
    torrents.value = [];
    mount();
    await flush();
    expect(el.querySelector('.m-offline')).not.toBeNull();
    expect(byText('Запустить сервер')).toBeUndefined();
    expect(el.querySelector('[data-local="note"]')!.textContent).toBe(
      'TorrServer на телефоне больше не входит в OMP - его нужно один раз скачать.',
    );
    await act(async () => byText('Скачать TorrServer (~61 МБ)')!.click());
    expect(start).not.toHaveBeenCalled();
    expect(currentRoute.value.name).toBe('localServer');
  });

  it('a failed start shows its reason next to the start button', async () => {
    setActiveServer(addServer({ url: 'http://127.0.0.1:8090' }).id);
    setLocalServerDeps({
      native: {
        localServerInfo: async () => ({ supported: true, running: false, binary: 'ready' }),
        startLocalServer: async () => {
          throw new Error('Порт 8090 занят другим приложением');
        },
      } as any,
    });
    localServer.value = { supported: true, running: false, binary: 'ready' };
    listSpy.mockRejectedValue(new Error('Сервер недоступен'));
    torrents.value = [];
    mount();
    await flush();
    await act(async () => byText('Запустить сервер')!.click());
    await flush();
    await flush();
    expect(el.querySelector('[data-local="note"]')!.textContent).toBe('Порт 8090 занят другим приложением');
  });

  it('offers no start for a remote server or a running local one', async () => {
    listSpy.mockRejectedValue(new Error('Сервер недоступен'));
    localServer.value = { supported: true, running: false };
    torrents.value = [];
    mount();
    await flush();
    expect(el.querySelector('.m-offline')).not.toBeNull();
    expect(byText('Запустить сервер')).toBeUndefined();
    act(() => render(null, el));
    setActiveServer(addServer({ url: 'http://127.0.0.1:8090' }).id);
    localServer.value = { supported: true, running: true };
    torrents.value = [];
    mount();
    await flush();
    expect(el.querySelector('.m-offline')).not.toBeNull();
    expect(byText('Запустить сервер')).toBeUndefined();
  });

  it('a cached list with a failed refresh keeps the banner, with no start button for a remote server', async () => {
    torrentsAt.value = new Date(2026, 0, 2, 9, 5).getTime();
    listSpy.mockRejectedValue(new Error('Сервер недоступен'));
    mount();
    await flush();
    expect(el.querySelector('.m-offline')).toBeNull();
    expect(el.textContent).toContain('показан сохранённый список от 09:05');
    expect(byText('Запустить сервер')).toBeUndefined();
  });

  it('one «Вид и сортировка» sheet: the button shows the choice, a pick applies and persists, hidden on history', async () => {
    updateSettings({ librarySort: 'new', libraryView: 'large' });
    mount();
    await flush();
    const chip = () => el.querySelector('.m-sort') as HTMLElement;
    const titles = () => Array.from(el.querySelectorAll('.m-card-title')).map((n) => n.textContent);
    const pick = (sel: string) => act(() => (document.querySelector(sel) as HTMLElement).click());
    expect(chip().getAttribute('aria-label')).toBe('Вид и сортировка: Новые, Крупные постеры');
    expect(chip().querySelector('.m-icon-tag')!.textContent).toBe('нов');
    expect(titles()[0]).toContain('Starbound');
    act(() => chip().click());
    const sheet = document.querySelector('[data-code="PD54"]')!;
    expect(sheet).toBeTruthy();
    expect(sheet.querySelector('[data-sort="new"]')!.getAttribute('aria-checked')).toBe('true');
    expect(sheet.querySelector('[data-view="large"]')!.getAttribute('aria-checked')).toBe('true');
    pick('[data-sort="title"]');
    expect(chip().getAttribute('aria-label')).toBe('Вид и сортировка: По названию, Крупные постеры');
    // the order that is on is visible, not only in the label (QA B13)
    expect(chip().querySelector('.m-icon-tag')!.textContent).toBe('А-Я');
    expect(settings.value.librarySort).toBe('title');
    expect(titles()[0]).toBe('Neon Rivers');
    expect(document.querySelector('[data-sort="title"]')!.getAttribute('aria-checked')).toBe('true');
    pick('[data-sort="size"]');
    expect(titles()[0]).toContain('Starbound');
    expect(titles()[1]).toContain('Тихий');
    pick('[data-view="small"]');
    expect(settings.value.libraryView).toBe('small');
    expect(el.querySelector('.m-grid.m-view-small')).toBeTruthy();
    expect(el.querySelector('.m-card .m-small')).toBeNull();
    pick('[data-view="list"]');
    expect(el.querySelector('.m-vlist')).toBeTruthy();
    const rows = el.querySelectorAll('.m-vrow');
    expect(rows.length).toBe(3);
    expect(rows[0].querySelector('.m-badge-inline')!.textContent).toBe('1080p');
    expect(rows[0].textContent).toContain('2 серии');
    pick('[data-view="compact"]');
    expect(el.querySelectorAll('.m-crow').length).toBe(3);
    expect(el.querySelectorAll('.m-crow')[0].querySelector('.m-poster')).toBeNull();
    pick('[data-view="large"]');
    expect(settings.value.libraryView).toBe('large');
    expect(chip().getAttribute('aria-label')).toBe('Вид и сортировка: По размеру, Крупные постеры');
    act(() => historyButton().click());
    expect(el.querySelector('.m-sort')).toBeNull();
    updateSettings({ librarySort: 'new', libraryView: 'large' });
  });

  it('history: source line per row and filter chips kept in settings', async () => {
    const now = Date.now();
    const withJournal = (t: Torrent, h: object[]) => ({ ...t, data: JSON.stringify({ ...JSON.parse(t.data!), omp: { v: 1, h } }) });
    const list = [
      withJournal(T[0], [{ f: 2, t: 1394, d: 3651, at: now - 60000, src: 'phone', name: 'Pixel 7' }]),
      withJournal(T[1], [{ f: 1, t: 600, d: 7000, at: now - 120000, src: 'tv' }]),
      T[2],
    ];
    torrents.value = list;
    listSpy.mockResolvedValue(list);
    updateSettings({ historyFilter: 'all' });
    mount();
    await flush();
    act(() => historyButton().click());
    const chips = Array.from(el.querySelectorAll('.m-hist-seg .m-seg-btn')) as HTMLElement[];
    expect(chips.map((c) => c.textContent)).toEqual(['Все', 'С телевизора', 'С телефона']);
    expect(chips[0].getAttribute('aria-pressed')).toBe('true');
    let rows = el.querySelectorAll('.m-hrow');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.m-hrow-src')!.textContent).toMatch(/^Телефон «Pixel 7» · (сегодня|вчера) \d\d:\d\d$/);
    expect(rows[1].querySelector('.m-hrow-src')!.textContent).toMatch(/^Телевизор · (сегодня|вчера) /);
    act(() => chips[2].click());
    expect(settings.value.historyFilter).toBe('phone');
    expect(JSON.parse(localStorage.getItem('tsp.settings')!).historyFilter).toBe('phone');
    rows = el.querySelectorAll('.m-hrow');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Starbound');
    act(() => (el.querySelectorAll('.m-hist-seg .m-seg-btn')[1] as HTMLElement).click());
    rows = el.querySelectorAll('.m-hrow');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Тихий сигнал');
    updateSettings({ historyFilter: 'all' });
  });

  it('history filter with nothing to show says so', async () => {
    updateSettings({ historyFilter: 'phone' });
    mount();
    await flush();
    act(() => historyButton().click());
    expect(el.querySelector('.m-empty')!.textContent).toBe('С телефона пока ничего не смотрели');
    updateSettings({ historyFilter: 'all' });
  });
});

describe('Library catalog unavailable', () => {
  it('no active server: full state, no endless loading', async () => {
    for (const sv of servers.value.slice()) removeServer(sv.id);
    torrents.value = [];
    mount();
    await flush();
    expect(el.textContent).toContain('Каталог недоступен');
    expect(el.textContent).toContain('Сервер не выбран');
    expect(byText('Повторить')).toBeUndefined();
    expect(el.textContent).not.toContain('Загрузка…');
    expect(el.textContent).not.toContain('Нет торрентов');
    act(() => byText('Сменить сервер')!.click());
    expect(currentRoute.value.name).toBe('connect');
  });

  it('server down and no cache: named reason, retry, faq, no misleading empty text', async () => {
    torrents.value = [];
    listSpy.mockRejectedValue(new Error('x'));
    mount();
    await flush();
    expect(el.textContent).toContain('Каталог недоступен');
    expect(el.textContent).toContain('Сервер «srv:8090» не отвечает');
    expect(el.textContent).toContain('Проверьте, что телефон и сервер в одной сети');
    expect(el.textContent).not.toContain('Нет торрентов');
    expect(byText('Запустить сервер')).toBeUndefined();
    act(() => byText('Вопросы и ответы')!.click());
    expect(currentRoute.value.name).toBe('faq');
    resetTo({ name: 'library' });
    const n = listSpy.mock.calls.length;
    listSpy.mockResolvedValue(T);
    await act(async () => byText('Повторить')!.click());
    await flush();
    expect(listSpy.mock.calls.length).toBeGreaterThan(n);
    expect(el.textContent).not.toContain('Каталог недоступен');
    expect(el.textContent).toContain('Neon Rivers');
  });

  it('offline: network reason', async () => {
    torrents.value = [];
    listSpy.mockRejectedValue(new Error('x'));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    mount();
    await flush();
    expect(el.textContent).toContain('Нет подключения к сети');
  });

  it('stopped embedded server: start action in the full state', async () => {
    setActiveServer(addServer({ url: 'http://127.0.0.1:8090' }).id);
    torrents.value = [];
    setLocalServerDeps({ native: { localServerInfo: async () => ({ supported: true, running: false }) } as any });
    localServer.value = { supported: true, running: false };
    listSpy.mockRejectedValue(new Error('x'));
    mount();
    await flush();
    expect(el.textContent).toContain('Каталог недоступен');
    expect(byText('Запустить сервер')).toBeDefined();
  });

  it('cached list and failed refresh: list kept, banner with time and retry', async () => {
    torrentsAt.value = new Date(2026, 0, 2, 9, 5).getTime();
    listSpy.mockRejectedValue(new Error('x'));
    mount();
    await flush();
    expect(el.textContent).toContain('Каталог недоступен · показан сохранённый список от 09:05');
    expect(el.textContent).toContain('Neon Rivers');
    expect(el.querySelector('.m-offline')).toBeNull();
    const n = listSpy.mock.calls.length;
    await act(async () => byText('Повторить')!.click());
    await flush();
    expect(listSpy.mock.calls.length).toBeGreaterThan(n);
  });

  it('real refresh time feeds the banner after a later failure', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date(2026, 0, 2, 9, 5));
    torrentsAt.value = 0;
    mount();
    await flush();
    expect(torrentsAt.value).toBe(new Date(2026, 0, 2, 9, 5).getTime());
    act(() => render(null, el));
    listSpy.mockRejectedValue(new Error('x'));
    mount();
    await flush();
    expect(el.textContent).toContain('показан сохранённый список от 09:05');
  });

  it('empty text only when the server answered with an empty list', async () => {
    torrents.value = [];
    listSpy.mockResolvedValue([]);
    mount();
    await flush();
    expect(el.textContent).toContain('Нет торрентов');
    expect(el.textContent).not.toContain('Каталог недоступен');
  });

  it('first load with a server shows loading', async () => {
    torrents.value = [];
    listSpy.mockReturnValue(new Promise(() => undefined));
    mount();
    await flush();
    expect(el.textContent).toContain('Загрузка…');
    expect(el.textContent).not.toContain('Каталог недоступен');
  });
});

describe('Library donate card', () => {
  const OLD = JSON.stringify(Date.now() - 31 * 24 * 60 * 60 * 1000);
  const card = () => el.querySelector('.m-donate-card');

  it('is not shown for a new user (first-run time is stored now)', async () => {
    mount();
    await flush();
    expect(card()).toBeNull();
    expect(localStorage.getItem('tsp.firstRun')).not.toBeNull();
  });

  it('appears after 30 days; «Не напоминать» hides it for good', async () => {
    localStorage.setItem('tsp.firstRun', OLD);
    mount();
    await flush();
    expect(card()).not.toBeNull();
    await act(async () => byText('Не напоминать')!.click());
    expect(card()).toBeNull();
    act(() => render(null, el));
    mount();
    await flush();
    expect(card()).toBeNull();
  });

  it('«Поддержать» opens the sheet and hides the card', async () => {
    localStorage.setItem('tsp.firstRun', OLD);
    mount();
    await flush();
    await act(async () => byText('Поддержать')!.click());
    expect(card()).toBeNull();
    expect(localStorage.getItem('tsp.donateCard')).toBe('true');
  });
});

describe('Library in English', () => {
  const EN: Torrent[] = [
    { hash: 'e1', title: 'Starbound Frontier S02 1080p WEB-DL', category: 'tv', stat: 3, torrent_size: 2 * 1024 ** 3, timestamp: 3, data: files(['S02E01.mkv', 'S02E02.mkv']) },
    { hash: 'e2', title: 'Quiet Signal 2160p', category: 'movie', stat: 3, torrent_size: 1024 ** 3, timestamp: 2, data: files(['movie.mkv']) },
  ];
  beforeEach(() => {
    updateSettings({ language: 'en' });
    torrents.value = EN;
    listSpy.mockResolvedValue(EN);
  });
  afterEach(() => updateSettings({ language: 'system', libraryView: 'large' }));

  it('header, tabs, cards and the episode count', async () => {
    mount();
    await flush();
    expect(Array.from(el.querySelectorAll('.m-tabs [role=tab]')).map((b) => b.textContent)).toEqual(['All', 'Movies', 'Series', 'Music', 'Audiobooks', 'Other']);
    expect(el.querySelector('[aria-label^="View and sort: "]')).toBeTruthy();
    expect(el.querySelector('[aria-label="History"]')).toBeTruthy();
    expect(el.querySelector('[aria-label="Search"]')).toBeTruthy();
    expect(el.textContent).toContain('2.0 GB');
    act(() => updateSettings({ libraryView: 'list' }));
    expect(el.textContent).toContain('2 episodes');
    updateSettings({ libraryView: 'large' });
    expect(el.textContent).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('empty states, history and the donate card', async () => {
    torrents.value = [];
    listSpy.mockResolvedValue([]);
    mount();
    await flush();
    expect(el.textContent).toContain('No torrents. Add them via “Add” or the TorrServer web interface.');
    act(() => historyButton().click());
    expect(el.textContent).toContain('History is empty. What you start watching will appear here');
    act(() => render(<SearchMine query="zzz" onCatalog={() => undefined} onSources={() => undefined} />, el));
    expect(el.textContent).toContain('Nothing like this in "Mine"');
    expect(el.querySelector('[data-search-to="catalog"]')!.textContent).toBe('Search the catalog');
    expect(el.textContent).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('history row: continue on TV label', async () => {
    saveProgress('e1', 2, 1394, 3651);
    mount();
    await flush();
    act(() => historyButton().click());
    expect(el.querySelector('.m-hrow')!.textContent).toContain('Season 2 · Episode 2');
    expect(el.querySelector('.m-history [aria-label="Continue watching"]')).toBeTruthy();
    act(() => render(null, el));
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    mount();
    await flush();
    expect(el.querySelector('.m-history [aria-label="Continue on TV"]')).toBeTruthy();
  });

  it('a stopped phone server: start and download offers', async () => {
    setActiveServer(addServer({ url: 'http://127.0.0.1:8090' }).id);
    setLocalServerDeps({ native: { localServerInfo: async () => ({ supported: true, running: false }), startLocalServer: async () => ({ supported: true, running: false }) } as any });
    localServer.value = { supported: true, running: false };
    listSpy.mockRejectedValue(new Error('Server unreachable'));
    torrents.value = [];
    mount();
    await flush();
    expect(byText('Start the server')).toBeTruthy();
    expect(byText('Retry')).toBeTruthy();
  });
});

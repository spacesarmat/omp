import { tvNoOmp, tvState } from '../src/tv/tvClient';
import { settings, updateSettings } from '../../src/store/settings';
import { describe, it, expect, beforeEach, afterEach, onTestFinished, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Library } from '../src/screens/Library';
import { setWatchActions, noWifi } from '../src/watch';
import { localServer, setLocalServerDeps } from '../src/server/localServer';
import { currentRoute, resetTo } from '../src/nav';
import { reloadTvs, saveTv } from '../src/tv/tvStore';
import { toast } from '../src/ui/toast';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { torrents, torrentsAt, libraryTab, libraryQuery, librarySearchOpen } from '../../src/store/library';
import { saveProgress, reloadProgress, serverViewed } from '../../src/store/progress';
import { TorrServerClient } from '../../src/api/torrserver';
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
    expect(torrents.value.find((t) => t.hash === 'h3')!.poster).toBe('https://imagetmdb.com/t/p/w300/n.jpg');
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
    expect(cards[0].querySelector('.m-card-title')!.textContent).toBe('Starbound Frontier · 2 сезон');
    expect(cards[0].textContent).toContain('2.0 GB');
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
    expect(kids.indexOf(head.querySelector('.m-view')!)).toBeGreaterThan(1);
    // the switch is not a separate row any more
    expect(el.querySelectorAll('.m-seg').length).toBe(1);
    expect(seg.parentElement).toBe(head);
  });

  it('shows short titles with a meta line in every view and in the search results', async () => {
    const list: Torrent[] = [
      { hash: 's1', title: 'Темная материя / Dark Matter / Сезон: 2 / Серии: 1-6 из 10 (Алик Сахаров) [2026, США, WEB-DL 1080p]', category: 'tv', stat: 3, torrent_size: 3, timestamp: 3 },
      { hash: 's2', title: 'Человек-паук: Новый день / Spider-Man: Brand New Day (2026) WEB-DL 1080p', category: 'movie', stat: 3, torrent_size: 2, timestamp: 2 },
      { hash: 's3', title: 'Мой любимый фильм', category: 'movie', stat: 3, torrent_size: 1, timestamp: 1 },
    ];
    torrents.value = list;
    listSpy.mockResolvedValue(list);
    updateSettings({ librarySort: 'new' });
    const want = ['Темная материя · 2 сезон · серии 1–6 из 10', 'Человек-паук: Новый день · 2026', 'Мой любимый фильм'];
    for (const view of ['large', 'small', 'list', 'compact'] as const) {
      updateSettings({ libraryView: view });
      mount();
      await flush();
      const sel = view === 'compact' ? '.m-crow-title' : '.m-card-title';
      expect(Array.from(el.querySelectorAll(sel)).map((n) => n.textContent), view).toEqual(want);
      expect(el.querySelector('.m-title-meta')!.textContent).toBe(' · 2 сезон · серии 1–6 из 10');
      act(() => render(null, el));
    }
    updateSettings({ libraryView: 'large' });
    librarySearchOpen.value = true;
    libraryQuery.value = 'spider';
    mount();
    await flush();
    expect(Array.from(el.querySelectorAll('.m-card-title')).map((n) => n.textContent)).toEqual(['Человек-паук: Новый день · 2026']);
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
    expect(el.querySelector('.m-card-title')!.textContent).toBe('Темная материя · season 2 · episodes 1–6 of 10');
    expect(Array.from(el.querySelectorAll('.m-lib-head [role=tab]')).map((b) => b.textContent)).toEqual(['Mine', 'Discover']);
  });

  it('filters by tab and search', async () => {
    mount();
    await flush();
    act(() => tab('Сериалы').click());
    expect(el.querySelectorAll('.m-card').length).toBe(1);
    act(() => tab('Все').click());
    act(() => (el.querySelector('[aria-label="Поиск"]') as HTMLElement).click());
    const input = el.querySelector('input[aria-label="Поиск по названию"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    act(() => {
      input.value = 'neon';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(el.querySelectorAll('.m-card').length).toBe(1);
    expect(el.querySelector('.m-card')!.textContent).toContain('Neon');
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
      act(() => tab('История').click());
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
    act(() => tab('История').click());
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

  it('history play without a TV opens the TV screen', async () => {
    saveProgress('h1', 2, 100, 3000);
    mount();
    await flush();
    act(() => tab('История').click());
    act(() => (el.querySelector('[aria-label="Продолжить на ТВ"]') as HTMLElement).click());
    await flush();
    expect(currentRoute.value.name).toBe('tv');
  });

  it('shows empty states', async () => {
    torrents.value = [];
    listSpy.mockResolvedValue([]);
    mount();
    await flush();
    expect(el.textContent).toContain('Нет торрентов');
    act(() => tab('История').click());
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
    act(() => tab('История').click());
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
    act(() => tab('История').click());
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
    act(() => tab('История').click());
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
      'TorrServer на телефоне больше не входит в OMP — его нужно один раз скачать.',
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

  it('sort chip cycles and persists, hidden on history', async () => {
    updateSettings({ librarySort: 'new' });
    mount();
    await flush();
    const chip = () => el.querySelector('.m-sort') as HTMLElement;
    const titles = () => Array.from(el.querySelectorAll('.m-card-title')).map((n) => n.textContent);
    expect(chip().getAttribute('aria-label')).toBe('Сортировка: Новые');
    expect(titles()[0]).toContain('Starbound');
    act(() => chip().click());
    expect(chip().getAttribute('aria-label')).toBe('Сортировка: По названию');
    expect(settings.value.librarySort).toBe('title');
    expect(titles()[0]).toBe('Neon Rivers');
    act(() => chip().click());
    expect(chip().getAttribute('aria-label')).toBe('Сортировка: По размеру');
    expect(titles()[0]).toContain('Starbound');
    expect(titles()[1]).toContain('Тихий');
    act(() => tab('История').click());
    expect(el.querySelector('.m-sort')).toBeNull();
    updateSettings({ librarySort: 'new' });
  });
  it('view chip cycles all four modes, persists, hidden on history', async () => {
    updateSettings({ libraryView: 'large' });
    mount();
    await flush();
    const chip = () => el.querySelector('.m-view') as HTMLElement;
    expect(chip().getAttribute('aria-label')).toBe('Вид: Крупные постеры');
    expect(el.querySelector('.m-grid.m-view-large')).toBeTruthy();
    expect(el.querySelectorAll('.m-card .m-small').length).toBe(3);
    act(() => chip().click());
    expect(chip().getAttribute('aria-label')).toBe('Вид: Мелкие постеры');
    expect(settings.value.libraryView).toBe('small');
    expect(el.querySelector('.m-grid.m-view-small')).toBeTruthy();
    expect(el.querySelectorAll('.m-card').length).toBe(3);
    expect(el.querySelector('.m-card .m-small')).toBeNull();
    act(() => chip().click());
    expect(settings.value.libraryView).toBe('list');
    expect(el.querySelector('.m-vlist')).toBeTruthy();
    const rows = el.querySelectorAll('.m-vrow');
    expect(rows.length).toBe(3);
    expect(rows[0].querySelector('.m-poster')).toBeTruthy();
    expect(rows[0].textContent).toContain('2.0 GB');
    expect(rows[0].querySelector('.m-badge-inline')!.textContent).toBe('1080p');
    expect(rows[0].textContent).toContain('2 серии');
    act(() => (rows[1] as HTMLElement).click());
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: 'h2' });
    act(() => chip().click());
    expect(settings.value.libraryView).toBe('compact');
    const crows = el.querySelectorAll('.m-crow');
    expect(crows.length).toBe(3);
    expect(crows[0].querySelector('.m-poster')).toBeNull();
    expect(crows[0].querySelector('.m-crow-size')!.textContent).toBe('2.0 GB');
    act(() => chip().click());
    expect(settings.value.libraryView).toBe('large');
    act(() => tab('История').click());
    expect(el.querySelector('.m-view')).toBeNull();
    updateSettings({ libraryView: 'large' });
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
    act(() => tab('История').click());
    const chips = Array.from(el.querySelectorAll('.m-hfilter')) as HTMLElement[];
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
    act(() => (el.querySelectorAll('.m-hfilter')[1] as HTMLElement).click());
    rows = el.querySelectorAll('.m-hrow');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Тихий сигнал');
    updateSettings({ historyFilter: 'all' });
  });

  it('history filter with nothing to show says so', async () => {
    updateSettings({ historyFilter: 'phone' });
    mount();
    await flush();
    act(() => tab('История').click());
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
    expect(Array.from(el.querySelectorAll('.m-tabs [role=tab]')).map((b) => b.textContent)).toEqual(['History', 'All', 'Movies', 'Series', 'Music', 'Other']);
    expect(el.querySelector('[aria-label^="Sort: "]')).toBeTruthy();
    expect(el.querySelector('[aria-label^="View: "]')).toBeTruthy();
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
    act(() => tab('History').click());
    expect(el.textContent).toContain('History is empty. What you start watching will appear here');
    act(() => (el.querySelector('[aria-label="Search"]') as HTMLElement).click());
    const input = el.querySelector('input[type=search]') as HTMLInputElement;
    expect(input.placeholder).toBe('Search by title');
    act(() => {
      input.value = 'zzz';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(el.textContent).toContain('Nothing found');
    expect(el.textContent).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('history row: continue on TV label', async () => {
    saveProgress('e1', 2, 1394, 3651);
    mount();
    await flush();
    act(() => tab('History').click());
    expect(el.querySelector('.m-hrow')!.textContent).toContain('Season 2 · Episode 2');
    expect(el.querySelector('[aria-label="Continue on TV"]')).toBeTruthy();
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

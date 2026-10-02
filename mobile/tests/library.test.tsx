import { TV_NO_OMP, tvState } from '../src/tv/tvClient';
import { settings, updateSettings } from '../../src/store/settings';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Library } from '../src/screens/Library';
import { setWatchActions, NO_WIFI } from '../src/watch';
import { localServer, setLocalServerDeps } from '../src/server/localServer';
import { currentRoute, resetTo } from '../src/nav';
import { reloadTvs, saveTv } from '../src/tv/tvStore';
import { toast } from '../src/ui/toast';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { torrents, libraryTab, libraryQuery, librarySearchOpen } from '../../src/store/library';
import { saveProgress, reloadProgress, serverViewed } from '../../src/store/progress';
import { TorrServerClient } from '../../src/api/torrserver';
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
});

afterEach(() => {
  act(() => render(null, el));
  vi.useRealTimers();
  vi.restoreAllMocks();
  setWatchActions(null);
  setLocalServerDeps(null);
  localServer.value = { supported: false, running: false };
});

describe('Library', () => {
  it('renders a grid card per torrent with size and badge', async () => {
    mount();
    await flush();
    const cards = el.querySelectorAll('.m-grid .m-card');
    expect(cards.length).toBe(3);
    expect(cards[0].textContent).toContain('Starbound Frontier S02');
    expect(cards[0].textContent).toContain('2.0 GB');
    expect(cards[1].querySelector('.m-badge')!.textContent).toBe('4K');
  });

  it('shows the logo and name in the header', async () => {
    mount();
    await flush();
    const brand = el.querySelector('.m-lib-brand')!;
    expect(brand.querySelector('svg.logo')!.getAttribute('width')).toBe('28');
    expect(brand.textContent).toBe('OMP');
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
      const mv = touch('touchmove', 220);
      expect(mv.defaultPrevented).toBe(true);
      touch('touchend', 220);
      expect(listSpy).toHaveBeenCalledTimes(1);
      expect(el.querySelector('.m-ptr')!.textContent).toContain('Обновляю…');
      release(T);
      await flush();
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
      touch('touchend', 220);
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
    setWatchActions({ recordWatch: async () => undefined, ompVersion: async () => null, reportUrl: async () => null, launchOnTv: vi.fn().mockRejectedValue(new Error(TV_NO_OMP)), remoteDelayMs: 0 });
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
    expect(el.textContent).toContain(NO_WIFI);
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
    mount();
    await flush();
    expect(el.textContent).toContain('показан сохранённый список');
    const n = listSpy.mock.calls.length;
    await act(async () => byText('Запустить сервер')!.click());
    await flush();
    await flush();
    expect(start).toHaveBeenCalledTimes(1);
    expect(listSpy.mock.calls.length).toBeGreaterThan(n);
    expect(el.textContent).not.toContain('показан сохранённый список');
    expect(byText('Запустить сервер')).toBeUndefined();
  });

  it('offers no start for a remote server or a running local one', async () => {
    listSpy.mockRejectedValue(new Error('Сервер недоступен'));
    localServer.value = { supported: true, running: false };
    mount();
    await flush();
    expect(el.textContent).toContain('показан сохранённый список');
    expect(byText('Запустить сервер')).toBeUndefined();
    act(() => render(null, el));
    setActiveServer(addServer({ url: 'http://127.0.0.1:8090' }).id);
    localServer.value = { supported: true, running: true };
    mount();
    await flush();
    expect(el.textContent).toContain('показан сохранённый список');
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


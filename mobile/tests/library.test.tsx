import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Library } from '../src/screens/Library';
import { setWatchActions } from '../src/watch';
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

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
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

  it('shows the TV chip: grey without a TV, green with name', async () => {
    mount();
    expect(el.querySelector('.m-tvchip')!.textContent).toContain('Подключить ТВ');
    expect(el.querySelector('.m-tvchip.on')).toBeNull();
    act(() => saveTv({ ip: '192.168.1.5', name: 'LG OLED' }));
    expect(el.querySelector('.m-tvchip.on')!.textContent).toContain('LG OLED');
    act(() => (el.querySelector('.m-tvchip') as HTMLElement).click());
    expect(currentRoute.value.name).toBe('tv');
  });

  it('history tab lists started items with a continue-on-TV button', async () => {
    saveProgress('h1', 2, 1394, 3651);
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    const launch = vi.fn().mockResolvedValue(undefined);
    setWatchActions({ launchOnTv: launch, remoteDelayMs: 0 });
    mount();
    await flush();
    act(() => tab('История').click());
    const rows = el.querySelectorAll('.m-hrow');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Сезон 2 · Серия 2');
    expect(rows[0].textContent).toContain('23:14');
    act(() => (el.querySelector('[aria-label="Продолжить на ТВ"]') as HTMLElement).click());
    await flush();
    expect(launch).toHaveBeenCalledWith({ server: 'http://srv:8090', torrent: 'h1', file: 2, t: 1394 });
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
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { setWatchActions } from '../src/watch';
import { Library } from '../src/screens/Library';
import { currentRoute, resetTo } from '../src/nav';
import { reloadTvs, saveTv } from '../src/tv/tvStore';
import { toast } from '../src/ui/toast';
import { runBack } from '../src/ui/backStack';
import { settings, updateSettings } from '../../src/store/settings';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { torrents, libraryTab, libraryQuery, librarySearchOpen } from '../../src/store/library';
import { reloadProgress, serverViewed } from '../../src/store/progress';
import { applyLanguageSetting } from '../../src/i18n';
import { TorrServerClient } from '../../src/api/torrserver';
import type { Torrent } from '../../src/api/types';

const T: Torrent[] = [
  { hash: 'h1', title: 'Starbound Frontier S02 1080p WEB-DL', category: 'tv', stat: 3, torrent_size: 2 * 1024 ** 3, timestamp: 3 },
  { hash: 'h2', title: 'Quiet Signal 2160p', category: 'movie', stat: 3, torrent_size: 1024 ** 3, timestamp: 2 },
  { hash: 'h3', title: 'Neon Rivers', category: 'movie', stat: 3, torrent_size: 500 * 1024 ** 2, timestamp: 1 },
];

async function flush() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}

let el: HTMLElement;
let removeSpy: ReturnType<typeof vi.spyOn>;
let serverList: Torrent[];

function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<Library />, el));
}

const cards = () => Array.from(el.querySelectorAll('.m-card, .m-vrow, .m-crow')) as HTMLElement[];
const btn = (text: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === text || b.getAttribute('aria-label') === text) as HTMLElement | undefined;

function pointer(target: Element, type: string, x = 10, y = 10) {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  act(() => {
    target.dispatchEvent(e);
  });
}

function longPress(card: Element) {
  pointer(card, 'pointerdown');
  act(() => {
    vi.advanceTimersByTime(500);
  });
  pointer(card, 'pointerup');
}

// a finger tap: down, up, then the click
function tap(card: Element) {
  pointer(card, 'pointerdown');
  pointer(card, 'pointerup');
  act(() => (card as HTMLElement).click());
}

const menu = () => document.querySelector('.m-sheet') as HTMLElement | null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  localStorage.clear();
  reloadTvs();
  reloadProgress();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  serverList = T.slice();
  torrents.value = T;
  serverViewed.value = [];
  libraryTab.value = 'all';
  libraryQuery.value = '';
  librarySearchOpen.value = false;
  toast.value = '';
  resetTo({ name: 'library' });
  vi.spyOn(TorrServerClient.prototype, 'list').mockImplementation(async () => serverList);
  vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
  removeSpy = vi.spyOn(TorrServerClient.prototype, 'remove').mockImplementation(async (h: string) => {
    serverList = serverList.filter((x) => x.hash !== h);
  });
  window.confirm = vi.fn(() => true);
});

afterEach(() => {
  act(() => render(null, el));
  vi.useRealTimers();
  vi.restoreAllMocks();
  updateSettings({ libraryView: 'large' });
  setWatchActions(null);
});

describe('Library delete', () => {
  it('a long press opens the menu with the five items', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    mount();
    await flush();
    longPress(cards()[0]);
    const m = menu()!;
    expect(m).toBeTruthy();
    const labels = Array.from(m.querySelectorAll('button')).map((b) => (b.textContent || '').trim());
    expect(labels).toEqual(expect.arrayContaining(['Открыть', 'Смотреть на ТВ', 'Переименовать', 'Выбрать', 'Удалить']));
    expect(currentRoute.value.name).toBe('library');
  });

  it('«Смотреть на ТВ» in the menu starts the torrent on the TV', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    const launch = vi.fn().mockResolvedValue(undefined);
    setWatchActions({ recordWatch: async () => undefined, ompVersion: async () => null, reportUrl: async () => null, launchOnTv: launch, remoteDelayMs: 0 });
    mount();
    await flush();
    longPress(cards()[1]);
    await act(async () => {
      btn('Смотреть на ТВ', menu()!)!.click();
    });
    await flush();
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ server: 'http://srv:8090', torrent: 'h2', file: 1 }));
  });

  it('the menu has no «Смотреть на ТВ» when no TV is active', async () => {
    mount();
    await flush();
    longPress(cards()[0]);
    expect(btn('Смотреть на ТВ', menu()!)).toBeUndefined();
    expect(btn('Открыть', menu()!)).toBeTruthy();
  });

  it('the contextmenu event opens the menu too', async () => {
    mount();
    await flush();
    pointer(cards()[1], 'contextmenu');
    expect(menu()).toBeTruthy();
  });

  it('moving more than 10 px or releasing early cancels the long press', async () => {
    mount();
    await flush();
    pointer(cards()[0], 'pointerdown', 10, 10);
    pointer(cards()[0], 'pointermove', 10, 40);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(menu()).toBeNull();
    pointer(cards()[0], 'pointerdown');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    pointer(cards()[0], 'pointerup');
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(menu()).toBeNull();
  });

  it('a normal tap still opens the torrent; the click after a long press does not', async () => {
    mount();
    await flush();
    act(() => cards()[2].click());
    expect(currentRoute.value).toMatchObject({ name: 'torrent', hash: 'h3' });
    resetTo({ name: 'library' });
    longPress(cards()[0]);
    act(() => cards()[0].click());
    expect(currentRoute.value.name).toBe('library');
  });

  it('«Открыть» in the menu opens the torrent', async () => {
    mount();
    await flush();
    longPress(cards()[1]);
    act(() => btn('Открыть', menu()!)!.click());
    expect(currentRoute.value).toMatchObject({ name: 'torrent', hash: 'h2' });
  });

  it('«Удалить» confirms and removes exactly that torrent', async () => {
    mount();
    await flush();
    longPress(cards()[1]);
    await act(async () => {
      btn('Удалить', menu()!)!.click();
    });
    await flush();
    expect(window.confirm).toHaveBeenCalledWith('Удалить раздачу «Quiet Signal»?');
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith('h2');
    expect(cards().length).toBe(2);
    expect(el.textContent).not.toContain('Quiet Signal');
    expect(menu()).toBeNull();
  });

  it('«Выбрать» enters selection mode with 1 selected; a tap on another poster makes 2', async () => {
    mount();
    await flush();
    longPress(cards()[0]);
    act(() => btn('Выбрать', menu()!)!.click());
    expect(el.querySelector('.m-select-bar')!.textContent).toContain('Выбрано: 1');
    expect(btn('Отменить выбор')).toBeTruthy();
    expect(cards()[0].getAttribute('aria-pressed')).toBe('true');
    tap(cards()[1]);
    expect(el.querySelector('.m-select-bar')!.textContent).toContain('Выбрано: 2');
    expect(btn('Удалить (2)')).toBeTruthy();
    expect(currentRoute.value.name).toBe('library');
    tap(cards()[1]);
    expect(btn('Удалить (1)')).toBeTruthy();
  });

  it('«Выбрать все» selects all, then «Снять выбор» clears', async () => {
    mount();
    await flush();
    longPress(cards()[0]);
    act(() => btn('Выбрать', menu()!)!.click());
    act(() => btn('Выбрать все')!.click());
    expect(btn('Удалить (3)')).toBeTruthy();
    act(() => btn('Снять выбор')!.click());
    expect(el.querySelector('.m-select-bar')!.textContent).toContain('Выбрано: 0');
    expect(btn('Удалить (0)')!.hasAttribute('disabled')).toBe(true);
  });

  it('deleting the selection asks with a plural, removes them, toasts, ends selection', async () => {
    mount();
    await flush();
    longPress(cards()[0]);
    act(() => btn('Выбрать', menu()!)!.click());
    tap(cards()[1]);
    await act(async () => {
      btn('Удалить (2)')!.click();
    });
    await flush();
    expect(window.confirm).toHaveBeenCalledWith('Удалить 2 раздачи с сервера?');
    expect(removeSpy).toHaveBeenCalledTimes(2);
    expect(cards().length).toBe(1);
    expect(toast.value).toBe('Удалено: 2');
    expect(el.querySelector('.m-select-bar')).toBeNull();
  });

  it('confirm false removes nothing', async () => {
    window.confirm = vi.fn(() => false);
    mount();
    await flush();
    longPress(cards()[0]);
    act(() => btn('Выбрать', menu()!)!.click());
    await act(async () => {
      btn('Удалить (1)')!.click();
    });
    await flush();
    expect(removeSpy).not.toHaveBeenCalled();
    expect(cards().length).toBe(3);
    expect(el.querySelector('.m-select-bar')).not.toBeNull();
  });

  it('one remove rejecting: the others are removed, the failure is toasted', async () => {
    removeSpy.mockImplementation(async (h: string) => {
      if (h === 'h2') throw new Error('boom');
      serverList = serverList.filter((x) => x.hash !== h);
    });
    mount();
    await flush();
    longPress(cards()[0]);
    act(() => btn('Выбрать', menu()!)!.click());
    act(() => btn('Выбрать все')!.click());
    await act(async () => {
      btn('Удалить (3)')!.click();
    });
    await flush();
    expect(removeSpy).toHaveBeenCalledTimes(3);
    expect(window.confirm).toHaveBeenCalledWith('Удалить 3 раздачи с сервера?');
    expect(toast.value).toBe('Не удалось удалить: 1');
    expect(cards().length).toBe(1);
    expect(cards()[0].textContent).toContain('Quiet Signal');
  });

  it('system Back leaves selection mode; switching tab does too', async () => {
    mount();
    await flush();
    longPress(cards()[0]);
    act(() => btn('Выбрать', menu()!)!.click());
    expect(el.querySelector('.m-select-bar')).not.toBeNull();
    act(() => {
      runBack();
    });
    expect(el.querySelector('.m-select-bar')).toBeNull();
    longPress(cards()[0]);
    act(() => btn('Выбрать', menu()!)!.click());
    act(() => btn('Сериалы')!.click());
    expect(el.querySelector('.m-select-bar')).toBeNull();
  });

  it('list view: the ⋯ button opens the same menu; selection works there too', async () => {
    updateSettings({ libraryView: 'list' });
    mount();
    await flush();
    const more = el.querySelectorAll('.m-card-more');
    expect(more.length).toBe(3);
    act(() => (more[0] as HTMLElement).click());
    expect(menu()).toBeTruthy();
    act(() => btn('Выбрать', menu()!)!.click());
    tap(cards()[1]);
    expect(btn('Удалить (2)')).toBeTruthy();
    expect(settings.value.libraryView).toBe('list');
  });

  it('compact view: long press works and a ⋯ button exists', async () => {
    updateSettings({ libraryView: 'compact' });
    mount();
    await flush();
    expect(el.querySelectorAll('.m-card-more').length).toBe(3);
    longPress(cards()[0]);
    expect(menu()).toBeTruthy();
  });

  it('English: «Selected: 2», «Delete (2)», no Cyrillic', async () => {
    applyLanguageSetting('en');
    try {
      mount();
      await flush();
      longPress(cards()[0]);
      const m = menu()!;
      expect(btn('Open', m)).toBeTruthy();
      expect(btn('Rename', m)).toBeTruthy();
      act(() => btn('Choose', m)!.click());
      tap(cards()[1]);
      expect(el.querySelector('.m-select-bar')!.textContent).toContain('Selected: 2');
      expect(btn('Delete (2)')).toBeTruthy();
      expect(btn('Cancel selection')).toBeTruthy();
      expect(btn('Select all')).toBeTruthy();
      expect(el.textContent).not.toMatch(/[А-Яа-яЁё]/);
      await act(async () => {
        btn('Delete (2)')!.click();
      });
      await flush();
      expect(window.confirm).toHaveBeenCalledWith('Delete 2 torrents from the server?');
      expect(toast.value).toBe('Deleted: 2');
    } finally {
      applyLanguageSetting('ru');
    }
  });
});

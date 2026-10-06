import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Library } from '../src/screens/Library';
import { Series } from '../src/screens/Series';
import { currentRoute, navigate, resetTo } from '../src/nav';
import { reloadTvs } from '../src/tv/tvStore';
import { groupLibrary, findGroup, seriesKey, type SeriesGroup } from '../../src/lib/seriesGroups';
import { updateSettings } from '../../src/store/settings';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { torrents, libraryTab, libraryQuery, librarySearchOpen } from '../../src/store/library';
import { reloadProgress, saveProgress, serverViewed } from '../../src/store/progress';
import { applyLanguageSetting } from '../../src/i18n';
import { setCatalogClientForTests } from '../src/catalog/phoneCatalog';
import { resetSeriesMatches } from '../../src/lib/seriesMatch';
import { TorrServerClient } from '../../src/api/torrserver';
import type { Torrent } from '../../src/api/types';

function files(names: string[]) {
  return JSON.stringify({ TorrServer: { Files: names.map((p, i) => ({ id: i + 1, path: p, length: 1000 })) } });
}

const GB = 1024 ** 3;
const S1: Torrent = { hash: 's1', title: 'Темная материя / Dark Matter [S01] 1080p WEB-DL', category: 'tv', stat: 3, torrent_size: 4 * GB, timestamp: 1, data: files(['S01E01.mkv', 'S01E02.mkv']) };
const S2: Torrent = { hash: 's2', title: 'Тёмная материя / Dark Matter [S02] 2160p WEB-DL', category: 'tv', stat: 3, torrent_size: 6 * GB, timestamp: 4, data: files(['S02E01.mkv', 'S02E02.mkv']) };
const STAR: Torrent = { hash: 'st', title: 'Starbound Frontier S02 1080p WEB-DL', category: 'tv', stat: 3, torrent_size: 2 * GB, timestamp: 3, data: files(['S02E01.mkv', 'S02E02.mkv']) };
const M1: Torrent = { hash: 'm1', title: 'Quiet Signal 2160p', category: 'movie', stat: 3, torrent_size: GB, timestamp: 2 };
const M2: Torrent = { hash: 'm2', title: 'Quiet Signal 1080p', category: 'movie', stat: 3, torrent_size: GB, timestamp: 0 };
const ALL = [S1, S2, STAR, M1, M2];

async function flush() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}

let el: HTMLElement;
let serverList: Torrent[];
let removeSpy: ReturnType<typeof vi.spyOn>;

function mount(node = <Library />) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(node, el));
}

const cards = () => Array.from(el.querySelectorAll('.m-card, .m-vrow, .m-crow')) as HTMLElement[];
const seriesCard = () => el.querySelector('.m-series-card') as HTMLElement | null;
const btn = (text: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === text || b.getAttribute('aria-label') === text) as HTMLElement | undefined;

function pointer(target: Element, type: string) {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 10, clientY: 10 }));
  });
}
function longPress(card: Element) {
  pointer(card, 'pointerdown');
  act(() => {
    vi.advanceTimersByTime(500);
  });
  pointer(card, 'pointerup');
}
function tap(card: Element) {
  pointer(card, 'pointerdown');
  pointer(card, 'pointerup');
  act(() => (card as HTMLElement).click());
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  localStorage.clear();
  reloadTvs();
  reloadProgress();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  serverList = ALL.slice();
  torrents.value = ALL;
  serverViewed.value = [];
  libraryTab.value = 'all';
  libraryQuery.value = '';
  librarySearchOpen.value = false;
  updateSettings({ libraryView: 'large', librarySort: 'new' });
  resetTo({ name: 'library' });
  vi.spyOn(TorrServerClient.prototype, 'list').mockImplementation(async () => serverList);
  vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
  removeSpy = vi.spyOn(TorrServerClient.prototype, 'remove').mockImplementation(async (h: string) => {
    serverList = serverList.filter((x) => x.hash !== h);
  });
  window.confirm = vi.fn(() => true);
  // no TMDB: the series screen keeps its simple layout
  resetSeriesMatches();
  const offline = () => Promise.reject(new Error('catalog:offline'));
  setCatalogClientForTests({ novelties: offline, discover: offline, search: offline, card: offline });
});

afterEach(() => {
  if (el) act(() => render(null, el));
  vi.useRealTimers();
  vi.restoreAllMocks();
  updateSettings({ libraryView: 'large' });
  applyLanguageSetting('ru');
  setCatalogClientForTests(null);
});

describe('series grouping', () => {
  it('two seasons of one series are one group; the newest season leads', () => {
    const items = groupLibrary(ALL);
    const groups = items.filter((x) => x.kind === 'series') as SeriesGroup[];
    expect(groups.length).toBe(1);
    expect(groups[0].members.map((m) => m.hash).sort()).toEqual(['s1', 's2']);
    expect(groups[0].seasons).toEqual([1, 2]);
    expect(groups[0].lead.hash).toBe('s2');
  });

  it('a series with one torrent stays plain, films never group, different series are not merged', () => {
    const items = groupLibrary(ALL);
    const plain = items.filter((x) => x.kind === 'torrent').map((x) => (x.kind === 'torrent' ? x.tor.hash : ''));
    expect(plain.sort()).toEqual(['m1', 'm2', 'st']);
    expect(items.length).toBe(4);
  });

  it('the group stands where its first torrent is in the list', () => {
    const items = groupLibrary([S2, M1, S1]);
    expect(items.map((x) => x.kind)).toEqual(['series', 'torrent']);
  });

  it('a query matching one torrent keeps the whole group', () => {
    const items = groupLibrary(ALL, 'S01');
    expect(items.length).toBe(1);
    expect(items[0].kind === 'series' && items[0].members.length).toBe(2);
  });

  it('findGroup reads the series from the whole library', () => {
    const key = (groupLibrary(ALL).find((x) => x.kind === 'series') as SeriesGroup).key;
    expect(key).toBe('темная материя');
    expect(findGroup(ALL, key)!.members.length).toBe(2);
  });

  it('a release titled only in English joins the series titled «Русское / English»', () => {
    const RU3: Torrent = { hash: 'r3', title: 'Звёздный путь: Странные новые миры (3 сезон: 1-10 серии) / Star Trek: Strange New Worlds / 2025 / 4K', category: 'tv', stat: 3, timestamp: 5, data: files(['S03E01.mkv']) };
    const EN2: Torrent = { hash: 'e2', title: 'Star Trek: Strange New Worlds / S2E1-10 of 10 [2023, WEB-DL 2160p]', category: 'tv', stat: 3, timestamp: 9, data: files(['S02E01.mkv']) };
    const EN4: Torrent = { hash: 'e4', title: 'Star Trek: Strange New Worlds / S4E1-10 of 10 [2026, WEB-DL 2160p]', category: 'tv', stat: 3, timestamp: 8, data: files(['S04E01.mkv']) };
    // both names before the bracket: it ties the Russian-titled releases to the English-only ones
    const RU4: Torrent = { hash: 'r4', title: 'Звездный путь: Странные новые миры / Star Trek: Strange New Worlds / S4E1-10 of 10 (2026) WEB-DL [H.264/1080p]', category: 'tv', stat: 3, timestamp: 7, data: files(['S04E01.mkv']) };
    const items = groupLibrary([EN2, RU3, M1, EN4, RU4]);
    const groups = items.filter((x) => x.kind === 'series') as SeriesGroup[];
    expect(groups.length).toBe(1);
    expect(groups[0].members.map((m) => m.hash)).toEqual(['e2', 'r3', 'e4', 'r4']);
    expect(groups[0].seasons).toEqual([2, 3, 4]);
    // the title comes from the release named in both languages, not the newest English-only one
    expect(groups[0].named.hash).toBe('r4');
    // the series screen finds it by any of the names, in any order of the list
    expect(findGroup([RU3, EN4, RU4, EN2], groups[0].key)!.members.length).toBe(4);
    expect(findGroup([EN4, RU3, EN2, RU4], seriesKey(RU3))!.members.length).toBe(4);
  });
});

describe('Library series card', () => {
  it('shows one card «Тёмная материя · 2 сезона» with the seasons badge, in every view', async () => {
    mount();
    await flush();
    expect(cards().length).toBe(4);
    const card = seriesCard()!;
    expect(card.querySelector('.m-card-title')!.textContent).toBe('Тёмная материя · 2 сезона');
    expect(card.querySelector('.m-badge')!.textContent).toBe('2 сезона');
    for (const v of ['small', 'list', 'compact'] as const) {
      act(() => updateSettings({ libraryView: v }));
      expect(cards().length).toBe(4);
      expect(seriesCard()!.textContent).toContain('Тёмная материя · 2 сезона');
    }
  });

  it('groups in «Сериалы» too, but not in «Фильмы»', async () => {
    mount();
    await flush();
    act(() => {
      libraryTab.value = 'tv';
    });
    expect(cards().length).toBe(2);
    expect(seriesCard()).toBeTruthy();
    act(() => {
      libraryTab.value = 'movie';
    });
    expect(cards().length).toBe(2);
    expect(seriesCard()).toBeNull();
  });

  it('a tap opens the series screen; a plain card opens the torrent screen', async () => {
    mount();
    await flush();
    tap(seriesCard()!);
    expect(currentRoute.value.name).toBe('series');
    resetTo({ name: 'library' });
    mount();
    await flush();
    const star = cards().find((c) => (c.textContent || '').indexOf('Starbound') >= 0)!;
    tap(star);
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: 'st' });
  });

  it('selection: a series card selects all its torrents; deleting asks with the total count', async () => {
    mount();
    await flush();
    longPress(cards().find((c) => (c.textContent || '').indexOf('Starbound') >= 0)!);
    act(() => btn('Выбрать')!.click());
    tap(seriesCard()!);
    expect(el.querySelector('.m-select-count')!.textContent).toBe('Выбрано: 3');
    expect(seriesCard()!.getAttribute('aria-pressed')).toBe('true');
    act(() => btn('Удалить (3)')!.click());
    await flush();
    expect(window.confirm).toHaveBeenCalledWith('Удалить 3 раздачи с сервера?');
    expect(removeSpy.mock.calls.map((c: unknown[]) => c[0] as string).sort()).toEqual(['s1', 's2', 'st']);
  });

  it('a second tap on a selected series card clears all its torrents', async () => {
    mount();
    await flush();
    longPress(seriesCard()!);
    act(() => btn('Выбрать')!.click());
    expect(el.querySelector('.m-select-count')!.textContent).toBe('Выбрано: 2');
    tap(seriesCard()!);
    expect(el.querySelector('.m-select-count')!.textContent).toBe('Выбрано: 0');
  });

  it('the long-press menu: open, select, delete the series with its count', async () => {
    mount();
    await flush();
    longPress(seriesCard()!);
    const m = document.querySelector('.m-sheet') as HTMLElement;
    const labels = Array.from(m.querySelectorAll('button')).map((b) => (b.textContent || '').trim()).filter(Boolean);
    expect(labels).toEqual(expect.arrayContaining(['Открыть', 'Выбрать', 'Удалить сериал (2 раздачи)']));
    act(() => btn('Удалить сериал (2 раздачи)', m)!.click());
    await flush();
    expect(window.confirm).toHaveBeenCalledWith('Удалить 2 раздачи с сервера?');
    expect(removeSpy.mock.calls.map((c: unknown[]) => c[0] as string).sort()).toEqual(['s1', 's2']);
  });

  it('English: «Dark matter · 2 seasons» and the menu item', async () => {
    applyLanguageSetting('en');
    mount();
    await flush();
    expect(seriesCard()!.querySelector('.m-card-title')!.textContent).toBe('Тёмная материя · 2 seasons');
    longPress(seriesCard()!);
    expect(btn('Delete series (2 torrents)')).toBeTruthy();
  });
});

describe('Series screen', () => {
  function key(): string {
    return (groupLibrary(ALL).find((x) => x.kind === 'series') as SeriesGroup).key;
  }

  it('season chips; the newest season is chosen; a chip shows its torrents; a row opens the torrent', async () => {
    navigate({ name: 'series', key: key() });
    mount(<Series seriesKey={key()} />);
    const chips = Array.from(el.querySelectorAll('.m-chip')).map((c) => c.textContent);
    expect(chips).toEqual(['Сезон 1', 'Сезон 2']);
    expect(el.querySelector('.m-chip.on')!.textContent).toBe('Сезон 2');
    expect(Array.from(el.querySelectorAll('.m-series-row')).map((r) => r.getAttribute('data-hash'))).toEqual(['s2']);
    expect(el.querySelector('.m-series-title')!.textContent).toBe('Тёмная материя');
    expect(el.textContent).toContain('2 сезона');
    act(() => (el.querySelectorAll('.m-chip')[0] as HTMLElement).click());
    const rows = Array.from(el.querySelectorAll('.m-series-row'));
    expect(rows.map((r) => r.getAttribute('data-hash'))).toEqual(['s1']);
    expect(rows[0].textContent).toContain('4.0');
    act(() => (rows[0].querySelector('.m-hrow-main') as HTMLElement).click());
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: 's1' });
  });

  it('opens on the season watched last and offers «Продолжить на ТВ» there', async () => {
    saveProgress('s1', 2, 300, 1200);
    navigate({ name: 'series', key: key() });
    mount(<Series seriesKey={key()} />);
    expect(el.querySelector('.m-chip.on')!.textContent).toBe('Сезон 1');
    expect(btn('Продолжить на ТВ')).toBeTruthy();
    const row = el.querySelector('.m-series-row')!;
    expect(row.textContent).toContain('Продолжить');
    expect(row.querySelector('.m-bar-fill')).toBeTruthy();
  });

  it('a series gone from the library says so', () => {
    navigate({ name: 'series', key: 'nothing here' });
    mount(<Series seriesKey="nothing here" />);
    expect(el.textContent).toContain('Этого сериала больше нет');
  });
});

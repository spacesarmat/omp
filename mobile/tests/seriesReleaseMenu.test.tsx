// The series screen: «⋯» on the release line («Раздача: ... · Сменить») opens the torrent menu (no «Выбрать»), with
// «Оставить только эту» when the shown season has 2+ releases; «Сменить» picks another release of the season in
// «Другая раздача»; deletes update the screen in place, the last one goes back to the library.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Series } from '../src/screens/Series';
import { currentRoute, navigate, resetTo } from '../src/nav';
import { reloadTvs } from '../src/tv/tvStore';
import { groupLibrary, seasonsOf, type SeriesGroup } from '../../src/lib/seriesGroups';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { reloadProgress, serverViewed } from '../../src/store/progress';
import { applyLanguageSetting } from '../../src/i18n';
import { acceptConfirm, confirmText, declineConfirm, mountConfirmHost, unmountConfirmHost } from './confirmHost';
import { setCatalogClientForTests } from '../src/catalog/phoneCatalog';
import { resetSeriesMatches } from '../../src/lib/seriesMatch';
import { TorrServerClient } from '../../src/api/torrserver';
import type { CatalogCard } from '../../src/catalog/tmdb';
import type { Torrent } from '../../src/api/types';

function files(names: string[]) {
  return JSON.stringify({ TorrServer: { Files: names.map((p, i) => ({ id: i + 1, path: p, length: 1000 })) } });
}

const GB = 1024 ** 3;
const S1: Torrent = { hash: 's1', title: 'Тёмная материя / Dark Matter [S01] 1080p WEB-DL', category: 'tv', stat: 3, torrent_size: 4 * GB, timestamp: 1, data: files(['S01E01.mkv', 'S01E02.mkv']) };
const S2A: Torrent = { hash: 's2a', title: 'Тёмная материя / Dark Matter [S02] 2160p WEB-DL', category: 'tv', stat: 3, torrent_size: 6 * GB, timestamp: 4, data: files(['S02E01.mkv', 'S02E02.mkv']) };
const S2B: Torrent = { hash: 's2b', title: 'Тёмная материя / Dark Matter [S02] 1080p WEB-DL', category: 'tv', stat: 3, torrent_size: 3 * GB, timestamp: 3, data: files(['S02E01.mkv', 'S02E02.mkv']) };
const PACK: Torrent = { hash: 'p12', title: 'Тёмная материя / Dark Matter Complete 720p', category: 'tv', stat: 3, torrent_size: 5 * GB, timestamp: 2, data: files(['S01E01.mkv', 'S02E01.mkv']) };

const SHOW: CatalogCard = {
  kind: 'tv', id: 22, title: 'Тёмная материя', original: 'Dark Matter', year: 2024, poster: '', rating: 7.6, backdrop: '',
  genres: [], runtime: 50, overview: '', cast: [],
  seasons: [
    { number: 2, episodes: 10, year: 2025, aired: 10 },
    { number: 1, episodes: 9, year: 2024, aired: 9 },
  ],
  airing: false,
  status: 'ended',
  nextEpisode: null,
};

let el: HTMLElement;
let serverList: Torrent[];
let removeSpy: ReturnType<typeof vi.spyOn>;

async function flush() {
  for (let round = 0; round < 3; round++) {
    await act(async () => {
      for (let i = 0; i < 15; i++) await Promise.resolve();
    });
  }
}

function key(list: Torrent[]): string {
  return (groupLibrary(list).find((x) => x.kind === 'series') as SeriesGroup).key;
}

async function open(list: Torrent[], season?: number) {
  torrents.value = list;
  serverList = list.slice();
  const k = key(list);
  navigate({ name: 'series', key: k, season });
  unmountConfirmHost();
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<Series seriesKey={k} />, el));
  mountConfirmHost();
  await flush();
}

const shown = () => el.querySelector('[data-release-switch]')!.getAttribute('data-hash');
const openReleases = () => act(() => (el.querySelector('[data-release-switch] .m-btn-text') as HTMLElement).click());
/** The releases «Другая раздача» lists for the season (the sheet is closed again). */
function rowHashes(): string[] {
  openReleases();
  const list = Array.from(document.querySelectorAll('[data-release]')).map((r) => r.getAttribute('data-release')!);
  act(() => (document.querySelector('[data-release][aria-checked="true"]') as HTMLElement).click());
  return list;
}
/** Shows the release (through «Сменить») and opens its menu with «⋯». */
async function menuOf(hash: string) {
  if (shown() !== hash) {
    openReleases();
    act(() => (document.querySelector('[data-release="' + hash + '"]') as HTMLElement).click());
    await flush();
  }
  expect(shown()).toBe(hash);
  act(() => (el.querySelector('.m-release-more') as HTMLElement).click());
}
const option = (text: string) =>
  Array.from(document.querySelectorAll('.m-opt')).find((b) => (b.textContent || '').trim() === text) as HTMLButtonElement | undefined;
const options = () => Array.from(document.querySelectorAll('.m-opt')).map((b) => (b.textContent || '').trim());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  localStorage.clear();
  reloadTvs();
  reloadProgress();
  serverViewed.value = [];
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  vi.spyOn(TorrServerClient.prototype, 'list').mockImplementation(async () => serverList);
  vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
  removeSpy = vi.spyOn(TorrServerClient.prototype, 'remove').mockImplementation(async (h: string) => {
    serverList = serverList.filter((x) => x.hash !== h);
  });
  resetSeriesMatches();
  resetTo({ name: 'library' });
  // TMDB knows seasons 1 and 2: a season left with no release shows as missing
  setCatalogClientForTests({
    novelties: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    discover: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    search: vi.fn(() => Promise.resolve({ items: [{ kind: 'tv' as const, id: 22, title: 'Тёмная материя', original: 'Dark Matter', year: 2024, poster: '', rating: 7.6 }], pages: 1 })),
    card: vi.fn(() => Promise.resolve(SHOW)),
    season: vi.fn(() => Promise.reject(new Error('catalog:offline'))),
  });
});

afterEach(() => {
  unmountConfirmHost();
  if (el) act(() => render(null, el));
  vi.useRealTimers();
  vi.restoreAllMocks();
  applyLanguageSetting('ru');
  setCatalogClientForTests(null);
});

describe('release menu on the series screen', () => {
  it('«⋯» opens the menu without «Выбрать»; one release of the season: no «Оставить только эту»', async () => {
    await open([S1, S2A], 2);
    await menuOf('s2a');
    expect(currentRoute.value.name).toBe('series');
    expect(options()).toEqual(['Открыть', 'Переименовать', 'Сменить постер', 'Удалить']);
  });

  it('a pack holding two seasons shows only the chosen season\'s episodes', async () => {
    await open([S1, PACK], 2);
    expect(shown()).toBe('p12');
    const eps = Array.from(el.querySelectorAll('.m-ep')).map((r) => r.textContent || '');
    expect(eps.length).toBe(1);
    expect(eps[0]).toContain('S02E01');
  });

  it('«Открыть» in the menu opens the release page', async () => {
    await open([S1, S2A], 2);
    await menuOf('s2a');
    act(() => option('Открыть')!.click());
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: 's2a' });
  });

  it('«Сменить» shows another release of the season on the same screen', async () => {
    await open([S1, S2A, S2B], 2);
    expect(shown()).toBe('s2a');
    expect(el.querySelector('[data-release-switch]')!.textContent).toContain('Раздача: 4K');
    openReleases();
    expect(document.querySelector('[data-code="PD55"]')).toBeTruthy();
    expect(document.querySelector('[data-release="s2a"]')!.getAttribute('aria-checked')).toBe('true');
    act(() => (document.querySelector('[data-release="s2b"]') as HTMLElement).click());
    await flush();
    expect(document.querySelector('[data-code="PD55"]')).toBeNull();
    expect(shown()).toBe('s2b');
    expect(el.querySelector('[data-release-switch]')!.textContent).toContain('Раздача: 1080p');
    expect(currentRoute.value.name).toBe('series');
  });

  it('«Оставить только эту» deletes the other releases of the season, not a pack holding another season', async () => {
    expect(seasonsOf(PACK)).toEqual([1, 2]);
    await open([S1, S2A, S2B, PACK], 2);
    expect(rowHashes().sort()).toEqual(['p12', 's2a', 's2b']);
    await menuOf('s2a');
    expect(options()).toEqual(['Открыть', 'Переименовать', 'Сменить постер', 'Оставить только эту', 'Удалить']);
    // the sheet names the release that stays: the series name and the release's quality
    expect(document.querySelector('.m-sheet-title')!.textContent).toBe('Тёмная материя · 4K WEB-DL');
    act(() => option('Оставить только эту')!.click());
    expect(confirmText()).toBe('Удалить ещё 1 раздачу 2-го сезона?');
    expect(document.querySelector('[data-confirm="danger"]')!.textContent).toBe('Оставить только эту');
    await acceptConfirm();
    await flush();
    expect(removeSpy.mock.calls.map((c: unknown[]) => c[0])).toEqual(['s2b']);
    expect(document.querySelector('.m-opt')).toBeNull();
    expect(rowHashes().sort()).toEqual(['p12', 's2a']);
    expect(torrents.value.map((x) => x.hash).sort()).toEqual(['p12', 's1', 's2a']);
  });

  it('declining the confirm deletes nothing and keeps the menu', async () => {
    await open([S1, S2A, S2B], 2);
    await menuOf('s2b');
    act(() => option('Оставить только эту')!.click());
    expect(confirmText()).toBe('Удалить ещё 1 раздачу 2-го сезона?');
    await declineConfirm();
    await flush();
    expect(removeSpy).not.toHaveBeenCalled();
    expect(option('Удалить')).toBeTruthy();
  });

  it('only packs besides it: no «Оставить только эту»', async () => {
    await open([S1, S2A, PACK], 2);
    await menuOf('s2a');
    expect(options()).toEqual(['Открыть', 'Переименовать', 'Сменить постер', 'Удалить']);
  });

  it('English: the plural confirm', async () => {
    applyLanguageSetting('en');
    const S2C: Torrent = { ...S2B, hash: 's2c', title: 'Тёмная материя / Dark Matter [S02] 720p WEB-DL', timestamp: 2 };
    await open([S1, S2A, S2B, S2C], 2);
    await menuOf('s2a');
    act(() => option('Keep only this one')!.click());
    expect(confirmText()).toBe('Delete 2 more torrents of season 2?');
    await acceptConfirm();
    await flush();
    expect(removeSpy.mock.calls.map((c: unknown[]) => c[0]).sort()).toEqual(['s2b', 's2c']);
  });

  it('deleting the only release of the season leaves it missing («+ Сезон 2») in place', async () => {
    await open([S1, S2A], 2);
    await menuOf('s2a');
    act(() => option('Удалить')!.click());
    await acceptConfirm();
    await flush();
    expect(removeSpy.mock.calls.map((c: unknown[]) => c[0])).toEqual(['s2a']);
    expect(currentRoute.value.name).toBe('series');
    const chip = Array.from(el.querySelectorAll('.m-chip')).find((c) => c.getAttribute('aria-label') === 'Сезон 2, нет в каталоге');
    expect(chip).toBeTruthy();
    expect(chip!.classList.contains('on')).toBe(true);
    expect(el.querySelector('.m-sh-missing')).toBeTruthy();
  });

  it('deleting the last release of the series goes back to the library', async () => {
    await open([S2A, S2B], 2);
    await menuOf('s2a');
    act(() => option('Удалить')!.click());
    await acceptConfirm();
    await flush();
    expect(currentRoute.value.name).toBe('series');
    expect(rowHashes()).toEqual(['s2b']);
    await menuOf('s2b');
    act(() => option('Удалить')!.click());
    await acceptConfirm();
    await flush();
    expect(torrents.value).toEqual([]);
    expect(currentRoute.value.name).toBe('library');
  });
});

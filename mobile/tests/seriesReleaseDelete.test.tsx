// The trash in «Другая раздача» of a series season: a release of that season only (never a pack holding another
// season) goes after a confirm, what was watched in it moves to the one that stays; the shown one going hands the
// season over to the one that stays; the release playing on the TV is never removed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Series } from '../src/screens/Series';
import { navigate, resetTo } from '../src/nav';
import { reloadTvs } from '../src/tv/tvStore';
import { groupLibrary, type SeriesGroup } from '../../src/lib/seriesGroups';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { getLocalProgress, reloadProgress, saveProgress, serverViewed } from '../../src/store/progress';
import { nowPlaying } from '../src/tv/playerLink';
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


const trash = (hash: string) => document.querySelector('[data-release-delete="' + hash + '"]') as HTMLButtonElement | null;

describe('trash in «Другая раздача»', () => {
  afterEach(() => {
    nowPlaying.value = null;
  });

  it('a release of the season has a trash, a pack of two seasons has none', async () => {
    await open([S1, S2A, S2B, PACK], 2);
    openReleases();
    expect(trash('s2a')).toBeTruthy();
    expect(trash('s2b')).toBeTruthy();
    expect(trash('p12')).toBeNull();
    expect(trash('s2b')!.getAttribute('data-code')).toBe('PD55.2');
  });

  it('deleting another release: a confirm naming the one that stays, then only that one goes', async () => {
    await open([S1, S2A, S2B], 2);
    expect(shown()).toBe('s2a');
    openReleases();
    act(() => trash('s2b')!.click());
    await flush();
    expect(confirmText()).toBe('Удалить раздачу «Тёмная материя · 1080p WEB-DL»? Отметки просмотра перейдут в «Тёмная материя · 4K WEB-DL».');
    await acceptConfirm();
    await flush();
    expect(removeSpy.mock.calls.map((c: unknown[]) => c[0])).toEqual(['s2b']);
    expect(shown()).toBe('s2a');
    expect(torrents.value.map((x) => x.hash).sort()).toEqual(['s1', 's2a']);
  });

  it('deleting the shown release says so, moves the progress and shows the one that stays', async () => {
    saveProgress('s2b', 2, 300, 1000);
    await open([S1, S2A, S2B], 2);
    expect(shown()).toBe('s2b');
    openReleases();
    act(() => trash('s2b')!.click());
    await flush();
    expect(confirmText()).toContain('Вы смотрите эту раздачу');
    await acceptConfirm();
    await flush();
    expect(removeSpy.mock.calls.map((c: unknown[]) => c[0])).toEqual(['s2b']);
    expect(shown()).toBe('s2a');
    expect(getLocalProgress('s2a', 2)!.time).toBe(300);
    expect(getLocalProgress('s2b', 2)).toBeNull();
  });

  it('declining deletes nothing', async () => {
    await open([S1, S2A, S2B], 2);
    openReleases();
    act(() => trash('s2b')!.click());
    await flush();
    await declineConfirm();
    await flush();
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('the release playing on the TV is not removed', async () => {
    await open([S1, S2A, S2B], 2);
    nowPlaying.value = { hash: 's2b', file: 1, title: '', subtitle: '', time: 1, duration: 2, paused: false, buffering: false, audio: { list: [], current: -1 }, subs: { list: [], current: '' }, next: null } as never;
    openReleases();
    act(() => trash('s2b')!.click());
    await flush();
    expect(confirmText()).toBe('');
    expect(removeSpy).not.toHaveBeenCalled();
  });
});

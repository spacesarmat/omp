import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';
import { Torrent } from '../src/screens/Torrent';
import { setWatchActions } from '../src/watch';
import { currentRoute, resetTo, navigate } from '../src/nav';
import { reloadTvs } from '../src/tv/tvStore';
import { setCatalogClientForTests } from '../src/catalog/phoneCatalog';
import { resetEpisodeNames } from '../src/lib/episodeNames';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { reloadProgress, serverViewed } from '../../src/store/progress';
import { TorrServerClient } from '../../src/api/torrserver';
import type { Torrent as T } from '../../src/api/types';

const files = (s: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    path: `Starbound.Frontier.S0${s}E0${i + 1}.1080p.Ru.Ultradox.mkv`,
    length: 1900000000,
  }));
const mk = (hash: string, s: number, n = 3): T => ({
  hash,
  title: `Starbound Frontier S0${s} 1080p WEB-DL`,
  category: 'tv',
  stat: 3,
  torrent_size: 18 * 1024 ** 3,
  total_peers: 12,
  file_stats: files(s, n),
});
const s2 = mk('abc', 2);

const title = { kind: 'tv' as const, id: 7, title: 'Starbound Frontier', original: 'Starbound Frontier', year: 2020, poster: '', rating: 0 };
const card = (seasons: number[]) => ({
  ...title,
  backdrop: '',
  genres: [],
  runtime: 0,
  overview: '',
  cast: [],
  airing: false,
  seasons: seasons.map((number) => ({ number, episodes: 3, year: 2020, aired: 3 })),
});
const ep = (n: number, t: string, runtime = 45) => ({ n, title: t, airDate: '', runtime, overview: '' });

function fake(seasons: number[], episodes = [ep(1, 'Landfall'), ep(2, 'Dark Orbit')]) {
  return {
    novelties: vi.fn(),
    discover: vi.fn(),
    search: vi.fn().mockResolvedValue({ items: [title], pages: 1 }),
    card: vi.fn().mockResolvedValue(card(seasons)),
    season: vi.fn().mockResolvedValue({ number: 2, name: '', airDate: '', overview: '', episodes }),
  };
}

let el: HTMLElement;
// effects run after a render and each step (show, then seasons) needs its own: several rounds
async function flush() {
  for (let round = 0; round < 6; round++) {
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
  }
}
function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<Torrent hash="abc" />, el));
}
const rows = () => Array.from(el.querySelectorAll('.m-ep'));
const chips = () => Array.from(el.querySelectorAll('[data-block="seasons"] .m-chip')) as HTMLElement[];
const mainLine = (i: number) => rows()[i].querySelector('.m-ep-name')!.textContent;

beforeEach(() => {
  localStorage.clear();
  reloadTvs();
  reloadProgress();
  resetEpisodeNames();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  torrents.value = [s2];
  serverViewed.value = [];
  setWatchActions({ recordWatch: vi.fn(), ompVersion: async () => null, reportUrl: async () => null, launchOnTv: vi.fn(), openExternal: vi.fn(), copyText: vi.fn(), remoteDelayMs: 0 });
  resetTo({ name: 'library' });
  navigate({ name: 'torrent', hash: 'abc' });
  vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'probe').mockResolvedValue(null);
});

afterEach(() => {
  act(() => render(null, el));
  setCatalogClientForTests(null);
  applyLanguageSetting('ru');
  vi.restoreAllMocks();
  setWatchActions(null);
});

describe('Torrent: TMDB episode names', () => {
  it('shows rows at once, then fills the names and the runtime from TMDB', async () => {
    const c = fake([1, 2]);
    setCatalogClientForTests(c);
    mount();
    expect(mainLine(0)).toBe('Серия 1');
    await flush();
    expect(c.season).toHaveBeenCalledWith(7, 2);
    expect(mainLine(0)).toContain('1. Landfall');
    expect(mainLine(0)).toContain('45 мин');
    const sub = rows()[0].querySelector('.m-ep-sub')!.textContent!;
    expect(sub).toContain('S02E01');
    expect(sub).toContain('Starbound Frontier S02E01 1080p Ru Ultradox');
    expect(sub).toContain('GB');
    expect(rows()[0].querySelector('.m-bar-track')).toBeTruthy();
  });

  it('falls back to «Серия N» without TMDB', async () => {
    setCatalogClientForTests({ ...fake([2]), search: () => Promise.reject(new Error('catalog:nokey')) });
    mount();
    await flush();
    expect(rows().map((_, i) => mainLine(i))).toEqual(['Серия 1', 'Серия 2', 'Серия 3']);
  });

  it('keeps «Серия N» for an episode TMDB does not list', async () => {
    setCatalogClientForTests(fake([2]));
    mount();
    await flush();
    expect(mainLine(0)).toContain('1. Landfall');
    expect(mainLine(2)).toBe('Серия 3');
  });

  it('renders in English', async () => {
    applyLanguageSetting('en');
    setCatalogClientForTests(fake([1, 2]));
    mount();
    await flush();
    expect(mainLine(1)).toContain('2. Dark Orbit');
    expect(mainLine(1)).toContain('45 min');
    expect(mainLine(2)).toBe('Episode 3');
    expect(chips().map((x) => x.textContent)).toEqual(['+ Season 1', 'Season 2']);
  });

  it('matches the show once per torrent', async () => {
    const c = fake([2]);
    setCatalogClientForTests(c);
    mount();
    await flush();
    act(() => render(null, el));
    mount();
    await flush();
    expect(c.search).toHaveBeenCalledTimes(1);
  });
});

describe('Torrent: season chips', () => {
  it('is hidden for a single season TMDB adds nothing to', async () => {
    setCatalogClientForTests(fake([2]));
    mount();
    await flush();
    expect(chips().length).toBe(0);
  });

  it('highlights the current season and opens another library season', async () => {
    torrents.value = [mk('s1', 1), s2, mk('s3', 3)];
    setCatalogClientForTests(fake([1, 2, 3]));
    mount();
    await flush();
    expect(chips().map((x) => x.textContent)).toEqual(['Сезон 1', 'Сезон 2', 'Сезон 3']);
    expect(chips().map((x) => x.classList.contains('on'))).toEqual([false, true, false]);
    act(() => chips()[2].click());
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: 's3' });
  });

  it('opens the series screen when the season has several torrents', async () => {
    torrents.value = [mk('s1', 1), mk('s1b', 1), s2];
    setCatalogClientForTests(fake([1, 2]));
    mount();
    await flush();
    act(() => chips()[0].click());
    expect(currentRoute.value).toEqual({ name: 'series', key: 'starbound frontier', season: 1 });
  });

  it('dims the seasons only TMDB has and leads them to «Добавить»', async () => {
    torrents.value = [s2, mk('s3', 3)];
    setCatalogClientForTests(fake([1, 2, 3, 4]));
    mount();
    await flush();
    expect(chips().map((x) => x.textContent)).toEqual(['+ Сезон 1', 'Сезон 2', 'Сезон 3', '+ Сезон 4']);
    expect(chips().map((x) => x.classList.contains('dim'))).toEqual([true, false, false, true]);
    act(() => chips()[3].click());
    expect(currentRoute.value).toEqual({ name: 'add', query: 'Starbound Frontier 4 сезон', run: true });
  });
});

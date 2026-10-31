// A release that stopped answering: TorrServer lists it without file_stats and its `data` holds only what OMP wrote
// (the tracker seed count), so the series screen used to show no episodes at all. The files this phone saw last are
// listed instead; never seen here, the season's episodes from TMDB are shown muted with a note.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Series } from '../src/screens/Series';
import { Torrent as TorrentScreen } from '../src/screens/Torrent';
import { navigate, resetTo } from '../src/nav';
import { reloadTvs } from '../src/tv/tvStore';
import { seriesKey } from '../../src/lib/seriesGroups';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { reloadProgress, serverViewed } from '../../src/store/progress';
import { applyLanguageSetting } from '../../src/i18n';
import { setCatalogClientForTests } from '../src/catalog/phoneCatalog';
import { resetSeriesMatches } from '../../src/lib/seriesMatch';
import { resetEpisodeNames } from '../../src/lib/episodeNames';
import { rememberFiles, resetKnownFilesForTests } from '../../src/lib/knownFiles';
import { TorrServerClient } from '../../src/api/torrserver';
import type { CatalogCard, Episode } from '../../src/catalog/tmdb';
import type { Torrent } from '../../src/api/types';

const GB = 1024 ** 3;
const SEEDS_ONLY = JSON.stringify({ omp: { v: 1, h: [], ts: { s: 10, at: 1 } } });
const dead = (hash: string): Torrent => ({
  hash, title: 'Квест Вижна / VisionQuest [S01] (2026) 1080p WEB-DL', category: 'tv', stat: 0, torrent_size: 11 * GB, timestamp: 1, data: SEEDS_ONLY,
});
const EIGHT = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, path: 'VisionQuest/VisionQuest.S01E0' + (i + 1) + '.mkv', length: GB }));
const TMDB_EPS: Episode[] = Array.from({ length: 8 }, (_, i) => ({ n: i + 1, title: 'Глава ' + (i + 1), airDate: '2026-0' + (i < 9 ? 1 : 2) + '-1' + i, runtime: 50, overview: '' }));

const SHOW: CatalogCard = {
  kind: 'tv', id: 77, title: 'Квест Вижна', original: 'VisionQuest', year: 2026, poster: '', rating: 7, backdrop: '',
  genres: [], runtime: 50, overview: '', cast: [],
  seasons: [{ number: 1, episodes: 8, year: 2026, aired: 8 }],
  airing: false, status: 'ended', nextEpisode: null,
};

let el: HTMLElement;
let serverList: Torrent[];

async function flush() {
  for (let round = 0; round < 4; round++) {
    await act(async () => {
      for (let i = 0; i < 15; i++) await Promise.resolve();
    });
  }
}

function mount(node: preact.ComponentChild) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(node, el));
}

async function openSeries(list: Torrent[]) {
  torrents.value = list;
  serverList = list.slice();
  const k = seriesKey(list[0]);
  navigate({ name: 'series', key: k });
  mount(<Series seriesKey={k} />);
  await flush();
}

const fileRows = () => Array.from(el.querySelectorAll('.m-ep:not(.m-ep-coming)'));
const tmdbRows = () => Array.from(el.querySelectorAll('[data-tmdb]')).map((r) => (r.textContent || '').trim());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  localStorage.clear();
  resetKnownFilesForTests();
  resetEpisodeNames();
  reloadTvs();
  reloadProgress();
  serverViewed.value = [];
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  vi.spyOn(TorrServerClient.prototype, 'list').mockImplementation(async () => serverList);
  vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
  // the release does not answer: the metadata never comes
  vi.spyOn(TorrServerClient.prototype, 'loadInfo').mockImplementation(() => new Promise<Torrent>(() => {}));
  vi.spyOn(TorrServerClient.prototype, 'get').mockImplementation(() => new Promise<Torrent>(() => {}));
  resetSeriesMatches();
  resetTo({ name: 'library' });
  setCatalogClientForTests({
    novelties: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    discover: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    search: vi.fn(() => Promise.resolve({ items: [{ kind: 'tv' as const, id: 77, title: 'Квест Вижна', original: 'VisionQuest', year: 2026, poster: '', rating: 7 }], pages: 1 })),
    card: vi.fn(() => Promise.resolve(SHOW)),
    season: vi.fn((_id: number, n: number) => Promise.resolve({ number: n, name: '', airDate: '', overview: '', episodes: n === 1 ? TMDB_EPS : [] })),
  });
});

afterEach(() => {
  if (el) act(() => render(null, el));
  vi.useRealTimers();
  vi.restoreAllMocks();
  applyLanguageSetting('ru');
  setCatalogClientForTests(null);
});

describe('series screen: a release that does not answer', () => {
  it('lists the episodes this phone saw last (tappable), not the TMDB stand-in', async () => {
    rememberFiles('dead1', EIGHT);
    await openSeries([dead('dead1')]);
    expect(fileRows()).toHaveLength(8);
    expect(el.textContent).toContain('Серии');
    expect(el.querySelector('[data-block="tmdb-episodes"]')).toBeNull();
  });

  it('never seen here: the season\'s episodes from TMDB, muted, with a note', async () => {
    await openSeries([dead('dead2')]);
    expect(fileRows()).toHaveLength(0);
    const rows = tmdbRows();
    expect(rows).toHaveLength(8);
    expect(rows[0]).toBe('1. Глава 1');
    expect(el.querySelector('[data-tmdb]')!.getAttribute('aria-disabled')).toBe('true');
    expect(el.querySelector('[data-block="tmdb-episodes"]')!.textContent).toContain('список серий из TMDB');
  });

  it('a release with its files known shows no TMDB stand-in', async () => {
    const ok: Torrent = { ...dead('live1'), data: JSON.stringify({ TorrServer: { Files: EIGHT } }) };
    await openSeries([ok]);
    expect(fileRows()).toHaveLength(8);
    expect(tmdbRows()).toHaveLength(0);
  });
});

describe('torrent screen: a release that does not answer', () => {
  it('lists the episodes this phone saw last', async () => {
    rememberFiles('dead3', EIGHT);
    torrents.value = [dead('dead3')];
    serverList = torrents.value.slice();
    mount(<TorrentScreen hash="dead3" />);
    await flush();
    expect(fileRows()).toHaveLength(8);
  });

  it('never seen here: the season\'s episodes from TMDB', async () => {
    torrents.value = [dead('dead4')];
    serverList = torrents.value.slice();
    mount(<TorrentScreen hash="dead4" />);
    await flush();
    expect(tmdbRows()).toHaveLength(8);
  });
});

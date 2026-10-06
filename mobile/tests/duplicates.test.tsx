// Several releases of one thing — information only: the season's releases on the series screen, a toast after an
// add; nothing is deleted from here.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { groupLibrary, isSeries, seasonMembers, type SeriesGroup } from '../src/lib/seriesGroups';
import { alreadyHaveText, contentsText, filmKeys, releaseLine, sameReleases } from '../src/lib/duplicates';
import { fileEpisodes } from '../../src/lib/categoryCheck';
import { Series } from '../src/screens/Series';
import { addSearchResult } from '../src/addResult';
import { navigate, resetTo } from '../src/nav';
import { toast } from '../src/ui/toast';
import { reloadTvs } from '../src/tv/tvStore';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { reloadProgress, serverViewed } from '../../src/store/progress';
import { setCatalogClientForTests } from '../src/catalog/phoneCatalog';
import { resetSeriesMatches } from '../src/lib/seriesMatch';
import { TorrServerClient } from '../../src/api/torrserver';
import type { Torrent } from '../../src/api/types';
import type { SourceResult } from '../../src/sources/types';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

function files(names: string[], length = 500 * MB) {
  return JSON.stringify({ TorrServer: { Files: names.map((p, i) => ({ id: i + 1, path: p, length })) } });
}
const two = (i: number) => (i < 9 ? '0' : '') + (i + 1);
function eps(prefix: string, n: number, suffix = '.mkv'): string[] {
  return Array.from({ length: n }, (_, i) => prefix + two(i) + suffix);
}

// the real pair from a user's server: the 1080p one (18 files, filed under «Фильмы»); the 4K one has 16 files, the
// first two holding two episodes each
const SPIRIT_1080: Torrent = {
  hash: 'a'.repeat(40), title: 'Повелитель духов / E01-E18 Yu Ling Shi - AniLiberty.TOP [WEB-DL 1080p][HEVC][1-18]',
  category: 'movie', stat: 3, torrent_size: 5.4 * GB, timestamp: 1, data: files(eps('Yu Ling Shi/Yu Ling Shi - ', 18, ' [AniLiberty] [1080p].mkv'), 300 * MB),
};
const SPIRIT_2160: Torrent = {
  hash: 'b'.repeat(40), title: 'Повелитель духов (S1E1-18 of 18) / Yu Ling Shi / B.King / Spirit Master (2026) WEBRip 2160p | AVC',
  category: 'tv', stat: 3, torrent_size: 9.7 * GB, timestamp: 2,
  data: files(['Повелитель духов 1-2 серия [4K] WEBRip.mkv', 'Повелитель духов 3-4 серия [4K] WEBRip.mkv'].concat(
    Array.from({ length: 14 }, (_, i) => 'Повелитель духов ' + (i + 5) + ' серия [4K] WEBRip.mkv'),
  ), 650 * MB),
};
const S1_1080: Torrent = { hash: 'c1', title: 'Тёмная материя / Dark Matter [S01] 1080p WEB-DL', category: 'tv', stat: 3, torrent_size: 4 * GB, timestamp: 1, data: files(eps('Dark.Matter.S01E', 9)) };
const S1_4K: Torrent = { hash: 'c3', title: 'Тёмная материя / Dark Matter [S01] 2160p WEB-DL', category: 'tv', stat: 3, torrent_size: 9 * GB, timestamp: 3, data: files(eps('Dark.Matter.S01E', 9)) };
const S2_4K: Torrent = { hash: 'c4', title: 'Тёмная материя / Dark Matter [S02] 2160p WEB-DL', category: 'tv', stat: 3, torrent_size: 9 * GB, timestamp: 4, data: files(eps('Dark.Matter.S02E', 9)) };
const FILM_1080: Torrent = { hash: 'f1', title: 'Дюна / Dune (2021) BDRip 1080p', category: 'movie', stat: 3, torrent_size: 8 * GB, timestamp: 1, data: files(['Dune.mkv'], 8 * GB) };
const FILM_4K: Torrent = { hash: 'f2', title: 'Dune (2021) 2160p WEB-DL', category: 'movie', stat: 3, torrent_size: 20 * GB, timestamp: 2, data: files(['Dune.2160p.mkv'], 20 * GB) };
const FILM_1984: Torrent = { hash: 'f3', title: 'Дюна / Dune (1984) BDRip 1080p', category: 'movie', stat: 3, torrent_size: 8 * GB, timestamp: 1, data: files(['Dune.mkv'], 8 * GB) };
const WAR_HORSE: Torrent = { hash: 'w1', title: 'Боевой конь / War Horse (Стивен Спилберг / Steven Spielberg) [2011, драма, BDRip 1080p]', category: 'movie', stat: 3, torrent_size: 8 * GB, data: files(['War.Horse.mkv'], 8 * GB) };
const TINTIN: Torrent = { hash: 'w2', title: 'Приключения Тинтина / The Adventures of Tintin (Стивен Спилберг / Steven Spielberg) [2011, мультфильм, 2160p]', category: 'movie', stat: 3, torrent_size: 20 * GB, data: files(['Tintin.mkv'], 20 * GB) };

let el: HTMLElement;
let serverList: Torrent[];
let removeSpy: ReturnType<typeof vi.spyOn>;

async function flush() {
  for (let r = 0; r < 3; r++) {
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

beforeEach(() => {
  localStorage.clear();
  reloadTvs();
  reloadProgress();
  serverViewed.value = [];
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  serverList = [];
  vi.spyOn(TorrServerClient.prototype, 'list').mockImplementation(async () => serverList);
  vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
  removeSpy = vi.spyOn(TorrServerClient.prototype, 'remove').mockImplementation(async (h: string) => {
    serverList = serverList.filter((x) => x.hash !== h);
  });
  window.confirm = vi.fn(() => false);
  toast.value = '';
  resetSeriesMatches();
  resetTo({ name: 'library' });
  setCatalogClientForTests({
    novelties: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    discover: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    search: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    card: vi.fn(() => Promise.reject(new Error('catalog:bad'))),
  });
  torrents.value = [];
});

afterEach(() => {
  if (el) act(() => render(null, el));
  vi.restoreAllMocks();
  setCatalogClientForTests(null);
});

describe('grouping', () => {
  it('«Повелитель духов»: the «Фильмы» release with 18 episode files is a series, in season 1 with the 4K one', () => {
    expect(isSeries(SPIRIT_1080)).toBe(true);
    expect(isSeries({ ...SPIRIT_1080, data: '' })).toBe(false);
    const g = groupLibrary([SPIRIT_1080, SPIRIT_2160])[0] as SeriesGroup;
    expect(g.members).toHaveLength(2);
    expect(g.seasons).toEqual([1]);
    expect(seasonMembers(g, 1)).toHaveLength(2);
  });

  it('films stay films: numbered extras, «Сезон охоты 2» with no category and no files', () => {
    expect(isSeries(FILM_1080)).toBe(false);
    expect(isSeries({ hash: 'o', title: 'Сезон охоты 2 / Open Season 2 (2008) BDRip', category: '', data: '' } as Torrent)).toBe(false);
    expect(isSeries({ hash: 'o2', title: 'Тёмная материя / Dark Matter [S02] 1080p', category: '', data: '' } as Torrent)).toBe(true);
  });
});

describe('episode file names', () => {
  it('several episodes in one file', () => {
    expect(fileEpisodes('Show.S01E01E02.mkv')).toEqual({ season: 1, episodes: [1, 2] });
    expect(fileEpisodes('Show.S01E01+E02.mkv')).toEqual({ season: 1, episodes: [1, 2] });
    expect(fileEpisodes('Show.S01E01.E02.mkv')).toEqual({ season: 1, episodes: [1, 2] });
    expect(fileEpisodes('Show.E01E02.mkv')).toEqual({ season: null, episodes: [1, 2] });
    expect(fileEpisodes('Show.S01E01-E08.mkv')).toEqual({ season: 1, episodes: [1, 2, 3, 4, 5, 6, 7, 8] });
    expect(fileEpisodes('Show.S01E01-S01E08.mkv')!.episodes).toHaveLength(8);
    expect(fileEpisodes('Show S01E01-S01E02.mkv')).toEqual({ season: 1, episodes: [1, 2] });
    expect(fileEpisodes('Show Серии 01-02.mkv')).toEqual({ season: null, episodes: [1, 2] });
    expect(fileEpisodes('Повелитель духов 1-2 серия [4K].mkv')).toEqual({ season: null, episodes: [1, 2] });
  });

  it('what cannot be read for sure is unknown: over two seasons, fractional', () => {
    expect(fileEpisodes('Show.S01E10-S02E01.mkv')).toBeNull();
    expect(fileEpisodes('Show.S01E01-S02E02.mkv')).toBeNull();
    expect(fileEpisodes('Show.Ep12.5.mkv')).toBeNull();
    expect(fileEpisodes('Show.S01E12.5.mkv')).toBeNull();
    expect(fileEpisodes('Anime - 12.5 [1080p].mkv')).toBeNull();
    expect(fileEpisodes('Anime [12.5].mkv')).toBeNull();
    // codecs and picture sizes are no episodes or fractions
    expect(fileEpisodes('Show.S01E05.2160p.DDP5.1.mkv')).toEqual({ season: 1, episodes: [5] });
    expect(fileEpisodes('Movie [720].mkv')).toBeNull();
  });
});

describe('what a release holds, for showing', () => {
  it('episodes when every video names them, else files; samples aside', () => {
    expect(contentsText(SPIRIT_2160)).toBe('18 серий');
    expect(contentsText(SPIRIT_1080)).toBe('18 серий');
    const mixed = { ...S1_1080, data: files(eps('Show.S01E', 9).concat(['Show.Finale.mkv'])) };
    expect(contentsText(mixed)).toBe('10 файлов');
    const sample = { ...S1_1080, data: files(eps('Show.S01E', 9).concat(['Show.S01E05.sample.mkv'])) };
    expect(contentsText(sample)).toBe('9 серий');
    expect(contentsText(FILM_1080)).toBe('');
    expect(releaseLine(SPIRIT_2160)).toBe('4K WEB-DL · 18 серий · 9,7 ГБ');
    expect(releaseLine(FILM_1080)).toBe('1080p BDRip · 8,0 ГБ');
  });

  it('the same season of a series, or the same film title and year; another season or another film is not', () => {
    expect(sameReleases([S1_1080, S1_4K, S2_4K], S1_4K)).toEqual([S1_1080]);
    expect(sameReleases([S1_1080, S1_4K, S2_4K], S2_4K)).toEqual([]);
    expect(sameReleases([SPIRIT_1080, SPIRIT_2160], SPIRIT_2160)).toEqual([SPIRIT_1080]);
    expect(sameReleases([FILM_1080, FILM_1984], FILM_4K)).toEqual([FILM_1080]);
    expect(sameReleases([WAR_HORSE], TINTIN)).toEqual([]);
    expect(filmKeys(WAR_HORSE).every((k) => k.endsWith('|2011') && k.indexOf('spielberg') < 0)).toBe(true);
  });
});

describe('after an add: a toast, nothing deleted', () => {
  function result(t: Torrent): SourceResult {
    return { Title: t.title, Magnet: 'magnet:?xt=urn:btih:' + t.hash, Hash: t.hash, Link: '', Size: '', Categories: '', CreateDate: '', Tracker: '', Peer: 0, Seed: 1, source: 'x' } as SourceResult;
  }

  it('a season already there: «Такая раздача уже есть: 4K WEB-DL · 9,0 ГБ»', async () => {
    torrents.value = [S1_4K];
    serverList = [S1_4K];
    vi.spyOn(TorrServerClient.prototype, 'add').mockImplementation(async () => ({ ...S1_1080 }));
    await addSearchResult(result(S1_1080), 'tv');
    expect(toast.value).toBe('Такая раздача уже есть: 4K WEB-DL · 9,0 ГБ');
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('a film already there; another season or another film: no toast', async () => {
    torrents.value = [FILM_1080];
    vi.spyOn(TorrServerClient.prototype, 'add').mockImplementation(async () => ({ ...FILM_4K }));
    await addSearchResult(result(FILM_4K), 'movie');
    expect(toast.value).toBe('Такая раздача уже есть: 1080p BDRip · 8,0 ГБ');
    toast.value = '';
    torrents.value = [S1_1080, WAR_HORSE];
    expect(alreadyHaveText(S2_4K.hash, S2_4K.title, 'tv')).toBe('');
    expect(alreadyHaveText(TINTIN.hash, TINTIN.title, 'movie')).toBe('');
  });
});

describe('series screen', () => {
  async function open(list: Torrent[], season: number) {
    torrents.value = list;
    serverList = list.slice();
    const k = (groupLibrary(list).find((x) => x.kind === 'series') as SeriesGroup).key;
    navigate({ name: 'series', key: k, season });
    mount(<Series seriesKey={k} />);
    await flush();
  }

  it('two releases of the season: the info row lists each; a tap opens its menu, nothing is deleted', async () => {
    await open([SPIRIT_1080, SPIRIT_2160], 1);
    const info = el.querySelector('[data-dup-info]')!;
    expect(info.textContent).toContain('2 раздачи этого сезона');
    const lines = Array.from(info.querySelectorAll('[data-dup-line]')).map((b) => b.textContent);
    expect(lines).toEqual(expect.arrayContaining(['1080p WEB-DL · 18 серий · 5,4 ГБ', '4K WEB-DL · 18 серий · 9,7 ГБ']));
    const line = Array.from(info.querySelectorAll('[data-dup-line]')).find((b) => (b.textContent || '').indexOf('1080p') === 0) as HTMLButtonElement;
    act(() => line.click());
    const options = Array.from(document.querySelectorAll('.m-opt')).map((b) => (b.textContent || '').trim());
    expect(options).toContain('Удалить');
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('one release of the season: no info row', async () => {
    await open([S1_1080, S2_4K], 1);
    expect(el.querySelector('[data-dup-info]')).toBeNull();
  });
});

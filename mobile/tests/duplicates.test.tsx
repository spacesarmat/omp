import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('../../src/monitor/replace', async (orig) => ({
  ...(await orig<typeof import('../../src/monitor/replace')>()),
  replaceTorrent: vi.fn(() => Promise.resolve({ ok: true, hash: 'x' })),
}));

import { replaceTorrent } from '../../src/monitor/replace';
import { groupLibrary, isSeries, seasonMembers, type SeriesGroup } from '../src/lib/seriesGroups';
import { coverage, covers, duplicatesOf, dupOffer, dupOfferFor, checkAddedDuplicate, dropLine, filmKeys, worseInSeason } from '../src/lib/duplicates';
import { fileEpisodes } from '../../src/lib/categoryCheck';
import { DuplicateSheet } from '../src/ui/DuplicateSheet';
import { Series } from '../src/screens/Series';
import { addSearchResult } from '../src/addResult';
import { navigate, resetTo } from '../src/nav';
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
const replaceMock = replaceTorrent as unknown as ReturnType<typeof vi.fn>;

function files(names: string[], length = 500 * MB) {
  return JSON.stringify({ TorrServer: { Files: names.map((p, i) => ({ id: i + 1, path: p, length })) } });
}
function filesSized(list: [string, number][]) {
  return JSON.stringify({ TorrServer: { Files: list.map(([p, length], i) => ({ id: i + 1, path: p, length })) } });
}
const two = (i: number) => (i < 9 ? '0' : '') + (i + 1);
function eps(prefix: string, n: number, suffix = '.mkv'): string[] {
  return Array.from({ length: n }, (_, i) => prefix + two(i) + suffix);
}

// the real pair from a user's server: the 1080p one (18 files, filed under «Фильмы») names no season anywhere; the 4K
// one has 16 files, the first two holding two episodes each, in «S1E1-18»
const SPIRIT_1080: Torrent = {
  hash: 'a'.repeat(40), title: 'Повелитель духов / E01-E18 Yu Ling Shi - AniLiberty.TOP [WEB-DL 1080p][HEVC][1-18]',
  category: 'movie', stat: 3, torrent_size: 5.4 * GB, timestamp: 1, data: files(eps('Yu Ling Shi/Yu Ling Shi - ', 18, ' [AniLiberty] [1080p].mkv'), 300 * MB),
};
const SPIRIT_2160: Torrent = {
  hash: 'b'.repeat(40), title: 'Повелитель духов (S1E1-18 of 18) / Yu Ling Shi / B.King / Spirit Master (2026) WEBRip 2160p | AVC',
  category: 'tv', stat: 3, torrent_size: 10.5 * GB, timestamp: 2,
  data: files(['Повелитель духов 1-2 серия [4K] WEBRip.mkv', 'Повелитель духов 3-4 серия [4K] WEBRip.mkv'].concat(
    Array.from({ length: 14 }, (_, i) => 'Повелитель духов ' + (i + 5) + ' серия [4K] WEBRip.mkv'),
  ), 650 * MB),
};
// the same 1080p release with S01 in its file names: now it provably is season 1
const SPIRIT_1080_S01: Torrent = { ...SPIRIT_1080, hash: 'c'.repeat(40), data: files(eps('Yu Ling Shi - S01E', 18, ' [1080p].mkv'), 300 * MB) };

const S1_1080: Torrent = { hash: 'c1', title: 'Тёмная материя / Dark Matter [S01] 1080p WEB-DL', category: 'tv', stat: 3, torrent_size: 4 * GB, timestamp: 1, data: files(eps('Dark.Matter.S01E', 9)) };
const S1_HALF_4K: Torrent = { hash: 'c2', title: 'Тёмная материя / Dark Matter [S01E01-05] 2160p WEB-DL', category: 'tv', stat: 3, torrent_size: 6 * GB, timestamp: 2, data: files(eps('Dark.Matter.S01E', 5)) };
const S1_4K: Torrent = { hash: 'c3', title: 'Тёмная материя / Dark Matter [S01] 2160p WEB-DL', category: 'tv', stat: 3, torrent_size: 9 * GB, timestamp: 3, data: files(eps('Dark.Matter.S01E', 9)) };
const S2_4K: Torrent = { hash: 'c4', title: 'Тёмная материя / Dark Matter [S02] 2160p WEB-DL', category: 'tv', stat: 3, torrent_size: 9 * GB, timestamp: 4, data: files(eps('Dark.Matter.S02E', 9)) };
const S1_4K_NOFILES: Torrent = { hash: 'c5', title: 'Тёмная материя / Dark Matter [Сезон 1] 2160p WEB-DL', category: 'tv', stat: 3, torrent_size: 9 * GB, timestamp: 5 };

const FILM_1080: Torrent = { hash: 'f1', title: 'Дюна / Dune (2021) BDRip 1080p', category: 'movie', stat: 3, torrent_size: 8 * GB, timestamp: 1, data: files(['Dune.mkv'], 8 * GB) };
const FILM_4K: Torrent = { hash: 'f2', title: 'Dune (2021) 2160p WEB-DL', category: 'movie', stat: 3, torrent_size: 20 * GB, timestamp: 2, data: files(['Dune.2160p.mkv'], 20 * GB) };
const FILM_1984: Torrent = { hash: 'f3', title: 'Дюна / Dune (1984) BDRip 1080p', category: 'movie', stat: 3, torrent_size: 8 * GB, timestamp: 1, data: files(['Dune.mkv'], 8 * GB) };
const WAR_HORSE: Torrent = { hash: 'w1', title: 'Боевой конь / War Horse (Стивен Спилберг / Steven Spielberg) [2011, драма, BDRip 1080p]', category: 'movie', stat: 3, torrent_size: 8 * GB, data: files(['War.Horse.mkv'], 8 * GB) };
const TINTIN: Torrent = { hash: 'w2', title: 'Приключения Тинтина / The Adventures of Tintin (Стивен Спилберг / Steven Spielberg) [2011, мультфильм, 2160p]', category: 'movie', stat: 3, torrent_size: 20 * GB, data: files(['Tintin.mkv'], 20 * GB) };

let el: HTMLElement;
let serverList: Torrent[];

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
const button = (text: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === text) as HTMLButtonElement | undefined;

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
  vi.spyOn(TorrServerClient.prototype, 'remove').mockImplementation(async (h: string) => {
    serverList = serverList.filter((x) => x.hash !== h);
  });
  window.confirm = vi.fn(() => true);
  replaceMock.mockClear();
  dupOffer.value = null;
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
  dupOffer.value = null;
});

describe('grouping', () => {
  it('«Повелитель духов»: the «Фильмы» release with 18 episode files is a series and shows in season 1 with the 4K one', () => {
    expect(isSeries(SPIRIT_1080)).toBe(true);
    // its title alone does not make it a series
    expect(isSeries({ ...SPIRIT_1080, data: '' })).toBe(false);
    const items = groupLibrary([SPIRIT_1080, SPIRIT_2160]);
    expect(items).toHaveLength(1);
    const g = items[0] as SeriesGroup;
    expect(g.members).toHaveLength(2);
    expect(g.seasons).toEqual([1]);
    expect(seasonMembers(g, 1)).toHaveLength(2);
  });

  it('films stay films: one file, numbered extras, «Сезон охоты 2» with no category and no files', () => {
    expect(isSeries(FILM_1080)).toBe(false);
    const extras: Torrent = { hash: 'x', title: 'Дюна (2021)', category: 'movie', data: filesSized([['Dune.mkv', 20 * GB], ['Extras/Scene - 01.mkv', GB / 4], ['Extras/Scene - 02.mkv', GB / 4], ['Extras/Scene - 03.mkv', GB / 4]]) } as Torrent;
    expect(isSeries(extras)).toBe(false);
    expect(isSeries({ hash: 'o', title: 'Сезон охоты 2 / Open Season 2 (2008) BDRip', category: '', data: '' } as Torrent)).toBe(false);
    expect(isSeries({ hash: 'o2', title: 'Тёмная материя / Dark Matter [S02] 1080p', category: '', data: '' } as Torrent)).toBe(true);
    expect(isSeries({ hash: 'o3', title: 'Повелитель духов [01-12]', category: '', data: '' } as Torrent)).toBe(true);
  });
});

describe('file names', () => {
  it('ranges and decimals', () => {
    expect(fileEpisodes('Show S01E01-S01E02.mkv')).toEqual({ season: 1, episodes: [1, 2] });
    expect(fileEpisodes('Show Серии 01-02.mkv')).toEqual({ season: null, episodes: [1, 2] });
    expect(fileEpisodes('Show серии 1-2.mkv')).toEqual({ season: null, episodes: [1, 2] });
    expect(fileEpisodes('Anime - 12.5 [1080p].mkv')).toBeNull();
    expect(fileEpisodes('Anime [12.5].mkv')).toBeNull();
  });
});

describe('what a release provably covers', () => {
  it('only from files with explicit seasons; «1-2 серия» holds two episodes', () => {
    const all = Array.from({ length: 18 }, (_, i) => i + 1);
    expect(coverage(SPIRIT_2160)![1].slice().sort((a, b) => a - b)).toEqual(all);
    expect(coverage(SPIRIT_1080_S01)![1]).toHaveLength(18);
    // no season anywhere (title «E01-E18», files «- 01»): proves nothing
    expect(coverage(SPIRIT_1080)).toBeNull();
    expect(coverage(S1_4K_NOFILES)).toBeNull();
    expect(coverage({ ...SPIRIT_2160, data: '' })).toBeNull();
  });

  it('a special, a decimal episode or a file with no episode makes a release not deletable', () => {
    const special = { ...S1_1080, data: files(eps('Show.S01E', 9).concat(['Show.S01.Special.mkv'])) };
    const recap = { ...S1_1080, title: 'Anime [S01] 1080p', data: files(eps('Anime S01 - ', 12, ' [1080p].mkv').concat(['Anime S01 - 12.5 [1080p].mkv'])) };
    const unnamed = { ...S1_1080, data: files(eps('Show.S01E', 8).concat(['Show.Finale.mkv'])) };
    const ova = { ...S1_1080, data: files(eps('Show.S01E', 9).concat(['Show OVA.mkv'])) };
    const s00 = { ...S1_1080, data: files(eps('Show.S01E', 9).concat(['Show.S00E01.mkv'])) };
    [special, recap, unnamed, ova, s00].forEach((t) => expect(coverage(t)).toBeNull());
    // a sample (under 5% of the size) and non-video files do not count
    const sample = { ...S1_1080, data: filesSized(eps('Show.S01E', 9).map((n) => [n, 500 * MB] as [string, number]).concat([['Show.sample.mkv', 20 * MB], ['Show.nfo', 1000]])) };
    expect(coverage(sample)![1]).toHaveLength(9);
    // so none of them is offered for deletion
    expect(dupOfferFor([special, S1_4K], S1_4K)).toBeNull();
    expect(dupOfferFor([unnamed, S1_4K], S1_4K)).toBeNull();
  });

  it('«Серии 01-02» counts both episodes: a release missing episode 2 never covers it', () => {
    const old = { ...S1_1080, data: files(['Show S01 Серии 01-02.mkv'].concat(Array.from({ length: 8 }, (_, i) => 'Show.S01E' + two(i + 2) + '.mkv'))) };
    const better = { ...S1_4K, data: files(['Show.S01E01.mkv'].concat(Array.from({ length: 8 }, (_, i) => 'Show.S01E' + two(i + 2) + '.mkv'))) };
    expect(coverage(old)![1].slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(dupOfferFor([old, better], better)).toBeNull();
  });

  it('a seasonless release never deletes, and is never deleted by, a real S01', () => {
    const s01 = { hash: 'p1', title: 'Show / Show [S01] 1080p', category: 'tv', torrent_size: 5 * GB, data: files(eps('Show.S01E', 10)) } as Torrent;
    const bare = { hash: 'p2', title: 'Show / Show 2160p', category: 'tv', torrent_size: 9 * GB, data: files(eps('Show - ', 10, ' [2160p].mkv')) } as Torrent;
    expect(dupOfferFor([s01, bare], bare)).toBeNull();
    expect(dupOfferFor([s01, bare], s01)).toBeNull();
    const g = groupLibrary([s01, bare])[0] as SeriesGroup;
    expect(worseInSeason(g, 1)).toEqual([]);
  });
});

describe('duplicate detection', () => {
  it('a superset is a duplicate either way; another season is not', () => {
    expect(covers(coverage(S1_1080)!, coverage(S1_HALF_4K)!)).toBe(true);
    expect(covers(coverage(S1_HALF_4K)!, coverage(S1_1080)!)).toBe(false);
    expect(duplicatesOf([S1_1080, S2_4K], S1_HALF_4K)).toEqual([S1_1080]);
    expect(duplicatesOf([S1_1080, S1_HALF_4K], S2_4K)).toEqual([]);
  });

  it('films: the same title and year, both one main video by their files', () => {
    expect(duplicatesOf([FILM_1080, FILM_1984], FILM_4K)).toEqual([FILM_1080]);
    expect(duplicatesOf([FILM_4K], FILM_1984)).toEqual([]);
    // files not known: no film offer (it may be a miniseries filed as a film)
    expect(dupOfferFor([FILM_1080, { ...FILM_4K, data: '' }], { ...FILM_4K, data: '' })).toBeNull();
    const mini = { ...FILM_4K, hash: 'm', title: 'Dune (2021) 2160p', data: files(eps('Dune.E', 6)) };
    expect(dupOfferFor([FILM_1080, mini], mini)).toBeNull();
  });

  it('films: the director or cast segment never makes two films one («Боевой конь» and «Тинтин», Spielberg 2011)', () => {
    expect(filmKeys(WAR_HORSE)).toHaveLength(2);
    expect(filmKeys(WAR_HORSE).every((k) => k.endsWith('|2011') && k.indexOf('spielberg') < 0)).toBe(true);
    expect(duplicatesOf([WAR_HORSE], TINTIN)).toEqual([]);
    expect(dupOfferFor([WAR_HORSE, TINTIN], TINTIN)).toBeNull();
    expect(filmKeys({ hash: 'd', title: 'Dune 1920x1080 (2021)' } as Torrent).every((k) => k.endsWith('|2021'))).toBe(true);
  });

  it('the offer: only when the kept files prove every episode of the dropped one', () => {
    // the real pair: the 1080p one names no season, so nothing is offered either way
    expect(dupOfferFor([SPIRIT_1080, SPIRIT_2160], SPIRIT_2160)).toBeNull();
    expect(dupOfferFor([SPIRIT_1080, SPIRIT_2160], SPIRIT_1080)).toBeNull();
    // with S01 in its file names it may go: the 4K files («1-2 серия» …) hold all 18
    expect(dupOfferFor([SPIRIT_1080_S01, SPIRIT_2160], SPIRIT_2160)).toEqual({ drop: 'old', fresh: SPIRIT_2160, old: SPIRIT_1080_S01 });
    expect(dupOfferFor([SPIRIT_1080_S01, SPIRIT_2160], SPIRIT_1080_S01)).toEqual({ drop: 'new', fresh: SPIRIT_1080_S01, old: SPIRIT_2160 });
    expect(dupOfferFor([S1_1080, S1_HALF_4K], S1_HALF_4K)).toBeNull();
    expect(dupOfferFor([S1_1080, S1_4K_NOFILES], S1_4K_NOFILES)).toBeNull();
    expect(dupOfferFor([FILM_1080, FILM_4K], FILM_4K)).toEqual({ drop: 'old', fresh: FILM_4K, old: FILM_1080 });
  });

  it('says what goes and what stays, with episode counts', () => {
    expect(dropLine(SPIRIT_1080_S01, SPIRIT_2160)).toBe('Удалить 1080p WEB-DL · 18 серий · 5,4 ГБ, оставить 4K WEB-DL · 18 серий');
    expect(dropLine(FILM_1080, FILM_4K)).toBe('Удалить 1080p BDRip · 8,0 ГБ, оставить 4K WEB-DL');
  });
});

describe('after an add', () => {
  it('a better duplicate added from a search: the sheet says what goes; «Удалить старую» replaces the old one', async () => {
    torrents.value = [S1_1080];
    serverList = [S1_1080];
    const add = vi.spyOn(TorrServerClient.prototype, 'add').mockImplementation(async () => ({ ...S1_4K, data: '' }));
    const r = { Title: S1_4K.title, Magnet: 'magnet:?xt=urn:btih:' + S1_4K.hash, Hash: S1_4K.hash, Link: '', Size: '', Categories: '', CreateDate: '', Tracker: '', Peer: 0, Seed: 1, source: 'x' } as SourceResult;
    // the files are not known right after the add: no offer
    await addSearchResult(r, 'tv');
    expect(dupOffer.value).toBeNull();
    torrents.value = [S1_1080];
    add.mockImplementation(async () => ({ ...S1_4K }));
    await addSearchResult(r, 'tv');
    mount(<DuplicateSheet />);
    expect(el.querySelector('.m-dup-text')!.textContent).toBe('Уже есть: Тёмная материя 1080p WEB-DL · 4,0 ГБ. Удалить её и оставить 4K WEB-DL?');
    expect(el.querySelector('[data-dup-line]')!.textContent).toBe('Удалить 1080p WEB-DL · 9 серий · 4,0 ГБ, оставить 4K WEB-DL · 9 серий');
    await act(async () => button('Удалить старую')!.click());
    await flush();
    expect(replaceMock).toHaveBeenCalledTimes(1);
    const args = replaceMock.mock.calls[0];
    expect(args[1]).toBe(S1_1080.hash);
    expect(args[2]).toBe('magnet:?xt=urn:btih:' + S1_4K.hash);
    expect(args[3]).toEqual({ title: S1_4K.title, keepOwn: true });
    expect(dupOffer.value).toBeNull();
  });

  it('a worse duplicate: «Уже есть в лучшем качестве», «Удалить новую» removes the new one; «Оставить обе» keeps both', async () => {
    torrents.value = [S1_1080, S1_4K];
    serverList = [S1_1080, S1_4K];
    checkAddedDuplicate(S1_1080.hash, S1_1080.title);
    mount(<DuplicateSheet />);
    expect(el.querySelector('.m-dup-text')!.textContent).toBe('Уже есть в лучшем качестве (4K WEB-DL). Удалить новую?');
    expect(el.querySelector('[data-dup-line]')!.textContent).toBe('Удалить 1080p WEB-DL · 9 серий · 4,0 ГБ, оставить 4K WEB-DL · 9 серий');
    act(() => button('Оставить обе')!.click());
    expect(dupOffer.value).toBeNull();
    expect(TorrServerClient.prototype.remove).not.toHaveBeenCalled();
    checkAddedDuplicate(S1_1080.hash, S1_1080.title);
    await flush();
    await act(async () => button('Удалить новую')!.click());
    await flush();
    expect(TorrServerClient.prototype.remove).toHaveBeenCalledWith(S1_1080.hash);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('no duplicate: no sheet', () => {
    torrents.value = [S2_4K, FILM_1080];
    checkAddedDuplicate(S2_4K.hash, S2_4K.title);
    expect(dupOffer.value).toBeNull();
  });
});

describe('series screen hint', () => {
  async function open(list: Torrent[], season: number) {
    torrents.value = list;
    serverList = list.slice();
    const k = (groupLibrary(list).find((x) => x.kind === 'series') as SeriesGroup).key;
    navigate({ name: 'series', key: k, season });
    mount(<Series seriesKey={k} />);
    await flush();
  }

  it('a worse duplicate in the season: the hint lists what goes, the confirm too, then it is replaced by the better one', async () => {
    const g = groupLibrary([S1_1080, S1_4K])[0] as SeriesGroup;
    expect(worseInSeason(g, 1).map((x) => [x.worse.hash, x.better.hash])).toEqual([['c1', 'c3']]);
    await open([S1_1080, S1_4K], 1);
    const hint = el.querySelector('[data-dup-hint]')!;
    expect(hint.textContent).toContain('Есть дубль в худшем качестве — оставить лучшую');
    expect(hint.querySelector('[data-dup-line]')!.textContent).toBe('Удалить 1080p WEB-DL · 9 серий · 4,0 ГБ, оставить 4K WEB-DL · 9 серий');
    await act(async () => (hint.querySelector('button') as HTMLButtonElement).click());
    await flush();
    expect(window.confirm).toHaveBeenCalledWith(
      'Удалить 1 раздачу в худшем качестве? История просмотра перейдёт в лучшую.\nУдалить 1080p WEB-DL · 9 серий · 4,0 ГБ, оставить 4K WEB-DL · 9 серий',
    );
    expect(replaceMock.mock.calls.map((c) => [c[1], c[2]])).toEqual([['c1', 'magnet:?xt=urn:btih:c3']]);
  });

  it('«Повелитель духов»: both releases in season 1, no hint (the 1080p one names no season)', async () => {
    await open([SPIRIT_1080, SPIRIT_2160], 1);
    expect(Array.from(el.querySelectorAll('.m-series-row')).map((r) => r.getAttribute('data-hash'))).toEqual(expect.arrayContaining([SPIRIT_1080.hash, SPIRIT_2160.hash]));
    expect(el.querySelector('[data-dup-hint]')).toBeNull();
  });

  it('no hint without a fully covered worse release; declining the confirm deletes nothing', async () => {
    await open([S1_1080, S1_HALF_4K], 1);
    expect(el.querySelector('[data-dup-hint]')).toBeNull();
    act(() => render(null, el));
    window.confirm = vi.fn(() => false);
    await open([S1_1080, S1_4K], 1);
    await act(async () => (el.querySelector('[data-dup-hint] button') as HTMLButtonElement).click());
    await flush();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

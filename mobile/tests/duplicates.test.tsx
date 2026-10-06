import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('../../src/monitor/replace', async (orig) => ({
  ...(await orig<typeof import('../../src/monitor/replace')>()),
  replaceTorrent: vi.fn(() => Promise.resolve({ ok: true, hash: 'x' })),
}));

import { replaceTorrent } from '../../src/monitor/replace';
import { groupLibrary, isSeries, type SeriesGroup } from '../src/lib/seriesGroups';
import { coverage, covers, duplicatesOf, dupOffer, dupOfferFor, checkAddedDuplicate, worseInSeason } from '../src/lib/duplicates';
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
const replaceMock = replaceTorrent as unknown as ReturnType<typeof vi.fn>;

function files(names: string[]) {
  return JSON.stringify({ TorrServer: { Files: names.map((p, i) => ({ id: i + 1, path: p, length: 1000 })) } });
}
function eps(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => prefix + (i < 9 ? '0' : '') + (i + 1) + '.mkv');
}

// the real pair from a user's server: the 1080p one was filed under «Фильмы»
const SPIRIT_1080: Torrent = {
  hash: 'a'.repeat(40), title: 'Повелитель духов / E01-E18 Yu Ling Shi - AniLiberty.TOP [WEB-DL 1080p][HEVC][1-18]',
  category: 'movie', stat: 3, torrent_size: 5.4 * GB, timestamp: 1,
};
const SPIRIT_2160: Torrent = {
  hash: 'b'.repeat(40), title: 'Повелитель духов (S1E1-18 of 18) / Yu Ling Shi / B.King / Spirit Master (2026) WEBRip 2160p | AVC',
  category: 'tv', stat: 3, torrent_size: 10.5 * GB, timestamp: 2,
};
const S1_1080: Torrent = { hash: 'c1', title: 'Тёмная материя / Dark Matter [S01] 1080p WEB-DL', category: 'tv', stat: 3, torrent_size: 4 * GB, timestamp: 1, data: files(eps('S01E', 9)) };
const S1_HALF_4K: Torrent = { hash: 'c2', title: 'Тёмная материя / Dark Matter [S01E01-05] 2160p WEB-DL', category: 'tv', stat: 3, torrent_size: 6 * GB, timestamp: 2 };
const S1_4K: Torrent = { hash: 'c3', title: 'Тёмная материя / Dark Matter [S01] 2160p WEB-DL', category: 'tv', stat: 3, torrent_size: 9 * GB, timestamp: 3, data: files(eps('S01E', 9)) };
const S2_4K: Torrent = { hash: 'c4', title: 'Тёмная материя / Dark Matter [S02] 2160p WEB-DL', category: 'tv', stat: 3, torrent_size: 9 * GB, timestamp: 4, data: files(eps('S02E', 9)) };
const FILM_1080: Torrent = { hash: 'f1', title: 'Дюна / Dune (2021) BDRip 1080p', category: 'movie', stat: 3, torrent_size: 8 * GB, timestamp: 1, data: files(['Dune.mkv']) };
const FILM_4K: Torrent = { hash: 'f2', title: 'Dune (2021) 2160p WEB-DL', category: 'movie', stat: 3, torrent_size: 20 * GB, timestamp: 2, data: files(['Dune.2160p.mkv']) };
const FILM_1984: Torrent = { hash: 'f3', title: 'Дюна / Dune (1984) BDRip 1080p', category: 'movie', stat: 3, torrent_size: 8 * GB, timestamp: 1, data: files(['Dune.mkv']) };

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
  it('«Повелитель духов»: the «Фильмы» release with E01-E18 is a series and joins the 2160p one', () => {
    expect(isSeries(SPIRIT_1080)).toBe(true);
    const items = groupLibrary([SPIRIT_1080, SPIRIT_2160]);
    expect(items).toHaveLength(1);
    const g = items[0] as SeriesGroup;
    expect(g.kind).toBe('series');
    expect(g.members).toHaveLength(2);
    expect(g.seasons).toEqual([1]);
  });

  it('a film with one file stays a film; 18 episode files under «Фильмы» make a series', () => {
    expect(isSeries(FILM_1080)).toBe(false);
    const many: Torrent = { hash: 'm', title: 'Повелитель духов AniLiberty 1080p', category: 'movie', data: files(eps('Yu Ling Shi - E', 18)) } as Torrent;
    expect(isSeries(many)).toBe(true);
  });
});

describe('duplicate detection', () => {
  it('the same episodes in one series are duplicates', () => {
    expect(coverage(SPIRIT_1080)).toEqual(coverage(SPIRIT_2160));
    expect(duplicatesOf([SPIRIT_1080, SPIRIT_2160], SPIRIT_2160)).toEqual([SPIRIT_1080]);
  });

  it('a superset is a duplicate either way; another season is not', () => {
    expect(covers(coverage(S1_1080)!, coverage(S1_HALF_4K)!)).toBe(true);
    expect(covers(coverage(S1_HALF_4K)!, coverage(S1_1080)!)).toBe(false);
    expect(duplicatesOf([S1_1080, S2_4K], S1_HALF_4K)).toEqual([S1_1080]);
    expect(duplicatesOf([S1_1080, S1_HALF_4K], S2_4K)).toEqual([]);
  });

  it('films: the same title and year (any name of the title); another year is not', () => {
    expect(duplicatesOf([FILM_1080, FILM_1984], FILM_4K)).toEqual([FILM_1080]);
    expect(duplicatesOf([FILM_4K], FILM_1984)).toEqual([]);
  });

  it('the offer: drop the old worse one, or the new worse one; a worse superset is never dropped', () => {
    expect(dupOfferFor([SPIRIT_1080, SPIRIT_2160], SPIRIT_2160)).toEqual({ drop: 'old', fresh: SPIRIT_2160, old: SPIRIT_1080 });
    expect(dupOfferFor([SPIRIT_1080, SPIRIT_2160], SPIRIT_1080)).toEqual({ drop: 'new', fresh: SPIRIT_1080, old: SPIRIT_2160 });
    // the 4K half season is better but lacks episodes 6-9 of the 1080p one: nothing to drop
    expect(dupOfferFor([S1_1080, S1_HALF_4K], S1_HALF_4K)).toBeNull();
    expect(dupOfferFor([FILM_1080, FILM_4K], FILM_4K)).toEqual({ drop: 'old', fresh: FILM_4K, old: FILM_1080 });
  });
});

describe('after an add', () => {
  it('a better duplicate added from a search: «Удалить старую» replaces the old one, its history moves over', async () => {
    torrents.value = [SPIRIT_1080];
    serverList = [SPIRIT_1080];
    vi.spyOn(TorrServerClient.prototype, 'add').mockImplementation(async () => ({ ...SPIRIT_2160 }));
    const r = { Title: SPIRIT_2160.title, Magnet: 'magnet:?xt=urn:btih:' + SPIRIT_2160.hash, Hash: SPIRIT_2160.hash, Link: '', Size: '', Categories: '', CreateDate: '', Tracker: '', Peer: 0, Seed: 1, source: 'x' } as SourceResult;
    await addSearchResult(r, 'tv');
    mount(<DuplicateSheet />);
    expect(el.querySelector('.m-dup-text')!.textContent).toBe('Уже есть: Повелитель духов 1080p WEB-DL · 5,4 ГБ. Удалить её и оставить 4K WEB-DL?');
    await act(async () => button('Удалить старую')!.click());
    await flush();
    expect(replaceMock).toHaveBeenCalledTimes(1);
    const args = replaceMock.mock.calls[0];
    expect(args[1]).toBe(SPIRIT_1080.hash);
    expect(args[2]).toBe('magnet:?xt=urn:btih:' + SPIRIT_2160.hash);
    expect(args[3]).toEqual({ title: SPIRIT_2160.title, keepOwn: true });
    expect(dupOffer.value).toBeNull();
    expect(el.querySelector('.m-dup-text')).toBeNull();
  });

  it('a worse duplicate: «Уже есть в лучшем качестве», «Удалить новую» removes the new one; «Оставить обе» keeps both', async () => {
    torrents.value = [SPIRIT_1080, SPIRIT_2160];
    serverList = [SPIRIT_1080, SPIRIT_2160];
    checkAddedDuplicate(SPIRIT_1080.hash, SPIRIT_1080.title);
    mount(<DuplicateSheet />);
    expect(el.querySelector('.m-dup-text')!.textContent).toBe('Уже есть в лучшем качестве (4K WEB-DL). Удалить новую?');
    act(() => button('Оставить обе')!.click());
    expect(dupOffer.value).toBeNull();
    expect(TorrServerClient.prototype.remove).not.toHaveBeenCalled();
    checkAddedDuplicate(SPIRIT_1080.hash, SPIRIT_1080.title);
    await flush();
    await act(async () => button('Удалить новую')!.click());
    await flush();
    expect(TorrServerClient.prototype.remove).toHaveBeenCalledWith(SPIRIT_1080.hash);
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

  it('a worse duplicate in the season: the hint, confirmed, replaces it by the better one', async () => {
    const g = groupLibrary([S1_1080, S1_4K])[0] as SeriesGroup;
    expect(worseInSeason(g, 1).map((x) => [x.worse.hash, x.better.hash])).toEqual([['c1', 'c3']]);
    await open([S1_1080, S1_4K], 1);
    const hint = el.querySelector('[data-dup-hint]')!;
    expect(hint.textContent).toContain('Есть дубль в худшем качестве — оставить лучшую');
    await act(async () => (hint.querySelector('button') as HTMLButtonElement).click());
    await flush();
    expect(window.confirm).toHaveBeenCalledWith('Удалить 1 раздачу в худшем качестве? История просмотра перейдёт в лучшую.');
    expect(replaceMock.mock.calls.map((c) => [c[1], c[2]])).toEqual([['c1', 'magnet:?xt=urn:btih:c3']]);
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

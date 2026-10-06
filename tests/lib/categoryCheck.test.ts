import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { categoryFix, decideCategory, fixCategories, resetCategoryCheck } from '../../src/lib/categoryCheck';
import { categoryPicked, withCategoryPicked, serializeData } from '../../src/lib/journal';
import { saveCategoryPicked } from '../../src/store/journal';
import { checkCategories, refreshTorrents, resetLibrary, torrents } from '../../src/store/library';
import { TorrServerClient } from '../../src/api/torrserver';
import { logEntries, clearLog } from '../../src/lib/log';
import { mockFetch } from '../helpers/fetchMock';
import type { Torrent } from '../../src/api/types';
import type { TorrentFile } from '../../src/lib/episodes';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

function files(list: [string, number][]): TorrentFile[] {
  return list.map(([path, length], i) => ({ id: i + 1, path, length }));
}
function dataOf(f: TorrentFile[], omp?: unknown): string {
  return JSON.stringify(omp ? { TorrServer: { Files: f }, omp } : { TorrServer: { Files: f } });
}

const SPIRIT_FILES = files(Array.from({ length: 18 }, (_, i) => ['Yu Ling Shi/Yu Ling Shi - ' + (i < 9 ? '0' : '') + (i + 1) + ' [AniLiberty] [1080p].mkv', 300 * MB] as [string, number]));
// the user's real release: no season, the episodes only as «- 01 [...]» in brackets-free names, filed under «Фильмы»
const SPIRIT: Torrent = {
  hash: 'a'.repeat(40), title: 'Повелитель духов / E01-E18 Yu Ling Shi - AniLiberty.TOP [WEB-DL 1080p][HEVC][1-18]',
  poster: 'http://p/spirit.jpg', category: 'movie', stat: 3, torrent_size: 5.4 * GB, data: dataOf(SPIRIT_FILES),
};
const FILM_FILES = files([['Dune.2021.2160p/Dune.2021.2160p.mkv', 20 * GB], ['Dune.2021.2160p/Extras/Making of.mkv', 900 * MB], ['Dune.2021.2160p/Extras/Trailer.mkv', 120 * MB], ['Dune.2021.2160p/Dune.srt', 1 * MB]]);
const FILM: Torrent = { hash: 'f'.repeat(40), title: 'Dune (2021) 2160p', poster: '', category: 'movie', stat: 3, data: dataOf(FILM_FILES) };
const ALBUM_FILES = files(Array.from({ length: 12 }, (_, i) => ['Album/' + (i + 1) + ' - Song.flac', 30 * MB] as [string, number]).concat([['Album/cover.jpg', 2 * MB]]));
const ALBUM: Torrent = { hash: 'b'.repeat(40), title: 'Artist - Album (2020)', poster: '', category: 'movie', stat: 3, data: dataOf(ALBUM_FILES) };

beforeEach(() => {
  resetCategoryCheck();
  localStorage.clear();
  clearLog();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the classifier', () => {
  it('«Повелитель духов» 1080p filed as a film, 18 episode files → series', () => {
    expect(decideCategory('Yu Ling Shi 1080p', SPIRIT_FILES)).toBe('tv');
    expect(categoryFix(SPIRIT)).toBe('tv');
    // the title alone says so too (before the files are known)
    expect(categoryFix({ ...SPIRIT, data: '' })).toBe('tv');
  });

  it('a film with extras stays a film; an empty category is filled', () => {
    expect(decideCategory(FILM.title, FILM_FILES)).toBe('movie');
    expect(categoryFix(FILM)).toBeNull();
    expect(categoryFix({ ...FILM, category: '' })).toBe('movie');
  });

  it('an album → music, from a film or a series', () => {
    expect(decideCategory(ALBUM.title, ALBUM_FILES)).toBe('music');
    expect(categoryFix(ALBUM)).toBe('music');
    expect(categoryFix({ ...ALBUM, category: 'tv' })).toBe('music');
  });

  it('only clear contradictions: a series is not made a film, «Прочее» and «Музыка» stay, unsure stays', () => {
    expect(categoryFix({ ...FILM, category: 'tv' })).toBeNull();
    expect(categoryFix({ ...SPIRIT, category: 'other' })).toBeNull();
    expect(categoryFix({ ...SPIRIT, category: 'music' })).toBeNull();
    expect(categoryFix({ hash: 'x', title: 'Something', category: 'movie', data: '' } as Torrent)).toBeNull();
    // a duology «1-2» is no series
    expect(categoryFix({ hash: 'y', title: 'Терминатор [1-2] BDRip', category: 'movie', data: '' } as Torrent)).toBeNull();
  });

  it('a category picked by hand (omp.cm) is never changed', () => {
    const picked = { ...SPIRIT, data: serializeData(withCategoryPicked(JSON.parse(SPIRIT.data!), true), []) };
    expect(categoryPicked(picked.data)).toBe(true);
    expect(categoryPicked(SPIRIT.data)).toBe(false);
    expect(categoryFix(picked)).toBeNull();
  });
});

describe('fixing', () => {
  it('writes once per torrent per session and logs the fix', async () => {
    const setCategory = vi.fn(() => Promise.resolve());
    const done = await fixCategories({ setCategory }, [SPIRIT, FILM, ALBUM]);
    expect(done).toEqual([{ hash: SPIRIT.hash, category: 'tv' }, { hash: ALBUM.hash, category: 'music' }]);
    expect(setCategory).toHaveBeenCalledTimes(2);
    expect(setCategory).toHaveBeenCalledWith(SPIRIT, 'tv');
    await fixCategories({ setCategory }, [SPIRIT, FILM, ALBUM]);
    expect(setCategory).toHaveBeenCalledTimes(2);
    expect(logEntries().map((e) => e.x)).toContain('Категория исправлена: Повелитель духов → Сериалы');
  });

  it('a torrent without files is looked at again once its files come; a refused write is tried again', async () => {
    const setCategory = vi.fn(() => Promise.resolve());
    const bare: Torrent = { hash: 'c'.repeat(40), title: 'Yu Ling Shi 1080p', category: 'movie', data: '' } as Torrent;
    await fixCategories({ setCategory }, [bare]);
    expect(setCategory).not.toHaveBeenCalled();
    await fixCategories({ setCategory }, [{ ...bare, data: dataOf(SPIRIT_FILES) }]);
    expect(setCategory).toHaveBeenCalledTimes(1);
    const failing = vi.fn(() => Promise.reject(new Error('x')));
    await fixCategories({ setCategory: failing }, [ALBUM]);
    await fixCategories({ setCategory: failing }, [ALBUM]);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('the library refresh fixes and patches the shown list', async () => {
    resetLibrary();
    const setCategory = vi.fn(() => Promise.resolve());
    await refreshTorrents({ list: () => Promise.resolve([SPIRIT, FILM]), setCategory });
    await Promise.resolve();
    await Promise.resolve();
    await checkCategories({ setCategory }, []);
    expect(setCategory).toHaveBeenCalledTimes(1);
    expect(torrents.value.filter((x) => x.hash === SPIRIT.hash)[0].category).toBe('tv');
  });
});

describe('the server writes', () => {
  const c = new TorrServerClient({ url: '192.168.1.191:5665' });

  it('setCategory sends `set` with the title and poster as they are and keeps the data', async () => {
    const fn = mockFetch(() => ({ body: '' }));
    await c.setCategory({ hash: SPIRIT.hash, title: SPIRIT.title, poster: SPIRIT.poster }, 'tv');
    expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ action: 'set', hash: SPIRIT.hash, title: SPIRIT.title, poster: 'http://p/spirit.jpg', category: 'tv', data: '' });
    await c.setCategory({ hash: SPIRIT.hash, title: '', poster: '' }, 'tv');
    expect(fn.mock.calls).toHaveLength(1);
  });

  it('a manual pick is stored as omp.cm, the history and other keys kept', async () => {
    const withHistory: Torrent = { ...SPIRIT, data: dataOf(SPIRIT_FILES, { v: 1, h: [{ f: 1, t: 50, d: 1400, at: 1, src: 'tv' }] }) };
    const setData = vi.fn(() => Promise.resolve());
    await saveCategoryPicked({ list: () => Promise.resolve([withHistory]), setData }, withHistory);
    const written = JSON.parse((setData.mock.calls[0] as unknown as [unknown, string])[1]);
    expect(written.omp.cm).toBe(true);
    expect(written.omp.h).toHaveLength(1);
    expect(written.TorrServer.Files).toHaveLength(18);
  });
});

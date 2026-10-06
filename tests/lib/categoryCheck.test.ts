import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  categoryFix, decideCategory, fileEpisodes, fixCategories, recordAutoCategory, resetCategoryCheck, titleHasEpisodes, FRESH_ADD_MS,
} from '../../src/lib/categoryCheck';
import { categoryAuto, categoryPicked, withCategoryAuto, withCategoryPicked, serializeData } from '../../src/lib/journal';
import { recordWatch, saveCategoryAuto, saveCategoryPicked } from '../../src/store/journal';
import { refreshTorrents, resetLibrary, torrents } from '../../src/store/library';
import { logEntries, clearLog } from '../../src/lib/log';
import type { Torrent } from '../../src/api/types';
import type { TorrentFile } from '../../src/lib/episodes';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const NOW = 1_800_000_000_000;

function files(list: [string, number][]): TorrentFile[] {
  return list.map(([path, length], i) => ({ id: i + 1, path, length }));
}
function dataOf(f: TorrentFile[], omp?: unknown): string {
  return JSON.stringify(omp ? { TorrServer: { Files: f }, omp } : { TorrServer: { Files: f } });
}
const two = (i: number) => (i < 9 ? '0' : '') + (i + 1);

const SPIRIT_FILES = files(Array.from({ length: 18 }, (_, i) => ['Yu Ling Shi/Yu Ling Shi - ' + two(i) + ' [AniLiberty] [1080p].mkv', 300 * MB] as [string, number]));
// the user's real release, filed under «Фильмы» by OMP's own guess at the add (omp.ca)
const SPIRIT: Torrent = {
  hash: 'a'.repeat(40), title: 'Повелитель духов / E01-E18 Yu Ling Shi - AniLiberty.TOP [WEB-DL 1080p][HEVC][1-18]',
  poster: 'http://p/spirit.jpg', category: 'movie', stat: 3, torrent_size: 5.4 * GB, timestamp: 1_700_000_000,
  data: dataOf(SPIRIT_FILES, { v: 1, h: [], ca: 'movie' }),
};
const FILM_FILES = files([
  ['Dune.2021.2160p/Dune.2021.2160p.mkv', 20 * GB],
  ['Dune.2021.2160p/Extras/Deleted Scene - 01.mkv', 300 * MB],
  ['Dune.2021.2160p/Extras/Deleted Scene - 02.mkv', 280 * MB],
  ['Dune.2021.2160p/Extras/Deleted Scene - 03.mkv', 260 * MB],
  ['Dune.2021.2160p/Dune.srt', 1 * MB],
]);
const FILM: Torrent = { hash: 'f'.repeat(40), title: 'Dune (2021) 2160p', poster: '', category: '', stat: 3, data: dataOf(FILM_FILES) };
const ALBUM_FILES = files(Array.from({ length: 12 }, (_, i) => ['Album/' + (i + 1) + ' - Song.flac', 30 * MB] as [string, number]).concat([['Album/cover.jpg', 2 * MB]]));
const ALBUM: Torrent = { hash: 'b'.repeat(40), title: 'Artist - Album (2020)', poster: '', category: 'movie', stat: 3, data: dataOf(ALBUM_FILES, { v: 1, h: [], ca: 'movie' }) };

beforeEach(() => {
  resetCategoryCheck();
  localStorage.clear();
  clearLog();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('episode file names', () => {
  it('one episode or a range in one file', () => {
    expect(fileEpisodes('Повелитель духов 1-2 серия [4K] WEB.mkv')).toEqual({ season: null, episodes: [1, 2] });
    expect(fileEpisodes('Повелитель духов 5 серия [4K] WEB.mkv')).toEqual({ season: null, episodes: [5] });
    expect(fileEpisodes('Show.S01E01-E02.1080p.mkv')).toEqual({ season: 1, episodes: [1, 2] });
    expect(fileEpisodes('Show.S01E03-04.mkv')).toEqual({ season: 1, episodes: [3, 4] });
    expect(fileEpisodes('Show E01-E02.mkv')).toEqual({ season: null, episodes: [1, 2] });
    expect(fileEpisodes('Show ep 1-2.mkv')).toEqual({ season: null, episodes: [1, 2] });
    expect(fileEpisodes('Yu_Ling_Shi_[01]_[HEVC].mkv')).toEqual({ season: null, episodes: [1] });
    expect(fileEpisodes('Yu Ling Shi - 07 [1080p].mkv')).toEqual({ season: null, episodes: [7] });
    expect(fileEpisodes('Movie [720].mkv')).toBeNull();
    expect(fileEpisodes('Dune.2021.2160p.mkv')).toBeNull();
  });
});

describe('the classifier', () => {
  it('«Повелитель духов» 1080p: 18 episode files → series, so OMP corrects its own «Фильмы»', () => {
    expect(decideCategory('Yu Ling Shi 1080p', SPIRIT_FILES)).toBe('tv');
    expect(categoryFix(SPIRIT)).toBe('tv');
    // without files the title alone does not change a category
    expect(categoryFix({ ...SPIRIT, data: JSON.stringify({ omp: { v: 1, h: [], ca: 'movie' } }) })).toBeNull();
  });

  it('a film with numbered extras stays a film; an empty category is filled', () => {
    expect(decideCategory(FILM.title, FILM_FILES)).toBe('movie');
    expect(categoryFix(FILM)).toBe('movie');
    expect(categoryFix({ ...FILM, category: 'movie', data: dataOf(FILM_FILES, { v: 1, h: [], ca: 'movie' }) })).toBeNull();
  });

  it('a concert with numbered parts beside one main video stays a film', () => {
    const concert = files([['Live/Concert Full.mkv', 12 * GB], ['Live/Artist - 01 - Intro.mkv', 200 * MB], ['Live/Artist - 02 - Song.mkv', 220 * MB], ['Live/Artist - 03 - Song.mkv', 210 * MB]]);
    expect(decideCategory('Artist - Live (2019)', concert)).toBe('movie');
  });

  it('«Сезон охоты 2» (a film named «Сезон») stays a film', () => {
    const t = 'Сезон охоты 2 / Open Season 2 (2008) BDRip';
    expect(titleHasEpisodes(t)).toBe(false);
    const one = files([['Open.Season.2.2008.mkv', 8 * GB]]);
    expect(decideCategory(t, one)).toBe('movie');
    expect(categoryFix({ hash: 'o', title: t, category: 'movie', data: dataOf(one, { v: 1, h: [], ca: 'movie' }) } as Torrent)).toBeNull();
    // an empty one: filled as a film, never a series
    expect(categoryFix({ hash: 'o', title: t, category: '', data: '' } as Torrent)).toBeNull();
    expect(categoryFix({ hash: 'o', title: t, category: '', data: dataOf(one) } as Torrent)).toBe('movie');
  });

  it('an album → music, from OMP\'s own film or series', () => {
    expect(decideCategory(ALBUM.title, ALBUM_FILES)).toBe('music');
    expect(categoryFix(ALBUM)).toBe('music');
    expect(categoryFix({ ...ALBUM, category: 'tv', data: dataOf(ALBUM_FILES, { v: 1, h: [], ca: 'tv' }) })).toBe('music');
  });

  it('never fights the user: a category nobody recorded as OMP\'s, or one changed since, or a hand pick is kept', () => {
    // set by the TV, the web UI, Lampa or an older OMP: no omp.ca
    expect(categoryFix({ ...SPIRIT, data: dataOf(SPIRIT_FILES) })).toBeNull();
    // OMP set «Сериалы», the user moved it to «Фильмы»
    expect(categoryFix({ ...SPIRIT, data: dataOf(SPIRIT_FILES, { v: 1, h: [], ca: 'tv' }) })).toBeNull();
    const picked = { ...SPIRIT, data: serializeData(withCategoryPicked(JSON.parse(SPIRIT.data!), true), []) };
    expect(categoryPicked(picked.data)).toBe(true);
    expect(categoryFix(picked)).toBeNull();
    // the local record of an add counts as OMP's own
    recordAutoCategory(SPIRIT.hash, 'movie');
    expect(categoryFix({ ...SPIRIT, data: dataOf(SPIRIT_FILES) })).toBe('tv');
  });

  it('only clear contradictions: a series is not made a film, «Прочее» stays', () => {
    expect(categoryFix({ ...FILM, category: 'tv', data: dataOf(FILM_FILES, { v: 1, h: [], ca: 'tv' }) })).toBeNull();
    expect(categoryFix({ ...SPIRIT, category: 'other', data: dataOf(SPIRIT_FILES, { v: 1, h: [], ca: 'other' }) })).toBeNull();
  });
});

describe('fixing', () => {
  it('writes once per torrent per session and logs the fix', async () => {
    const setCategory = vi.fn(() => Promise.resolve());
    const done = await fixCategories({ setCategory }, [SPIRIT, FILM, ALBUM], NOW);
    expect(done).toEqual([{ hash: SPIRIT.hash, category: 'tv' }, { hash: FILM.hash, category: 'movie' }, { hash: ALBUM.hash, category: 'music' }]);
    expect(setCategory).toHaveBeenCalledWith(SPIRIT, 'tv');
    await fixCategories({ setCategory }, [SPIRIT, FILM, ALBUM], NOW);
    expect(setCategory).toHaveBeenCalledTimes(3);
    expect(logEntries().map((e) => e.x)).toContain('Категория исправлена: Повелитель духов → Сериалы');
  });

  it('a torrent without files waits for them; one added in the last minute waits; a refused write is not retried this session', async () => {
    const setCategory = vi.fn(() => Promise.resolve());
    const bare: Torrent = { hash: 'c'.repeat(40), title: 'Yu Ling Shi 1080p', category: '', data: '' } as Torrent;
    await fixCategories({ setCategory }, [bare], NOW);
    expect(setCategory).not.toHaveBeenCalled();
    const fresh = { ...bare, data: dataOf(SPIRIT_FILES), timestamp: Math.floor((NOW - FRESH_ADD_MS / 2) / 1000) };
    await fixCategories({ setCategory }, [fresh], NOW);
    expect(setCategory).not.toHaveBeenCalled();
    await fixCategories({ setCategory }, [fresh], NOW + FRESH_ADD_MS);
    expect(setCategory).toHaveBeenCalledTimes(1);
    const failing = vi.fn(() => Promise.reject(new Error('x')));
    await fixCategories({ setCategory: failing }, [ALBUM], NOW);
    await fixCategories({ setCategory: failing }, [ALBUM], NOW);
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('a fix is recorded as OMP\'s own even when the data cannot carry omp.ca, so the user\'s next change is kept', async () => {
    const setCategory = vi.fn(() => Promise.resolve());
    const bare: Torrent = { ...FILM, hash: 'd'.repeat(40), category: '' };
    await fixCategories({ setCategory }, [bare], NOW);
    expect(setCategory).toHaveBeenCalledWith(bare, 'movie');
    resetCategoryCheck();
    // the user moved it to «Сериалы»: OMP's record says «Фильмы», so it is left alone
    expect(categoryFix({ ...bare, category: 'tv' })).toBeNull();
    // a refused write records nothing
    const failing = vi.fn(() => Promise.reject(new Error('x')));
    const other: Torrent = { ...FILM, hash: 'e'.repeat(40), category: '' };
    await fixCategories({ setCategory: failing }, [other], NOW);
    expect(categoryFix({ ...other, category: 'movie' })).toBeNull();
  });

  it('the library refresh fixes through the journal queue and patches the shown list', async () => {
    resetLibrary();
    const server: { [h: string]: Torrent } = { [SPIRIT.hash]: { ...SPIRIT }, [FILM.hash]: { ...FILM } };
    const setData = vi.fn((tor: Torrent, data: string) => {
      server[tor.hash] = { ...server[tor.hash], ...tor, data: data || server[tor.hash].data };
      return Promise.resolve();
    });
    const list = () => Promise.resolve(Object.keys(server).map((h) => ({ ...server[h] })));
    await refreshTorrents({ list, setData });
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(setData).toHaveBeenCalledTimes(2);
    expect(server[SPIRIT.hash].category).toBe('tv');
    expect(categoryAuto(server[SPIRIT.hash].data)).toBe('tv');
    expect(torrents.value.filter((x) => x.hash === SPIRIT.hash)[0].category).toBe('tv');
  });
});

describe('the server writes', () => {
  it('reads the torrent from the list right before the write: its current title, poster and data go back, with omp.ca', async () => {
    const current = { ...SPIRIT, title: 'Renamed meanwhile', poster: 'http://p/new.jpg', data: dataOf(SPIRIT_FILES, { v: 1, h: [{ f: 1, t: 50, d: 1400, at: 1, src: 'tv' }] }) };
    const setData = vi.fn(() => Promise.resolve());
    await saveCategoryAuto({ list: () => Promise.resolve([current]), setData }, SPIRIT.hash, 'tv');
    const [tor, data] = setData.mock.calls[0] as unknown as [Torrent, string];
    expect(tor.title).toBe('Renamed meanwhile');
    expect(tor.poster).toBe('http://p/new.jpg');
    expect(tor.category).toBe('tv');
    expect(categoryAuto(data)).toBe('tv');
    const back = JSON.parse(data);
    expect(back.omp.h).toHaveLength(1);
    expect(back.TorrServer.Files).toHaveLength(18);
  });

  it('empty data is sent empty (the stored one stays); a gone torrent rejects', async () => {
    const setData = vi.fn(() => Promise.resolve());
    await saveCategoryAuto({ list: () => Promise.resolve([{ ...SPIRIT, data: '' }]), setData }, SPIRIT.hash, 'tv');
    expect((setData.mock.calls[0] as unknown as [Torrent, string])[1]).toBe('');
    await expect(saveCategoryAuto({ list: () => Promise.resolve([]), setData }, SPIRIT.hash, 'tv')).rejects.toBeTruthy();
  });

  it('runs after a pending journal write of the same torrent: the history entry is not lost', async () => {
    let stored: Torrent = { ...SPIRIT, data: dataOf(SPIRIT_FILES, { v: 1, h: [] }) };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    let first = true;
    const c = {
      list: () => Promise.resolve([{ ...stored }]),
      setData: vi.fn((tor: Torrent, data: string) => {
        const write = () => {
          stored = { ...stored, ...tor, data: data || stored.data };
        };
        if (first) {
          first = false;
          return gate.then(write);
        }
        write();
        return Promise.resolve();
      }),
    };
    const watch = recordWatch(c, SPIRIT.hash, { f: 2, t: 300, d: 1400, src: 'phone' }, 5);
    const cat = saveCategoryAuto(c, SPIRIT.hash, 'tv');
    for (let i = 0; i < 10; i++) await Promise.resolve();
    release();
    await watch;
    await cat;
    expect(stored.category).toBe('tv');
    expect(JSON.parse(stored.data!).omp.h).toHaveLength(1);
    expect(categoryAuto(stored.data)).toBe('tv');
  });

  it('a manual pick is stored as omp.cm, the history and other keys kept', async () => {
    const withHistory: Torrent = { ...SPIRIT, data: dataOf(SPIRIT_FILES, { v: 1, h: [{ f: 1, t: 50, d: 1400, at: 1, src: 'tv' }] }) };
    const setData = vi.fn(() => Promise.resolve());
    await saveCategoryPicked({ list: () => Promise.resolve([withHistory]), setData }, withHistory);
    const written = JSON.parse((setData.mock.calls[0] as unknown as [unknown, string])[1]);
    expect(written.omp.cm).toBe(true);
    expect(written.omp.h).toHaveLength(1);
    expect(written.TorrServer.Files).toHaveLength(18);
    expect(withCategoryAuto({}, 'tv')).toEqual({ omp: { v: 1, h: [], ca: 'tv' } });
  });
});

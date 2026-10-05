import { describe, it, expect, beforeEach } from 'vitest';
import { betterSeriesReleases, carryProgress, findUpgrades, pickUpgrades, upgradeKind, upgradeQuery } from '../../src/monitor/upgrade';
import type { LibraryTorrent } from '../../src/monitor/newEpisodes';
import type { SearchFn } from '../../src/monitor/check';
import type { SourceContext, SourceResult } from '../../src/sources/types';
import { getLocalProgress, reloadProgress, saveProgress } from '../../src/store/progress';

const ctx: SourceContext = {
  http: { get: () => Promise.reject(new Error('no')), post: () => Promise.reject(new Error('no')), clearCookies: () => Promise.resolve() },
  client: null,
};

function res(Title: string, extra?: Partial<SourceResult>): SourceResult {
  return { Title, Categories: '', Size: '', CreateDate: '', Tracker: 'rutor', Link: '', Magnet: '', Hash: '', Peer: 0, Seed: 10, source: 'rutor', ...extra };
}

function fakeSearch(list: SourceResult[], queries: string[], answered = true): SearchFn & { cancelled: () => boolean } {
  let cancelled = false;
  const fn = ((query: string) => {
    queries.push(query);
    return {
      sourceIds: ['rutor'],
      results: () => list.slice(),
      pending: () => [],
      answered: () => (answered ? ['rutor'] : []),
      failed: () => (answered ? [] : ['rutor']),
      done: Promise.resolve(),
      cancel: () => {
        cancelled = true;
      },
    };
  }) as unknown as SearchFn & { cancelled: () => boolean };
  fn.cancelled = () => cancelled;
  return fn;
}

const H = 'f'.repeat(40);
const FILM = 'Северный ветер (2026) WEB-DL 1080p';
const SERIES = 'Дом дракона / House of the Dragon [S02E01-08 из 08] (2024) WEB-DL 1080p';

const film = (title = FILM): LibraryTorrent => ({ hash: H, title, category: 'movie' });
const series = (title = SERIES): LibraryTorrent => ({ hash: H, title, category: 'tv' });

beforeEach(() => {
  localStorage.clear();
  reloadProgress();
});

describe('what is offered', () => {
  it('films and series with a known season; other categories are not', () => {
    expect(upgradeKind(film())).toBe('film');
    expect(upgradeKind(series())).toBe('series');
    expect(upgradeKind({ hash: H, title: 'Some Album (2020) FLAC', category: 'music' })).toBe(null);
    // a series without a season or episodes cannot be compared
    expect(upgradeKind({ hash: H, title: 'Дом дракона (2024) WEB-DL 1080p', category: 'tv' })).toBe(null);
  });

  it('queries: the film name and year, the series name', () => {
    expect(upgradeQuery(film())).toBe('Северный ветер 2026');
    expect(upgradeQuery(series())).toBe('Дом дракона');
  });
});

describe('films', () => {
  it('only better releases of the same film, best rank first, then seeds', () => {
    const list = [
      res('Северный ветер (2026) WEB-DL 1080p', { Seed: 900 }), // the same quality
      res('Северный ветер (2026) BDRip 1080p', { Seed: 50 }),
      res('Северный ветер (2026) 2160p WEB-DL', { Seed: 20 }),
      res('Северный ветер (2026) 2160p Remux', { Seed: 5 }),
      res('Северный ветер (2026) 2160p WEB-DL', { Seed: 300, hash: 'a'.repeat(40) }),
      res('Северный ветер (1987) 2160p Remux'), // another film
      res('Южный ветер (2026) 2160p Remux'), // another name
      res('Северный ветер (2026) 2160p Remux', { hash: H }), // the torrent itself
    ];
    expect(pickUpgrades(film(), list).map((r) => r.Title + '|' + r.Seed)).toEqual([
      'Северный ветер (2026) 2160p Remux|5',
      'Северный ветер (2026) 2160p WEB-DL|300',
      'Северный ветер (2026) 2160p WEB-DL|20',
      'Северный ветер (2026) BDRip 1080p|50',
    ]);
  });

  it('a year is required when the library title has one', () => {
    expect(pickUpgrades(film(), [res('Северный ветер 2160p Remux')])).toEqual([]);
  });
});

describe('series', () => {
  it('the same season covering our episodes, in a better quality', () => {
    const list = [
      res('Дом дракона / House of the Dragon [S02E01-08 из 08] (2024) WEB-DL 2160p', { Seed: 30 }),
      res('Дом дракона [S02E01-08 из 08] (2024) Remux 2160p', { Seed: 3 }),
      res('Дом дракона [S02E01-06 из 08] (2024) WEB-DL 2160p'), // fewer episodes
      res('Дом дракона [S02E03-08 из 08] (2024) WEB-DL 2160p'), // misses the first two
      res('Дом дракона [S01E01-10 из 10] (2022) WEB-DL 2160p'), // another season
      res('Дом дракона [S02E01-08 из 08] (2024) WEB-DL 720p'), // worse
      res('Дом дракона / House of the Dragon (2024) Сезоны 1-2 WEB-DL 2160p', { Seed: 7 }), // a pack covering season 2
      res('Дом дракона (2024) Сезоны 3-4 WEB-DL 2160p'), // a pack without season 2
      res('Игра престолов [S02E01-10 из 10] WEB-DL 2160p'), // another series
    ];
    expect(betterSeriesReleases(series(), list).map((r) => r.Title)).toEqual([
      'Дом дракона [S02E01-08 из 08] (2024) Remux 2160p',
      'Дом дракона / House of the Dragon [S02E01-08 из 08] (2024) WEB-DL 2160p',
      'Дом дракона / House of the Dragon (2024) Сезоны 1-2 WEB-DL 2160p',
    ]);
  });

  it('a release with more episodes than ours counts', () => {
    const t = series('Дом дракона [S02E01-04 из 08] (2024) WEB-DL 1080p');
    expect(pickUpgrades(t, [res('Дом дракона [S02E01-08 из 08] (2024) WEB-DL 2160p')]).length).toBe(1);
  });
});

describe('findUpgrades', () => {
  it('searches the query and returns the candidates; nothing better: empty', async () => {
    const q: string[] = [];
    const s = findUpgrades(ctx, film(), { search: fakeSearch([res('Северный ветер (2026) 2160p Remux')], q) });
    const o = await s.done;
    expect(q).toEqual(['Северный ветер 2026']);
    expect(o.answered).toBe(true);
    expect(o.candidates.length).toBe(1);
    const empty = await findUpgrades(ctx, film(), { search: fakeSearch([res('Северный ветер (2026) WEB-DL 720p')], []) }).done;
    expect(empty).toEqual({ candidates: [], answered: true });
  });

  it('cancel stops the search and gives no candidates', async () => {
    const fs = fakeSearch([res('Северный ветер (2026) 2160p Remux')], []);
    const s = findUpgrades(ctx, film(), { search: fs });
    s.cancel();
    expect(fs.cancelled()).toBe(true);
    expect(await s.done).toEqual({ candidates: [], answered: false });
  });
});

describe('carryProgress', () => {
  it('moves the positions by episode, not by file index; the old torrent keeps none', () => {
    const NEW = 'e'.repeat(40);
    const oldFiles = [
      { id: 1, path: 'HotD.S02E01.1080p.mkv', length: 1 },
      { id: 2, path: 'HotD.S02E02.1080p.mkv', length: 1 },
      { id: 3, path: 'HotD.S02E03.1080p.mkv', length: 1 },
    ];
    // the new release has an extra file first: indices shift
    const newFiles = [
      { id: 1, path: 'Sample/sample.mkv', length: 1 },
      { id: 2, path: 'HotD.S02E01.2160p.mkv', length: 1 },
      { id: 3, path: 'HotD.S02E02.2160p.mkv', length: 1 },
      { id: 4, path: 'HotD.S02E03.2160p.mkv', length: 1 },
    ];
    saveProgress(H, 1, 1, 1);
    saveProgress(H, 2, 600, 3000);
    expect(carryProgress(H, oldFiles, NEW, newFiles)).toBe(2);
    expect(getLocalProgress(NEW, 2)!.time).toBe(1);
    expect(getLocalProgress(NEW, 3)!.time).toBe(600);
    expect(getLocalProgress(NEW, 3)!.updated).toBeGreaterThan(getLocalProgress(NEW, 2)!.updated);
    expect(getLocalProgress(NEW, 1)).toBe(null);
    expect(getLocalProgress(H, 2)).toBe(null);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import {
  seriesQuery,
  seriesNames,
  releaseGroups,
  libraryRange,
  isWatchedSeries,
  pickNewer,
  findNewEpisodes,
  checkNewEpisodes,
  type LibraryTorrent,
} from '../../src/monitor/newEpisodes';
import { findingsOf, seenKeys } from '../../src/monitor/subs';
import { EPISODES_ID } from '../../src/monitor/types';
import type { SearchFn } from '../../src/monitor/check';
import type { SourceContext, SourceResult } from '../../src/sources/types';

const ctx: SourceContext = {
  http: { get: () => Promise.reject(new Error('no')), post: () => Promise.reject(new Error('no')), clearCookies: () => Promise.resolve() },
  client: null,
};

function res(Title: string, extra?: Partial<SourceResult>): SourceResult {
  return { Title, Categories: '', Size: '', CreateDate: '', Tracker: 'torrent.by', Link: '', Magnet: '', Hash: '', Peer: 0, Seed: 10, source: 'torrentby', ...extra };
}

function fakeSearch(list: SourceResult[], queries: string[]): SearchFn {
  return (query) => {
    queries.push(query);
    return {
      sourceIds: ['torrentby'],
      results: () => list.slice(),
      pending: () => [],
      answered: () => ['torrentby'],
      failed: () => [],
      done: Promise.resolve(),
      cancel: () => undefined,
    };
  };
}

const BOG = 'Трудно быть богом / Сезон: 1 / Серии: 1-8 из 10  [2026, фантастика, драма, WEBRip-AVC] от Aleksan55';

function lib(title: string, extra?: Partial<LibraryTorrent>): LibraryTorrent {
  return { hash: 'f'.repeat(40), title, category: 'tv', ...extra };
}

beforeEach(() => {
  localStorage.clear();
});

describe('series names', () => {
  it('seriesQuery strips seasons, episodes, year and quality', () => {
    expect(seriesQuery(BOG)).toBe('Трудно быть богом');
    expect(seriesQuery('Дом дракона / House of the Dragon [03х01-08 из 08] (2026) WEB-DL 1080p | P')).toBe('Дом дракона');
    expect(seriesQuery('Невский/ Сезон: 8 / Серии: 1-10 из 30  [2026, детектив]')).toBe('Невский');
    expect(seriesQuery('The.Last.of.Us.S02E01-07.1080p.WEB-DL')).toBe('The Last of Us');
    expect(seriesQuery('Тёмная материя / Dark Matter (2026) WEB-DL [H.264/1080p] (сезон 2, серии 1-6 из 10)')).toBe('Тёмная материя');
    expect(seriesQuery('')).toBe('');
  });

  it('seriesNames gives every title variant, normalized', () => {
    expect(seriesNames('Дом Дракона / House of the Dragon (2026) WEB-DLRip (сезон 3, серии 1-8 из 8)')).toEqual(['дом дракона', 'house of the dragon']);
    expect(seriesNames('House.of.the.Dragon.S03E01-08.2160p')).toEqual(['house of the dragon']);
    expect(seriesNames('Дом дракона 2 сезон 1-8 серия (2024) 1080p')).toEqual(['дом дракона']);
    expect(seriesNames('Дом дракона 1-8 серии (2024) 1080p')).toEqual(['дом дракона']);
    // the whole name, not the first four words
    expect(seriesNames('Очень длинное название сериала про жизнь / Серии 1-8 из 10')).toEqual(['очень длинное название сериала про жизнь']);
  });

  it('releaseGroups reads «от …», «by …» and the parts after |', () => {
    expect(releaseGroups(BOG)).toEqual(['aleksan55']);
    expect(releaseGroups('Золотая секира / Golden Axe [01x01-04] (2026) WEB-DLRip 1080p | Даблин')).toEqual(['даблин']);
    expect(releaseGroups('Два года спустя [S01] (2026) WEB-DL 720p от New-Team | D | ДАБЛИН')).toEqual(['new team', 'даблин']);
    expect(releaseGroups('Show (2026)')).toEqual([]);
  });
});

describe('libraryRange / isWatchedSeries', () => {
  it('the range from the title, else from the episode files', () => {
    expect(libraryRange(lib(BOG))).toEqual({ season: 1, from: 1, to: 8 });
    const files = [1, 2, 3, 4, 5].map((e) => ({ id: e, path: 'Show/Show.S02E0' + e + '.mkv', length: 1 }));
    expect(libraryRange(lib('Сериал (2026) WEB-DL 1080p', { file_stats: files }))).toEqual({ season: 2, from: 1, to: 5 });
    expect(libraryRange(lib('Фильм (2026) 1080p'))).toBeNull();
  });

  it('series by category or title, not switched off in the journal', () => {
    expect(isWatchedSeries(lib(BOG))).toBe(true);
    expect(isWatchedSeries(lib(BOG, { category: '' }))).toBe(true);
    expect(isWatchedSeries(lib(BOG, { category: 'music' }))).toBe(false);
    expect(isWatchedSeries(lib(BOG, { category: 'movie' }))).toBe(false);
    expect(isWatchedSeries(lib(BOG, { category: 'other' }))).toBe(false);
    expect(isWatchedSeries(lib(BOG, { category: undefined }))).toBe(true);
    // a pack of seasons is not followed
    expect(isWatchedSeries(lib('Сериал (2024) (Сезоны 1-3, серии 1-30 из 30) 1080p'))).toBe(false);
    // the old place inside s means nothing
    expect(isWatchedSeries(lib(BOG, { data: JSON.stringify({ omp: { v: 1, h: [], s: { i: false, c: false, w: false } } }) }))).toBe(true);
    expect(isWatchedSeries(lib('Фильм (2026) 1080p'))).toBe(false);
    const off = JSON.stringify({ omp: { v: 1, h: [], w: false } });
    expect(isWatchedSeries(lib(BOG, { data: off }))).toBe(false);
    const on = JSON.stringify({ omp: { v: 1, h: [], s: { i: true, c: false } } });
    expect(isWatchedSeries(lib(BOG, { data: on }))).toBe(true);
  });
});

describe('pickNewer', () => {
  it('a later release of the same season; same quality and release group first', () => {
    const same = res('Трудно быть богом / Сезон: 1 / Серии: 1-10 из 10  [2026, фантастика, драма, WEBRip-AVC] от Aleksan55', { hash: 'a'.repeat(40) });
    const hd = res('Трудно быть богом (2026) WEB-DL 1080p (сезон 1, серии 1-9 из 10) LostFilm', { source: 'nnmclub', Seed: 99 });
    const results = [
      hd,
      res('Трудно быть собой / Серии: 1-12 из 12 [2026] от Aleksan55'),
      res('Трудно быть богом / Сезон: 2 / Серии: 1-3 из 10 [2027] от Aleksan55'),
      res('Трудно быть богом / Сезон: 1 / Серии: 1-6 из 10 [2026] от Aleksan55'),
      res(BOG, { hash: 'f'.repeat(40) }),
      same,
    ];
    const n = pickNewer(lib(BOG), results)!;
    expect(n.torrentHash).toBe('f'.repeat(40));
    expect(n.season).toBe(1);
    expect(n.haveTo).toBe(8);
    expect(n.from).toBe(1);
    expect(n.to).toBe(10);
    expect(n.candidate).toBe(same);
    expect(n.others).toEqual([hd]);
  });

  it('the same quality wins over more episodes', () => {
    const t = lib('Сериал / Show [01x01-05 из 10] (2026) WEB-DL 1080p | P');
    const sd = res('Сериал / Show [01x01-08 из 10] (2026) WEB-DL 720p | P');
    const hd = res('Сериал / Show [01x01-07 из 10] (2026) WEB-DL 1080p | P');
    expect(pickNewer(t, [sd, hd])!.candidate).toBe(hd);
    // the preferred source breaks a tie
    const a = res('Сериал / Show [01x01-07 из 10] (2026) WEB-DL 1080p', { source: 'rutor' });
    const b = res('Сериал / Show [01x01-07 из 10] (2026) WEB-DL 1080p', { source: 'nnmclub' });
    expect(pickNewer(t, [a, b], { source: 'nnmclub' })!.candidate).toBe(b);
  });

  it('never takes a pack of seasons for a newer release of one season', () => {
    const t = lib('Сериал (2024) (Сезон 1, серии 1-8 из 10) 1080p');
    const real = res('Сериал (2024) (Сезон 1, серии 1-10 из 10) 1080p');
    const packs = [
      res('Сериал (2024) (Сезоны 1-3, серии 1-30 из 30) 1080p', { Seed: 500 }),
      res('Сериал (2024) (Сезон 1-3) Серии 1-30 1080p', { Seed: 500 }),
      res('Сериал [S01-03] Серии 1-30 (2024) 1080p', { Seed: 500 }),
    ];
    const n = pickNewer(t, packs.concat([real]))!;
    expect(n.candidate).toBe(real);
    expect(n.to).toBe(10);
    expect(n.others).toEqual([]);
    expect(pickNewer(t, packs)).toBeNull();
  });

  it('another series that shares the first words, or another year, is not the same series', () => {
    const t = lib('Очень длинное название сериала про жизнь / Серии 1-8 из 10 (2024)');
    expect(pickNewer(t, [res('Очень длинное название сериала про смерть / Серии 1-10 из 10 (2024)')])).toBeNull();
    const shogun = lib('Сёгун / Shogun [S01] (2024) WEB-DL 1080p [1-8 из 10]');
    expect(pickNewer(shogun, [res('Сёгун / Shogun (1980) Серии 1-10 из 10 1080p')])).toBeNull();
    const ok = res('Сёгун / Shogun [S01] (2025) WEB-DL 1080p [1-10 из 10]');
    expect(pickNewer(shogun, [ok])!.candidate).toBe(ok);
    // no year on one side: the name decides
    const noYear = res('Сёгун / Shogun S01E01-10 1080p');
    expect(pickNewer(shogun, [noYear])!.candidate).toBe(noYear);
  });

  it('null when nothing is newer or the torrent has no episode numbers', () => {
    expect(pickNewer(lib(BOG), [res(BOG)])).toBeNull();
    expect(pickNewer(lib('Фильм (2026)'), [res('Фильм (2026) [1-10 из 10]')])).toBeNull();
  });
});

describe('findNewEpisodes', () => {
  it('searches by the series name and picks the newer release', async () => {
    const queries: string[] = [];
    const newer = res('Трудно быть богом / Сезон: 1 / Серии: 1-10 из 10 [2026] от Aleksan55');
    const n = await findNewEpisodes(ctx, lib(BOG), { search: fakeSearch([newer], queries) });
    expect(queries).toEqual(['Трудно быть богом']);
    expect(n!.candidate).toBe(newer);
  });

  it('does not search for a torrent that is not watched', async () => {
    const queries: string[] = [];
    const off = JSON.stringify({ omp: { v: 1, h: [], w: false } });
    expect(await findNewEpisodes(ctx, lib(BOG, { data: off }), { search: fakeSearch([], queries) })).toBeNull();
    expect(queries).toEqual([]);
  });
});

describe('checkNewEpisodes', () => {
  it('one finding per new last episode, the card follows newer releases', async () => {
    const queries: string[] = [];
    const ep9 = res('Трудно быть богом / Сезон: 1 / Серии: 1-9 из 10 [2026] от Aleksan55');
    const torrents = [lib(BOG), lib('Фильм (2026) 1080p', { hash: 'b'.repeat(40), category: 'movie' })];
    const first = await checkNewEpisodes(ctx, torrents, { search: fakeSearch([ep9], queries), now: 100 });
    expect(queries).toEqual(['Трудно быть богом']);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      subId: EPISODES_ID,
      key: 'f'.repeat(40) + ':1:9',
      at: 100,
      episodes: { torrentHash: 'f'.repeat(40), torrentTitle: BOG, season: 1, haveTo: 8, from: 1, to: 9 },
    });
    expect(first[0].result).toBe(ep9);
    expect(seenKeys(EPISODES_ID)).toEqual(['f'.repeat(40) + ':1:9']);
    // the same release again: no new finding
    expect(await checkNewEpisodes(ctx, torrents, { search: fakeSearch([ep9], queries), now: 200 })).toEqual([]);
    const ep10 = res('Трудно быть богом / Сезон: 1 / Серии: 1-10 из 10 [2026] от Aleksan55');
    const third = await checkNewEpisodes(ctx, torrents, { search: fakeSearch([ep9, ep10], queries), now: 300 });
    expect(third.map((f) => f.key)).toEqual(['f'.repeat(40) + ':1:10']);
    expect(findingsOf(EPISODES_ID).map((f) => f.key)).toEqual(['f'.repeat(40) + ':1:10']);
  });
});

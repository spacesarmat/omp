import { describe, it, expect, beforeEach } from 'vitest';
import {
  BETTER_CHECKED_KEY,
  BETTER_EVERY_MS,
  betterDue,
  betterKey,
  checkBetterQuality,
  dueFilms,
  filmQuery,
  findBetter,
  isLibraryFilm,
  isWatchedFilm,
  pickBetter,
  pruneBetterChecked,
} from '../../src/monitor/better';
import type { LibraryTorrent } from '../../src/monitor/newEpisodes';
import { findingsOf, seenKeys } from '../../src/monitor/subs';
import { BETTER_ID } from '../../src/monitor/types';
import type { SearchFn } from '../../src/monitor/check';
import type { SourceContext, SourceResult } from '../../src/sources/types';

const ctx: SourceContext = {
  http: { get: () => Promise.reject(new Error('no')), post: () => Promise.reject(new Error('no')), clearCookies: () => Promise.resolve() },
  client: null,
};

function res(Title: string, extra?: Partial<SourceResult>): SourceResult {
  return { Title, Categories: '', Size: '', CreateDate: '', Tracker: 'rutor', Link: '', Magnet: '', Hash: '', Peer: 0, Seed: 10, source: 'rutor', ...extra };
}

/** searchAll double: the same list for any query; `answered` false = no source answered. */
function fakeSearch(list: SourceResult[], queries: string[], answered = true): SearchFn {
  return (query) => {
    queries.push(query);
    return {
      sourceIds: ['rutor'],
      results: () => list.slice(),
      pending: () => [],
      answered: () => (answered ? ['rutor'] : []),
      failed: () => (answered ? [] : ['rutor']),
      done: Promise.resolve(),
      cancel: () => undefined,
    };
  };
}

const H = 'f'.repeat(40);
const FILM = 'Северный ветер (2026) WEB-DL 1080p';

function film(title = FILM, extra?: Partial<LibraryTorrent>): LibraryTorrent {
  return { hash: H, title, category: 'movie', ...extra };
}

beforeEach(() => {
  localStorage.clear();
});

describe('films of the library', () => {
  it('isLibraryFilm: «Фильмы», or an empty category guessed as a film', () => {
    expect(isLibraryFilm({ title: FILM, category: 'movie' })).toBe(true);
    expect(isLibraryFilm({ title: FILM, category: '' })).toBe(true);
    expect(isLibraryFilm({ title: 'Starbound Frontier S01 1080p', category: '' })).toBe(false);
    expect(isLibraryFilm({ title: FILM, category: 'tv' })).toBe(false);
    expect(isLibraryFilm({ title: FILM, category: 'other' })).toBe(false);
  });

  it('isWatchedFilm: omp.q false switches a film off, omp.w does not', () => {
    expect(isWatchedFilm(film())).toBe(true);
    expect(isWatchedFilm(film(FILM, { data: JSON.stringify({ omp: { v: 1, h: [], q: false } }) }))).toBe(false);
    expect(isWatchedFilm(film(FILM, { data: JSON.stringify({ omp: { v: 1, h: [], w: false } }) }))).toBe(true);
  });

  it('filmQuery: the first name plus the year', () => {
    expect(filmQuery(FILM)).toBe('Северный ветер 2026');
    expect(filmQuery('Северный ветер / North Wind (2026) BDRip 1080p')).toBe('Северный ветер 2026');
    expect(filmQuery('North.Wind.2026.1080p.WEB-DL')).toBe('North Wind 2026');
    expect(filmQuery('Северный ветер BDRip')).toBe('Северный ветер');
    expect(filmQuery('')).toBe('');
  });
});

describe('pickBetter', () => {
  it('the same film (name, year ±1) in better quality: the highest rank, then seeds', () => {
    const hdr = res('Северный ветер (2026) 2160p WEB-DL HDR', { Seed: 50 });
    const uhd = res('North Wind / Северный ветер (2027) 2160p WEB-DL', { Seed: 3 });
    const bd = res('Северный ветер (2026) BDRip 1080p', { Seed: 5 });
    const list = [
      bd,
      res('Северный ветер (2019) 2160p Remux'),
      res('Южный ветер (2026) 2160p Remux'),
      res('Северный ветер / Сезон 1 (2026) 2160p'),
      res('Северный ветер (2026) WEB-DL 720p'),
      res('Северный ветер (2026) WEB-DL 1080p'),
      res('Северный ветер 2160p Remux'),
      res('Северный ветер (2026) 2160p Remux', { hash: H }),
      uhd,
      hdr,
    ];
    const b = pickBetter(film(), list)!;
    expect(b.torrentHash).toBe(H);
    expect(b.rank).toBe(32);
    expect(b.candidate).toBe(hdr);
    expect(b.others).toEqual([uhd, bd]);
  });

  it('nothing better: null', () => {
    expect(pickBetter(film(), [res('Северный ветер (2026) WEB-DL 1080p'), res('Северный ветер (2026) CAMRip')])).toBeNull();
  });

  it('an unknown-resolution camrip in the library is beaten by a known non-camrip, any other unknown one is not', () => {
    expect(pickBetter(film('Северный ветер (2026) CAMRip'), [res('Северный ветер (2026) WEB-DL 720p')])!.rank).toBe(12);
    expect(pickBetter(film('Северный ветер (2026) BDRip'), [res('Северный ветер (2026) WEB-DL 1080p')])).toBeNull();
  });
});

describe('checkBetterQuality', () => {
  it('one finding per new best rank; each film at most once a day; series are not searched', async () => {
    const q: string[] = [];
    const uhd = res('Северный ветер (2026) 2160p WEB-DL', { Seed: 30 });
    const series: LibraryTorrent = { hash: 'e'.repeat(40), title: 'Starbound Frontier / Сезон: 1 / Серии: 1-8 из 10 [2026]', category: 'tv' };
    const lib = [film(), series];
    const T0 = 1_000_000;
    const first = await checkBetterQuality(ctx, lib, { search: fakeSearch([uhd], q), now: T0 });
    expect(q).toEqual(['Северный ветер 2026']);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      subId: BETTER_ID,
      key: H + ':32',
      at: T0,
      better: { torrentHash: H, torrentTitle: FILM, have: '1080p WEB-DL', got: '4K WEB-DL' },
    });
    expect(first[0].result).toBe(uhd);
    expect(seenKeys(BETTER_ID)).toEqual([H + ':32']);
    expect(JSON.parse(localStorage.getItem(BETTER_CHECKED_KEY)!)).toEqual({ [H]: T0 });
    // within a day: not searched again
    expect(await checkBetterQuality(ctx, lib, { search: fakeSearch([uhd], q), now: T0 + 3_600_000 })).toEqual([]);
    expect(q).toHaveLength(1);
    // a day later the same rank is not reported again
    const day = T0 + BETTER_EVERY_MS;
    expect(await checkBetterQuality(ctx, lib, { search: fakeSearch([uhd], q), now: day })).toEqual([]);
    expect(q).toHaveLength(2);
    // a higher rank is; the film keeps one card
    const remux = res('Северный ветер (2026) 2160p Remux', { Seed: 4 });
    const third = await checkBetterQuality(ctx, lib, { search: fakeSearch([uhd, remux], q), now: day * 2 });
    expect(third.map((f) => f.key)).toEqual([H + ':34']);
    expect(findingsOf(BETTER_ID).map((f) => f.key)).toEqual([H + ':34']);
    // better than the library but below the reported rank: silent
    expect(await checkBetterQuality(ctx, lib, { search: fakeSearch([res('Северный ветер (2026) BDRip 1080p')], q), now: day * 3 })).toEqual([]);
    expect(q).toHaveLength(4);
  });

  it('a search no source answered does not use up the day', async () => {
    const q: string[] = [];
    await checkBetterQuality(ctx, [film()], { search: fakeSearch([], q, false), now: 5 });
    expect(betterDue(H, 6)).toBe(true);
    await checkBetterQuality(ctx, [film()], { search: fakeSearch([], q), now: 7 });
    expect(betterDue(H, 8)).toBe(false);
    expect(q).toHaveLength(2);
  });

  it('switched-off films are never searched; stamps are pruned to the library', async () => {
    const q: string[] = [];
    const off = film(FILM, { data: JSON.stringify({ omp: { v: 1, h: [], q: false } }) });
    expect(await checkBetterQuality(ctx, [off], { search: fakeSearch([res('Северный ветер (2026) 2160p Remux')], q), now: 1 })).toEqual([]);
    expect(q).toEqual([]);
    localStorage.setItem(BETTER_CHECKED_KEY, JSON.stringify({ [H]: 1, ['a'.repeat(40)]: 2 }));
    pruneBetterChecked((h) => h === H);
    expect(JSON.parse(localStorage.getItem(BETTER_CHECKED_KEY)!)).toEqual({ [H]: 1 });
  });

  it('dueFilms: never checked first, then the longest unchecked; recent ones wait', () => {
    const a = film(FILM, { hash: 'a'.repeat(40) });
    const b = film('Тихая гавань (2025) BDRip 1080p', { hash: 'b'.repeat(40) });
    const c = film('Ночной рейс (2024) WEB-DL 720p', { hash: 'c'.repeat(40) });
    const now = 10 * BETTER_EVERY_MS;
    localStorage.setItem(BETTER_CHECKED_KEY, JSON.stringify({ ['a'.repeat(40)]: 2 * BETTER_EVERY_MS, ['b'.repeat(40)]: BETTER_EVERY_MS }));
    expect(dueFilms([a, b, c], now).map((t) => t.hash[0])).toEqual(['c', 'b', 'a']);
    localStorage.setItem(BETTER_CHECKED_KEY, JSON.stringify({ ['a'.repeat(40)]: now - 1000 }));
    expect(dueFilms([a, b, c], now).map((t) => t.hash[0])).toEqual(['b', 'c']);
  });

  it('findBetter ignores the daily limit (the replace sheet asks for «Другая раздача»)', async () => {
    localStorage.setItem(BETTER_CHECKED_KEY, JSON.stringify({ [H]: Date.now() }));
    const b = await findBetter(ctx, film(), { search: fakeSearch([res('Северный ветер (2026) BDRip 1080p')], []) });
    expect(b!.rank).toBe(23);
    expect(betterKey(b!)).toBe(H + ':23');
  });
});

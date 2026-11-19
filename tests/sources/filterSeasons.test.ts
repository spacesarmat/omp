import { describe, expect, it } from 'vitest';
import { catalogQuery, filterSeasonChips, titlesNameSeason, tmdbSeasonFacts, uniqueSeries, type TmdbSeasonFacts } from '../../src/sources/filterSeasons';
import { applyFilters, NO_FILTERS, sinkUnknownSeasons } from '../../src/sources/filters';

const TMDB: TmdbSeasonFacts = { count: 2, specials: false };
const many = (n: number, title: string) => Array.from({ length: n }, () => title);

describe('filterSeasonChips', () => {
  it('uses the TMDB season count and the number of matching releases', () => {
    const titles = many(3, 'Локи S01 1080p').concat(many(14, 'Локи S02 2160p'), ['Другой сериал S06 WEB-DL', 'Локи (2024) 1080p']);
    expect(filterSeasonChips(titles, TMDB)).toEqual([
      { season: 1, count: 3 },
      { season: 2, count: 14 },
    ]);
  });

  it('drops a parsed season above the TMDB count and keeps that release when no season is chosen', () => {
    const odd = { Title: 'Локи S06 1080p', Seed: 4 };
    const titles = ['Локи S01 1080p', 'Локи S02 1080p', odd.Title];
    expect(filterSeasonChips(titles, TMDB).map((c) => c.season)).toEqual([1, 2]);
    expect(applyFilters([odd], { ...NO_FILTERS, season: 0 })).toEqual([odd]);
  });

  it('counts a pack only for the seasons TMDB has', () => {
    expect(filterSeasonChips(['Локи Сезоны 1-6 WEB-DL', 'Локи S02 1080p'], TMDB)).toEqual([
      { season: 1, count: 1 },
      { season: 2, count: 2 },
    ]);
  });

  it('shows season 0 only when a release names it and TMDB has specials', () => {
    const titles = ['Локи S00 1080p', 'Локи S01 1080p'];
    expect(filterSeasonChips(titles, TMDB)).toEqual([{ season: 1, count: 1 }]);
    expect(filterSeasonChips(titles, { count: 2, specials: true })).toEqual([
      { season: 0, count: 1 },
      { season: 1, count: 1 },
    ]);
    const rows = titles.map((Title) => ({ Title, Seed: 2 }));
    expect(applyFilters(rows, { ...NO_FILTERS, specials: true }).map((r) => r.Title)).toEqual(['Локи S00 1080p']);
    expect(applyFilters(rows, { ...NO_FILTERS, season: 2, fullSeason: true })).toEqual([]);
  });

  it('without TMDB keeps a season only when at least two releases name it', () => {
    const titles = ['Локи S01 1080p', 'Локи S02 1080p', 'Локи S02 2160p', 'Чужой S05 WEB-DL', 'Локи S06 720p'];
    expect(filterSeasonChips(titles, null)).toEqual([{ season: 2, count: 2 }]);
  });
});

describe('tmdbSeasonFacts', () => {
  it('reads the highest regular season and the specials flag', () => {
    expect(tmdbSeasonFacts({ kind: 'tv', seasons: [{ number: 2 }, { number: 1 }], specials: true })).toEqual({ count: 2, specials: true });
    expect(tmdbSeasonFacts({ kind: 'tv', seasons: [{ number: 2 }], specials: false })).toEqual({ count: 2, specials: false });
    expect(tmdbSeasonFacts({ kind: 'tv', seasons: [{ number: 2 }] })).toBeNull();
    expect(tmdbSeasonFacts({ kind: 'tv', seasons: [] })).toBeNull();
    expect(tmdbSeasonFacts({ kind: 'movie', seasons: [{ number: 1 }], specials: false })).toBeNull();
    expect(tmdbSeasonFacts(null)).toBeNull();
  });

  it('uses TMDB only for one exact title, and keeps a single named season visible for the full-season control', () => {
    expect(catalogQuery('Локи 2 сезон')).toBe('Локи');
    const loki = { id: 1, kind: 'tv', title: 'Локи', original: 'Loki', year: 2021 };
    const other = { id: 2, kind: 'tv', title: 'Локи', original: 'Loki', year: 2012 };
    expect(uniqueSeries('Локи 2 сезон', [loki, { id: 3, kind: 'movie', title: 'Локи', original: 'Loki', year: 2021 }])?.id).toBe(1);
    expect(uniqueSeries('Локи', [loki, other])).toBeNull();
    expect(uniqueSeries('Локи 2021', [loki, other])?.id).toBe(1);
    expect(uniqueSeries('Ло', [loki])).toBeNull();
    expect(titlesNameSeason(['Локи S02E01-06 из 10'])).toBe(true);
    expect(titlesNameSeason(['Локи 1080p'])).toBe(false);
  });

  it('puts a specials match above a release that names no season', () => {
    const rows = [
      { Title: 'Локи 2160p', Seed: 40 },
      { Title: 'Локи S00 1080p', Seed: 2 },
    ];
    expect(sinkUnknownSeasons(rows, 0, true).map((r) => r.Title)).toEqual(['Локи S00 1080p', 'Локи 2160p']);
    expect(sinkUnknownSeasons(rows, 0).map((r) => r.Title)).toEqual(['Локи 2160p', 'Локи S00 1080p']);
  });
});

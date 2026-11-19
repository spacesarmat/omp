// Season chips of the search filters. TMDB's season count decides which parsed seasons are real.
// A number above that count is a misparse (another show, a year) and does not get a chip.
// Without TMDB, only a season named by at least two releases is kept.
import { SEASON_WORDS } from '../monitor/episodes';
import { parseRelease } from './filters';

/** Highest regular season TMDB lists, and whether it has a specials season (number 0). */
export interface TmdbSeasonFacts {
  count: number;
  specials: boolean;
}

export interface FilterSeasonChip {
  season: number;
  /** Releases whose title names this season. */
  count: number;
}

const MAX_CHIPS = 12;

function fold(s: string): string {
  return (s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/** The catalog search for a tracker query: the season words at the end are not part of the title. */
export function catalogQuery(query: string): string {
  const cut = (query || '').replace(SEASON_WORDS, ' ').replace(/\s+/g, ' ').trim();
  return cut || (query || '').trim();
}

export interface SeriesPick {
  id: number;
  title: string;
  original: string;
  year: number;
  kind: string;
}

/**
 * One TV show only when the query names it exactly (year too, when the query has one).
 * A partial title or two shows with the same name is not a match: the caller keeps the fallback.
 */
export function uniqueSeries(query: string, items: SeriesPick[]): SeriesPick | null {
  const q = fold(catalogQuery(query));
  if (q.length < 2) return null;
  const yearHit = /(?:^|[^0-9])((?:19|20)\d\d)(?![0-9])/.exec(q);
  const wantYear = yearHit ? Number(yearHit[1]) : 0;
  const qName = wantYear ? q.replace(yearHit![0], ' ').replace(/\s+/g, ' ').trim() : q;
  if (qName.length < 2) return null;
  const hits = items.filter((i) => {
    if (i.kind !== 'tv') return false;
    const names = [i.title, i.original].map(fold).filter((s) => s.length >= 2);
    if (!names.some((n) => n === qName || n === q)) return false;
    if (wantYear && i.year && i.year !== wantYear) return false;
    return true;
  });
  return hits.length === 1 ? hits[0] : null;
}

/** Season facts from a series card. Null when the card has no season list or no explicit specials flag. */
export function tmdbSeasonFacts(card: { kind?: string; seasons?: { number: number }[]; specials?: boolean } | null | undefined): TmdbSeasonFacts | null {
  if (!card || card.kind !== 'tv' || !card.seasons || typeof card.specials !== 'boolean') return null;
  let count = 0;
  card.seasons.forEach((s) => {
    if (s.number > count) count = s.number;
  });
  if (count < 1 && !card.specials) return null;
  return { count, specials: card.specials };
}

/** A title names a season or a complete series, even when that is not enough for a chip. */
export function titlesNameSeason(titles: string[]): boolean {
  return titles.some((title) => {
    const info = parseRelease(title);
    return info.seasons.length > 0 || info.allSeasons;
  });
}

function allowed(season: number, tmdb: TmdbSeasonFacts | null): boolean {
  if (!tmdb) return true;
  if (season === 0) return tmdb.specials;
  return season >= 1 && season <= tmdb.count;
}

/**
 * Chips for «СЕРИАЛЫ». With TMDB, only seasons 1..count that a release names, plus season 0 when TMDB has
 * specials and a release names them. A parsed season above the count is ignored. Without TMDB, a season
 * needs two releases. Order is the season number. At most 12 chips.
 */
export function filterSeasonChips(titles: string[], tmdb: TmdbSeasonFacts | null): FilterSeasonChip[] {
  const tallies: { [n: number]: number } = {};
  titles.forEach((title) => {
    const seen: { [n: number]: boolean } = {};
    parseRelease(title).seasons.forEach((s) => {
      if (seen[s] || !allowed(s, tmdb)) return;
      seen[s] = true;
      tallies[s] = (tallies[s] || 0) + 1;
    });
  });
  const seasons = Object.keys(tallies).map((k) => Number(k)).filter((s) => (tmdb ? tallies[s] > 0 : tallies[s] >= 2));
  seasons.sort((a, b) => a - b);
  return seasons.slice(0, MAX_CHIPS).map((season) => ({ season, count: tallies[season] }));
}

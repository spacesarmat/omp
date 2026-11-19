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

/** The TMDB title belongs to this search (the query contains it, or it starts with the query). */
export function titleInQuery(query: string, title: string, original: string): boolean {
  const q = fold(catalogQuery(query));
  if (q.length < 2) return false;
  const names = [title, original].map(fold).filter((s) => s.length >= 2);
  return names.some((n) => q === n || q.indexOf(n) >= 0 || n.indexOf(q) === 0);
}

/** Season facts from a series card. Null when the card has no season list (TMDB was not there). */
export function tmdbSeasonFacts(card: { kind?: string; seasons?: { number: number }[]; specials?: boolean } | null | undefined): TmdbSeasonFacts | null {
  if (!card || card.kind !== 'tv' || !card.seasons) return null;
  let count = 0;
  card.seasons.forEach((s) => {
    if (s.number > count) count = s.number;
  });
  const specials = card.specials === true;
  if (count < 1 && !specials) return null;
  return { count, specials };
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

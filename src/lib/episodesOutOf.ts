// The torrent header's episode part: «5 из 8 серий» when the season's TMDB total is known, else «5 серий».
// After «из» the noun is genitive and follows the total, not the count the torrent has: «1 из 1 серии»,
// «2 из 4 серий», «5 из 8 серий», «2 из 21 серии».
import { tp } from '../i18n';

/** «5 из 8 серий» / «5 of 8 episodes»; `total` ≤ 0 keeps «5 серий» / «5 episodes». */
export function episodesOutOf(have: number, total: number): string {
  const n = Math.floor(total);
  if (!(n > 0)) return tp('library.episodes', have);
  return tp('series.episodesOf', n, { have: Math.floor(have) });
}

/**
 * How many episodes TMDB gives a season: the show card's `episode_count`, or the loaded season details when they
 * list more. 0 when neither is known (`season` null included).
 */
export function seasonEpisodeTotal(
  show: { episodeCounts?: { [n: number]: number } } | null,
  eps: { [season: number]: { [ep: number]: unknown } } | null | undefined,
  season: number | null,
): number {
  if (season === null || !isFinite(season)) return 0;
  const fromCard = show && show.episodeCounts && show.episodeCounts[season] > 0 ? show.episodeCounts[season] : 0;
  const map = eps && eps[season];
  const listed = map ? Object.keys(map).length : 0;
  return Math.max(fromCard, listed);
}

// Totals already learned for a series, so another season's chip can say «2 из 10» before that torrent's own lookup
// returns. Raised only: a later, larger count replaces a smaller one.
const remembered = new Map<string, { [n: number]: number }>();

/** Remember season totals for a series key (the normalized name the library groups on). */
export function rememberSeasonTotals(key: string, counts: { [n: number]: number }): void {
  if (!key) return;
  let cur = remembered.get(key);
  if (!cur) {
    cur = {};
    remembered.set(key, cur);
  }
  Object.keys(counts).forEach((k) => {
    const n = +k;
    const v = counts[n];
    if (v > 0 && v > (cur[n] || 0)) cur[n] = v;
  });
}

/** A season total remembered for this series; 0 when none. */
export function rememberedSeasonTotal(key: string, season: number): number {
  const cur = key ? remembered.get(key) : undefined;
  return cur && cur[season] > 0 ? cur[season] : 0;
}

/** Forget remembered totals (tests, and when the matched shows are dropped). */
export function resetSeasonTotals(): void {
  remembered.clear();
}

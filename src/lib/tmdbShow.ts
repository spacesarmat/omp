// The TMDB show of a series torrent: a tracker title holds the name in several variants («Русское / English / …»);
// TMDB finds a show by its whole name, so each variant is tried in turn — the local one first, then the original —
// and the short poster query last. In English the variants in Latin letters go first: TMDB matches a query against the
// titles in the asked language (and alternative titles), so a Russian name searched in English can find only another
// show of that name (Dark Matter 2015 for «Тёмная материя» instead of Dark Matter 2024).
// Shared by the series screen and the episode names of the torrent screen.
import { lang } from '../i18n';
import { normTitle, posterQuery, titleCore } from './posterSearch';
import { seriesQuery } from '../monitor/newEpisodes';
import type { CatalogTitle } from '../catalog/tmdb';

interface Searcher {
  search(query: string, page: number): Promise<{ items: CatalogTitle[] }>;
}

const CYRILLIC = /[Ѐ-ӿ]/;

/** The queries to try for a series title, most specific first, without repeats; in English the Latin ones first. */
export function showQueries(title: string, uiLang: string = lang.peek()): string[] {
  const out: string[] = [];
  const add = (q: string) => {
    const s = (q || '').trim();
    if (s && out.indexOf(s) < 0) out.push(s);
  };
  const parts = (title || '').split(' / ');
  add(seriesQuery(title));
  add(titleCore(parts[0]));
  if (parts[1]) add(titleCore(parts[1]));
  add(posterQuery(title));
  if (uiLang !== 'en') return out;
  return out.filter((q) => !CYRILLIC.test(q)).concat(out.filter((q) => CYRILLIC.test(q)));
}

function fold(s: string): string {
  // letters of every script stay, so an Armenian or Japanese title can still match exactly
  return normTitle(s);
}

/** What the torrent itself says, used to break ties between shows that share a word. */
export interface ShowFacts {
  /** Highest season number the release names. */
  season?: number;
  /** Episodes this release holds. */
  episodes?: number;
  /** A typical episode length in minutes, when the files or the size say so. */
  runtimeMin?: number;
  /** 4K or HDR: a release from the modern era, not a show from the 2000s. */
  modern?: boolean;
}

interface Ranked { item: CatalogTitle; score: number; exact: boolean; }

function popularityOf(s: CatalogTitle): number {
  return s.popularity && s.popularity > 0 ? s.popularity : 0;
}

function extraOf(s: CatalogTitle): { voteCount: number; seasonCount: number; runtime: number } {
  return {
    voteCount: s.voteCount && s.voteCount > 0 ? s.voteCount : 0,
    seasonCount: s.seasonCount && s.seasonCount > 0 ? s.seasonCount : 0,
    runtime: s.runtime && s.runtime > 0 ? s.runtime : 0,
  };
}

function isExactTitle(s: CatalogTitle, q: string): boolean {
  if (!q) return false;
  return fold(s.title) === q || fold(s.original) === q;
}

function containsQuery(s: CatalogTitle, q: string): boolean {
  if (!q) return false;
  const title = fold(s.title);
  const original = fold(s.original);
  return title.indexOf(q) >= 0 || (!!original && original.indexOf(q) >= 0);
}

/** Score of one show. An exact title always beats a title that only contains the query. */
function scoreShow(s: CatalogTitle, year: number, q: string, facts?: ShowFacts): Ranked {
  const exact = isExactTitle(s, q);
  let score = s.rating || 0;
  if (exact) score += 500;
  else if (containsQuery(s, q)) score += 40;
  const pop = popularityOf(s);
  if (pop) score += Math.min(60, Math.log(pop + 1) / Math.LN10 * 25);
  const extra = extraOf(s);
  if (extra.voteCount) score += Math.min(40, Math.log(extra.voteCount + 1) / Math.LN10 * 12);
  if (year && s.year === year) score += 80;
  else if (year && s.year && Math.abs(s.year - year) === 1) score += 30;
  else if (year && s.year && Math.abs(s.year - year) > 1) score -= 50;
  if (facts && facts.modern && s.year && s.year < 2012) score -= 80;
  if (facts && facts.season && extra.seasonCount) {
    if (extra.seasonCount < facts.season) score -= 70;
    else score += 25;
  }
  if (facts && facts.runtimeMin && extra.runtime) {
    if (facts.runtimeMin >= 40 && extra.runtime >= 40) score += 40;
    if (facts.runtimeMin >= 40 && extra.runtime < 30) score -= 50;
  }
  return { item: s, score: score, exact: exact };
}

/**
 * The show that fits the query. An exact title beats a longer one that only contains the word
 * (Marvel «Loki» over an anime whose name also contains it). The asked year, popularity and
 * the torrent's season, episode length and 4K era break the remaining ties. Films never match.
 */
export function pickShow(items: CatalogTitle[], year: number, query?: string, facts?: ShowFacts): CatalogTitle | null {
  const shows = items.filter((x) => x.kind === 'tv');
  if (!shows.length) return null;
  const near = !year || shows.some((s) => s.year && Math.abs(s.year - year) <= 1);
  if (year && !near) return shows[0];
  const q = fold(query || '');
  let best: Ranked | null = null;
  for (let i = 0; i < shows.length; i++) {
    const ranked = scoreShow(shows[i], year, q, facts);
    if (!best || ranked.score > best.score) best = ranked;
  }
  return best ? best.item : null;
}

/** The show found by the queries. An exact title stops the search; a title that only contains the word does not. */
export function findShow(c: Searcher, title: string, year: number, facts?: ShowFacts): Promise<CatalogTitle | null> {
  const queries = showQueries(title);
  const next = (i: number, best: Ranked | null): Promise<CatalogTitle | null> => {
    if (i >= queries.length) return Promise.resolve(best ? best.item : null);
    return c.search(queries[i], 1).then((r) => {
      const q = fold(queries[i]);
      const shows = (r.items || []).filter((x) => x.kind === 'tv');
      let top: Ranked | null = null;
      for (let k = 0; k < shows.length; k++) {
        const ranked = scoreShow(shows[k], year, q, facts);
        if (!top || ranked.score > top.score) top = ranked;
      }
      if (top && top.exact) return Promise.resolve(top.item);
      const keep = top && (!best || top.score > best.score) ? top : best;
      return next(i + 1, keep);
    });
  };
  return next(0, null);
}

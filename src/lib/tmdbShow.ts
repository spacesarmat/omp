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

/**
 * The show that fits the query. An exact title beats a longer one that only contains the word
 * (Marvel «Loki» over an anime whose name also contains it). The asked year beats a different year.
 * Films never match.
 */
export function pickShow(items: CatalogTitle[], year: number, query?: string): CatalogTitle | null {
  const shows = items.filter((x) => x.kind === 'tv');
  if (!shows.length) return null;
  const near = !year || shows.some((s) => s.year && Math.abs(s.year - year) <= 1);
  if (year && !near) return shows[0];
  const q = fold(query || '');
  let best: CatalogTitle = shows[0];
  let bestScore = -1e9;
  for (let i = 0; i < shows.length; i++) {
    const s = shows[i];
    let score = s.rating || 0;
    const title = fold(s.title);
    const original = fold(s.original);
    if (q && (title === q || original === q)) score += 100;
    else if (q && (title.indexOf(q) >= 0 || (original && original.indexOf(q) >= 0))) score += 40;
    if (year && s.year === year) score += 50;
    else if (year && s.year && Math.abs(s.year - year) === 1) score += 20;
    else if (year && s.year && Math.abs(s.year - year) > 1) score -= 40;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

/** The first show found by the queries in turn; null when none finds one. Rejects when TMDB cannot be reached. */
export function findShow(c: Searcher, title: string, year: number): Promise<CatalogTitle | null> {
  const queries = showQueries(title);
  const next = (i: number): Promise<CatalogTitle | null> => {
    if (i >= queries.length) return Promise.resolve(null);
    return c.search(queries[i], 1).then((r) => pickShow(r.items, year, queries[i]) || next(i + 1));
  };
  return next(0);
}

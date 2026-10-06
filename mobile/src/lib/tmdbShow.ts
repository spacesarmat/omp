// The TMDB show of a series torrent: a tracker title holds the name in several variants («Русское / English / …»);
// TMDB finds a show by its whole name, so each variant is tried in turn — the local one first, then the original —
// and the short poster query last. In English the variants in Latin letters go first: TMDB matches a query against the
// titles in the asked language (and alternative titles), so a Russian name searched in English can find only another
// show of that name (Dark Matter 2015 for «Тёмная материя» instead of Dark Matter 2024).
// Shared by the series screen and the episode names of the torrent screen.
import { lang } from '../../../src/i18n';
import { posterQuery, titleCore } from '../../../src/lib/posterSearch';
import { seriesQuery } from '../../../src/monitor/newEpisodes';
import type { CatalogTitle } from '../../../src/catalog/tmdb';

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

/** A series of that year among the items, else the first series; films never match. */
export function pickShow(items: CatalogTitle[], year: number): CatalogTitle | null {
  const shows = items.filter((x) => x.kind === 'tv');
  const same = year ? shows.filter((x) => x.year === year)[0] : undefined;
  return same || shows[0] || null;
}

/** The first show found by the queries in turn; null when none finds one. Rejects when TMDB cannot be reached. */
export function findShow(c: Searcher, title: string, year: number): Promise<CatalogTitle | null> {
  const queries = showQueries(title);
  const next = (i: number): Promise<CatalogTitle | null> => {
    if (i >= queries.length) return Promise.resolve(null);
    return c.search(queries[i], 1).then((r) => pickShow(r.items, year) || next(i + 1));
  };
  return next(0);
}

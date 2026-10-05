// The series screen: the TMDB show of a library series, found like the release posters are (a TMDB search for the
// poster query of the title, the year preferred) and kept in memory per series key and language, so a revisit is instant.
// A failed lookup (offline, no key) is not kept; a search with no show is.
import { lang } from '../../../src/i18n';
import { phoneCatalog } from '../catalog/phoneCatalog';
import { posterQuery } from '../../../src/lib/posterSearch';
import { displayTitle, yearOf } from '../../../src/lib/torrentName';
import type { CatalogCard, CatalogTitle } from '../../../src/catalog/tmdb';
import type { SeriesGroup } from './seriesGroups';

const matches = new Map<string, CatalogCard | null>();

const cacheKey = (key: string) => lang.peek() + '|' + key;

/** The match found before: a card, null (no show), undefined (not looked up yet). */
export function cachedSeriesMatch(key: string): CatalogCard | null | undefined {
  return matches.get(cacheKey(key));
}

/** The show among search results: a series of that year, else the first series; films never match. */
export function pickShow(items: CatalogTitle[], year: number): CatalogTitle | null {
  const shows = items.filter((x) => x.kind === 'tv');
  const same = year ? shows.filter((x) => x.year === year)[0] : undefined;
  return same || shows[0] || null;
}

/** The earliest year in the titles of the series' torrents (the first season's, closest to the first air date). */
function groupYear(g: SeriesGroup): number {
  let best = 0;
  g.members.forEach((m) => {
    const y = +(yearOf(displayTitle(m).replace(/[._]+/g, ' ')) || 0);
    if (y && (!best || y < best)) best = y;
  });
  return best;
}

/** The TMDB card of the series (null when TMDB has no such show); rejects when TMDB cannot be reached. */
export function matchSeries(g: SeriesGroup): Promise<CatalogCard | null> {
  const key = cacheKey(g.key);
  const hit = matches.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const query = posterQuery(displayTitle(g.lead));
  if (!query) {
    matches.set(key, null);
    return Promise.resolve(null);
  }
  return phoneCatalog().then((c) =>
    c.search(query, 1).then((r) => {
      const show = pickShow(r.items, groupYear(g));
      if (!show) {
        matches.set(key, null);
        return null;
      }
      return c.card('tv', show.id).then((card) => {
        matches.set(key, card);
        return card;
      });
    }),
  );
}

/** Tests: forget every match. */
export function resetSeriesMatches(): void {
  matches.clear();
}

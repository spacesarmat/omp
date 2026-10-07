// The TMDB film of a title and year (a filmography entry that has to open its own card).
import type { CatalogClient } from '../catalog/client';
import type { CatalogCard } from '../catalog/tmdb';

const cache = new Map<string, Promise<CatalogCard | null>>();

/** The film `title` of `year` (a year off by one when no exact one); null when TMDB has none or cannot be reached. */
export function findMovie(c: CatalogClient, title: string, year: number): Promise<CatalogCard | null> {
  const key = title + '|' + year;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = c
    .search(title, 1)
    .then((r) => {
      const films = r.items.filter((x) => x.kind === 'movie');
      const near = films.filter((x) => x.year === year)[0] || films.filter((x) => Math.abs(x.year - year) === 1)[0];
      return near ? c.card('movie', near.id) : null;
    })
    .catch(() => {
      cache.delete(key); // a failure is not remembered: the next ask tries again
      return null;
    });
  cache.set(key, p);
  return p;
}

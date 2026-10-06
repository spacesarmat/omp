// Posters for found releases on the phone: the shared queue (src/catalog/resultPosters) with the «Обзор» catalog
// client, whose answers are cached on the phone.
import { phoneCatalog } from '../catalog/phoneCatalog';
import { setPosterLookup, type PosterLookup } from '../../../src/catalog/resultPosters';

export { MAX_RUNNING, posterKey, requestPoster } from '../../../src/catalog/resultPosters';
export type { PosterLookup } from '../../../src/catalog/resultPosters';

const catalogLookup: PosterLookup = (query, year) =>
  phoneCatalog()
    .then((c) => c.search(query, 1))
    .then((r) => {
      const withPoster = r.items.filter((x) => !!x.poster);
      const same = year ? withPoster.filter((x) => x.year === year)[0] : undefined;
      return (same || withPoster[0] || { poster: '' }).poster;
    });

setPosterLookup(catalogLookup);

/** A fake lookup for tests (null restores the catalog one); also forgets every poster found so far. */
export function setPosterLookupForTests(fn: PosterLookup | null): void {
  setPosterLookup(fn || catalogLookup);
}

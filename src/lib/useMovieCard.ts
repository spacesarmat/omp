// The TMDB card of the film a torrent screen shows (for its cast): title and year as the library index reads them,
// looked up once per torrent. Series and unmatched torrents give null.
import { useEffect, useState } from 'preact/hooks';
import { activeCatalog } from '../catalog/activeCatalog';
import { yearOf } from '../catalog/library';
import type { CatalogCard } from '../catalog/tmdb';
import type { Torrent } from '../api/types';
import { isLibraryFilm } from '../monitor/better';
import { titleCore } from './posterSearch';
import { findMovie } from './tmdbMovie';

const cache = new Map<string, CatalogCard | null>();

export function useMovieCard(tor: Torrent | undefined | null): CatalogCard | null {
  const hash = tor ? tor.hash : '';
  const title = tor ? tor.title || '' : '';
  const film = !!tor && isLibraryFilm({ title: title, category: tor.category });
  const [card, setCard] = useState<CatalogCard | null>(() => (film && cache.has(hash) ? cache.get(hash) || null : null));
  useEffect(() => {
    const core = film ? titleCore(title) : '';
    const year = film ? yearOf(title) : 0;
    if (!core || !year) {
      setCard(null);
      return;
    }
    if (cache.has(hash)) {
      setCard(cache.get(hash) || null);
      return;
    }
    let live = true;
    setCard(null);
    activeCatalog()
      .then((c) => findMovie(c, core, year))
      .then(
        (r) => {
          if (r) cache.set(hash, r);
          if (live) setCard(r);
        },
        () => undefined, // no TMDB: no cast
      );
    return () => {
      live = false;
    };
  }, [hash, title, film]);
  return card;
}

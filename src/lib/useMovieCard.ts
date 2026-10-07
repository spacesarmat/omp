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
  return useMovieLookup(tor).card;
}

/** The card plus «pending»: a film that will be (or is being) looked up and has no answer yet, so the screen can reserve the cast row. */
export function useMovieLookup(tor: Torrent | undefined | null): { card: CatalogCard | null; pending: boolean } {
  const hash = tor ? tor.hash : '';
  const title = tor ? tor.title || '' : '';
  const film = !!tor && isLibraryFilm({ title: title, category: tor.category });
  const willLookUp = film && !!titleCore(title) && !!yearOf(title);
  const [card, setCard] = useState<CatalogCard | null>(() => (film && cache.has(hash) ? cache.get(hash) || null : null));
  // the hash whose lookup has finished (found or not); pending = a lookup is due for the current hash and has not
  const [settled, setSettled] = useState<string>(() => (cache.has(hash) ? hash : ''));
  useEffect(() => {
    const core = film ? titleCore(title) : '';
    const year = film ? yearOf(title) : 0;
    if (!core || !year) {
      setCard(null);
      return;
    }
    if (cache.has(hash)) {
      setCard(cache.get(hash) || null);
      setSettled(hash);
      return;
    }
    let live = true;
    setCard(null);
    activeCatalog()
      .then((c) => findMovie(c, core, year))
      .then(
        (r) => {
          if (r) cache.set(hash, r);
          if (live) {
            setCard(r);
            setSettled(hash);
          }
        },
        () => {
          if (live) setSettled(hash); // no TMDB: no cast
        },
      );
    return () => {
      live = false;
    };
  }, [hash, title, film]);
  return { card: card, pending: willLookUp && !card && settled !== hash };
}

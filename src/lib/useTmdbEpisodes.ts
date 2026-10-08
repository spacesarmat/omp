// The TMDB show of a series torrent and the episodes of the seasons its files belong to (the torrent screens of the
// TV and the phone: names, and the announced episodes after the last one). Never blocks: null / {} until the data
// arrives (and for good when TMDB cannot be reached).
import { useEffect, useState } from 'preact/hooks';
import type { Torrent } from '../api/types';
import { seasonEpisodes, showOf, type EpisodeMap, type ShowInfo } from './episodeNames';

export function useTmdbEpisodes(tor: Torrent | null | undefined, seasons: number[], enabled: boolean): { show: ShowInfo | null; eps: EpisodeMap } {
  const [show, setShow] = useState<ShowInfo | null>(null);
  const [eps, setEps] = useState<EpisodeMap>({});
  const hash = tor ? tor.hash : '';
  useEffect(() => {
    setShow(null);
    if (!tor || !enabled) return;
    let alive = true;
    showOf(tor).then((s) => alive && setShow(s));
    return () => {
      alive = false;
    };
  }, [hash, enabled]);
  const wanted = seasons.join(',');
  useEffect(() => {
    setEps({});
    if (!show || !wanted) return;
    let alive = true;
    seasons.forEach((n) => {
      seasonEpisodes(show, n).then((m) => alive && setEps((cur) => ({ ...cur, [n]: m })));
    });
    return () => {
      alive = false;
    };
  }, [show, wanted]);
  return { show, eps };
}

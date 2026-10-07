// The TMDB card whose cast a torrent screen shows: the film's own card, or for a series torrent the matched series
// card (the series screens' match, found once per series key). «pending»: an answer is still due, so the screen can
// reserve the cast row.
import { useEffect } from 'preact/hooks';
import type { CatalogCard } from '../catalog/tmdb';
import type { Torrent } from '../api/types';
import { torrents } from '../store/library';
import { seriesGroupOf } from './cleanNames';
import { cachedSeriesMatch, requestSeriesMatch, seriesMatchFailed, seriesMatchVersion } from './seriesMatch';
import { useMovieLookup } from './useMovieCard';

export function useTorrentCast(tor: Torrent | undefined | null): { card: CatalogCard | null; pending: boolean } {
  void seriesMatchVersion.value; // a series lookup ended
  const movie = useMovieLookup(tor);
  const group = tor ? seriesGroupOf(tor, torrents.value) : null;
  const key = group ? group.key : '';
  useEffect(() => {
    if (group) requestSeriesMatch(group);
  }, [key]);
  if (!group) return movie;
  const hit = cachedSeriesMatch(key);
  return { card: hit || null, pending: hit === undefined && !seriesMatchFailed(key) };
}

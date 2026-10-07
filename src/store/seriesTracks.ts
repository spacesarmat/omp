// «Озвучка» of the series a torrent belongs to: read from the library copy of the torrents (kept in step with the
// journal writes), written to TorrServer through the watch journal (saveSeriesTracks). A film has no series record:
// its per-torrent choice (src/store/trackPrefs.ts) is all there is.
import type { Torrent } from '../api/types';
import { findGroup, seriesKey } from '../lib/seriesGroups';
import { newestSeriesTracks, type SeriesTracks, type SeriesTracksPatch } from '../lib/seriesTracks';
import { saveSeriesTracks, type JournalClient } from './journal';
import { torrents } from './library';

/** The torrents of the series of `hash` (itself included); [] for a film or an unknown torrent. */
export function seriesMembersOf(hash: string | undefined, list: Torrent[] = torrents.peek()): Torrent[] {
  if (!hash) return [];
  const tor = list.filter((x) => x.hash === hash)[0];
  const key = tor ? seriesKey(tor) : '';
  if (!tor || !key) return [];
  const g = findGroup(list, key);
  return g ? g.members : [tor];
}

/** The series' record for the torrent `hash`; null for a film or when nothing was ever chosen. */
export function seriesTracksFor(hash: string | undefined, list: Torrent[] = torrents.peek()): SeriesTracks | null {
  return newestSeriesTracks(seriesMembersOf(hash, list));
}

/**
 * A choice made by hand in a player, for the whole series of `hash` (written on that torrent). Never rejects: the
 * journal must never break playback. Nothing is written for a film.
 */
export function rememberSeriesTracks(c: JournalClient | null, hash: string | undefined, patch: SeriesTracksPatch): Promise<void> {
  if (!c || !hash) return Promise.resolve();
  const members = seriesMembersOf(hash);
  if (!members.length) return Promise.resolve();
  return saveSeriesTracks(c, hash, members.map((m) => m.hash), patch).then(
    () => undefined,
    () => undefined,
  );
}

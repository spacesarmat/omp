// «Озвучка» of the series a torrent belongs to: read from the library copy of the torrents (kept in step with the
// journal writes), written to TorrServer through the watch journal (saveSeriesTracks). A film has no series record:
// its per-torrent choice (src/store/trackPrefs.ts) is all there is.
import type { Torrent } from '../api/types';
import { findGroup, isSeries, seriesKey } from '../lib/seriesGroups';
import { newestSeriesTracks, seriesTracksOf, type SeriesTracks, type SeriesTracksPatch } from '../lib/seriesTracks';
import { saveSeriesTracks, type JournalClient } from './journal';
import { torrents } from './library';

function sameHash(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/**
 * Not a series record: music, an audiobook, or a film whose files are already known. A release added a moment ago
 * has no file list yet, so a movie category alone does not make it a film.
 */
function knownFilm(tor: Torrent): boolean {
  if (isSeries(tor)) return false;
  if (tor.category === 'music' || tor.category === 'audiobook') return true;
  if (tor.category !== 'movie') return false;
  return !!(tor.file_stats && tor.file_stats.length);
}

/** The torrents of the series of `hash` (itself included); [] for a film or an unknown torrent. */
export function seriesMembersOf(hash: string | undefined, list: Torrent[] = torrents.peek()): Torrent[] {
  if (!hash) return [];
  const tor = list.filter((x) => sameHash(x.hash, hash))[0];
  if (!tor) return [];
  const key = seriesKey(tor);
  if (key) {
    const g = findGroup(list, key);
    return g ? g.members : [tor];
  }
  // no grouping name yet, or a record written on this hash before the files said "series".
  // a known film ignores a stray omp.a (a queue of a film plus a trailer must not become a series choice)
  if (isSeries(tor) || (!knownFilm(tor) && seriesTracksOf(tor.data))) return [tor];
  return [];
}

/** The series' record for the torrent `hash`; null for a film or when nothing was ever chosen. */
export function seriesTracksFor(hash: string | undefined, list: Torrent[] = torrents.peek()): SeriesTracks | null {
  return newestSeriesTracks(seriesMembersOf(hash, list));
}

function warnTracks(msg: string): void {
  console.warn(msg);
}

/**
 * A choice made by hand in a player, for the whole series of `hash` (written on that torrent). Never rejects: a
 * failure is logged and playback goes on. Nothing is written for a known film. `playlist`: the queue has more than
 * one file of this hash (a series the library copy may still call a film, or a torrent not in the local list yet).
 * Then the server list is read, and the hash itself is written when it is not a known film.
 */
export function rememberSeriesTracks(c: JournalClient | null, hash: string | undefined, patch: SeriesTracksPatch, playlist = false): Promise<void> {
  if (!c || !hash) return Promise.resolve();
  const apply = (list: Torrent[]): Promise<void> => {
    let members = seriesMembersOf(hash, list);
    if (!members.length && playlist) {
      const tor = list.filter((x) => sameHash(x.hash, hash))[0];
      if (tor && !knownFilm(tor)) members = [tor];
    }
    if (!members.length) {
      if (playlist) warnTracks('omp.tracks no members hash=' + hash);
      return Promise.resolve();
    }
    const ids = members.map((m) => m.hash).join(',');
    warnTracks('omp.tracks hash=' + hash + ' members=' + ids + ' patch=' + JSON.stringify(patch));
    return saveSeriesTracks(c, hash, members.map((m) => m.hash), patch).then(
      () => undefined,
      (e) => {
        const msg = e && (e as Error).message ? (e as Error).message : String(e);
        warnTracks('omp.tracks save failed hash=' + hash + ' err=' + msg);
      },
    );
  };
  const peek = torrents.peek();
  const known = peek.filter((x) => sameHash(x.hash, hash))[0];
  if (known) return apply(peek);
  return Promise.resolve().then(() => c.list()).then(
    (all) => apply(all || []),
    (e) => {
      const msg = e && (e as Error).message ? (e as Error).message : String(e);
      warnTracks('omp.tracks list failed hash=' + hash + ' err=' + msg);
    },
  );
}

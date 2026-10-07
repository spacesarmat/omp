// «Open in library»: which library screen holds a TMDB title — its series screen (on the newest season the library
// has) or the torrent of a film. Shared by the TV card, the phone card and the filmography. Pure.
import type { Torrent } from '../api/types';
import { findGroup, seriesKey } from '../lib/seriesGroups';
import { libraryIndex, inLibrary, seasonIndex, librarySeasonHash, seriesNames, inLibrarySeries } from './library';
import type { CatalogTitle, Kind } from './tmdb';

export type LibraryTarget = { kind: 'series'; key: string; season?: number } | { kind: 'torrent'; hash: string };

type Named = { kind: Kind; title: string; original: string; year: number };

/** The most seasons a series is probed for in the library. */
const SEASONS_MAX = 99;

/** The library screen of a torrent: its series screen (on `season` when given) for a series, else the torrent. */
export function torrentTarget(list: Torrent[], tor: Torrent, season?: number): LibraryTarget {
  const key = seriesKey(tor);
  const g = key ? findGroup(list, key) : null;
  if (g) return season ? { kind: 'series', key: g.key, season: season } : { kind: 'series', key: g.key };
  return { kind: 'torrent', hash: tor.hash };
}

function target(list: Torrent[], seasons: Map<string, string>, title: Named): LibraryTarget | null {
  if (title.kind === 'tv') {
    for (let n = SEASONS_MAX; n >= 1; n--) {
      const hash = librarySeasonHash(seasons, title, n);
      const tor = hash ? list.filter((x) => x.hash === hash)[0] : undefined;
      if (tor) return torrentTarget(list, tor, n);
    }
  }
  const hit = list.filter((x) => inLibrary(libraryIndex([x]), title))[0];
  return hit ? torrentTarget(list, hit) : null;
}

/** Where «Открыть в медиатеке» goes; null when the library has nothing of the title. */
export function libraryTargetOf(list: Torrent[], title: Named): LibraryTarget | null {
  return target(list, title.kind === 'tv' ? seasonIndex(list) : new Map(), title);
}

/** A check «the library has it», the indexes built once for the whole list (a series counts by any season of it). */
export function ownedChecker(list: Torrent[]): (c: CatalogTitle) => boolean {
  const owned = libraryIndex(list);
  const names = seriesNames(seasonIndex(list));
  return (c) => inLibrary(owned, c) || (c.kind === 'tv' && inLibrarySeries(names, c));
}

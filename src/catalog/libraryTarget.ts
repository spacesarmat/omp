// «Open in library»: which library screen holds a TMDB title — its series screen (on the newest season the library
// has) or the torrent of a film. Shared by the TV card, the phone card and the filmography.
import type { Torrent } from '../api/types';
import { findGroup, seriesKey } from '../lib/seriesGroups';
import { knownSeriesId, seriesMatchVersion } from '../lib/seriesMatch';
import { cachedMovieId } from '../lib/useMovieCard';
import { titleCore } from '../lib/posterSearch';
import { identityText } from '../lib/keptQuality';
import {
  libraryIndex,
  libraryKey,
  inLibrary,
  nameKey,
  seasonIndex,
  seasonHashIndex,
  librarySeasonHashes,
  seriesNames,
  inLibrarySeries,
  sameWorkParts,
  yearOf,
} from './library';
import type { CatalogTitle, Kind } from './tmdb';

export type LibraryTarget = { kind: 'series'; key: string; season?: number } | { kind: 'torrent'; hash: string };

type Named = { kind: Kind; title: string; original: string; year: number; id?: number };

/** The most seasons a series is probed for in the library. */
const SEASONS_MAX = 99;

/** The library screen of a torrent: its series screen (on `season` when given) for a series, else the torrent. */
export function torrentTarget(list: Torrent[], tor: Torrent, season?: number): LibraryTarget {
  const key = seriesKey(tor);
  const g = key ? findGroup(list, key) : null;
  if (g) return season ? { kind: 'series', key: g.key, season: season } : { kind: 'series', key: g.key };
  return { kind: 'torrent', hash: tor.hash };
}

/**
 * The show this release is already known to be: the id a person locked for its series (or the last lookup found),
 * the film id of its torrent screen. 0 when this release was never matched.
 */
export function releaseShowId(tor: Torrent): number {
  const key = seriesKey(tor);
  return key ? knownSeriesId(key) : cachedMovieId(tor.hash);
}

/**
 * Known shows indexed by the same keys the library index uses: a name alone for a series (season releases rarely
 * name a year) and name with the year for a film, so two films of the same name in different years keep their own
 * ids. Every release contributes all the names it is about: its own title and its translation.
 */
type Known = { series: Map<string, Set<number>>; film: Map<string, Set<number>> };

function knownShows(list: Torrent[]): Known {
  const series = new Map<string, Set<number>>();
  const film = new Map<string, Set<number>>();
  const put = (map: Map<string, Set<number>>, key: string, id: number): void => {
    const cur = map.get(key);
    if (cur) cur.add(id);
    else map.set(key, new Set([id]));
  };
  for (let i = 0; i < list.length; i++) {
    const tor = list[i];
    const id = releaseShowId(tor);
    if (!id) continue;
    const raw = identityText(tor);
    const year = yearOf(raw);
    const add = (s: string): void => {
      const core = titleCore(s);
      if (!core) return;
      put(series, nameKey(core), id);
      if (year) put(film, libraryKey(core, year), id);
    };
    add(raw);
    sameWorkParts(raw).forEach(add);
  }
  return { series, film };
}

/**
 * True when the library knows these names as another show. A card without an id, a name nobody matched and a name
 * matched to this very show all answer false, so the old name-based behaviour stays.
 */
function showsConflict(known: Known, title: Named): boolean {
  if (!title.id) return false;
  const ids = new Set<number>();
  const names = [title.title, title.original];
  for (let i = 0; i < names.length; i++) {
    const core = names[i] ? titleCore(names[i]) : '';
    if (!core) continue;
    const set = title.kind === 'movie' ? known.film.get(libraryKey(core, title.year)) : known.series.get(nameKey(core));
    if (set) set.forEach((v) => ids.add(v));
  }
  return ids.size > 0 && !ids.has(title.id);
}

function byHash(list: Torrent[], hash: string): Torrent | undefined {
  for (let i = 0; i < list.length; i++) if (list[i].hash === hash) return list[i];
  return undefined;
}

/**
 * The first release of the title that is not known to be another show. Every candidate is tried, not only the
 * first one the index remembers: two releases can share a name and belong to different shows, and the later one
 * may be the right answer.
 */
function target(list: Torrent[], seasons: Map<string, string[]>, title: Named): LibraryTarget | null {
  const agree = (tor: Torrent): boolean => {
    const known = releaseShowId(tor);
    return !title.id || !known || known === title.id;
  };
  if (title.kind === 'tv') {
    for (let n = SEASONS_MAX; n >= 1; n--) {
      const hashes = librarySeasonHashes(seasons, title, n);
      for (let k = 0; k < hashes.length; k++) {
        const tor = byHash(list, hashes[k]);
        if (tor && agree(tor)) return torrentTarget(list, tor, n);
      }
    }
  }
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    if (x.hash && inLibrary(libraryIndex([x]), title) && agree(x)) return torrentTarget(list, x);
  }
  return null;
}

/** Where «Открыть в медиатеке» goes; null when the library has nothing of the title. */
export function libraryTargetOf(list: Torrent[], title: Named): LibraryTarget | null {
  return target(list, title.kind === 'tv' ? seasonHashIndex(list) : new Map(), title);
}

/**
 * A check «the library has it», the indexes built once for the whole list (a series counts by any season of it).
 * The known shows are rebuilt when a person corrects one, so a fix in the card menu reaches an open list without
 * waiting for the torrents to change.
 */
export function ownedChecker(list: Torrent[]): (c: CatalogTitle) => boolean {
  const owned = libraryIndex(list);
  const names = seriesNames(seasonIndex(list));
  let known = knownShows(list);
  let stamp = seriesMatchVersion.peek();
  return (c) => {
    if (!inLibrary(owned, c) && !(c.kind === 'tv' && inLibrarySeries(names, c))) return false;
    const v = seriesMatchVersion.peek();
    if (v !== stamp) {
      known = knownShows(list);
      stamp = v;
    }
    return !showsConflict(known, c);
  };
}

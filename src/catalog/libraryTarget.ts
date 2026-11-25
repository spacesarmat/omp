// «Open in library»: which library screen holds a TMDB title — its series screen (on the newest season the library
// has) or the torrent of a film. Shared by the TV card, the phone card and the filmography.
import type { Torrent } from '../api/types';
import { findGroup, seriesKey } from '../lib/seriesGroups';
import { knownSeriesId } from '../lib/seriesMatch';
import { cachedMovieId } from '../lib/useMovieCard';
import { titleCore } from '../lib/posterSearch';
import { identityText } from '../lib/keptQuality';
import { libraryIndex, inLibrary, seasonIndex, librarySeasonHash, seriesNames, inLibrarySeries } from './library';
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

/** The id of another show the library points at under this card's names; 0 when nothing conflicts. */
/**
 * name of a release (and of its translation) to the show that release is known to be. Built once per list, so a
 * card is answered by a map lookup instead of a scan.
 */
function idsOfNames(list: Torrent[]): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < list.length; i++) {
    const tor = list[i];
    const id = releaseShowId(tor);
    if (!id) continue;
    const raw = identityText(tor);
    const add = (s: string): void => {
      const core = titleCore(s);
      if (core) out.set(core, id);
    };
    add(raw);
    if (raw.indexOf(' / ') > 0) {
      const parts = raw.split(' / ');
      for (let k = 1; k < parts.length; k++) {
        if (/[а-яё]/i.test(parts[k]) === /[а-яё]/i.test(parts[0])) break;
        add(parts[k]);
      }
    }
  }
  return out;
}

/** The id of another show the library already points at under one of this card's names; 0 when nothing conflicts. */
function conflictOfNames(ids: Map<string, number>, title: Named): number {
  const names = [title.title, title.original];
  for (let i = 0; i < names.length; i++) {
    const core = names[i] ? titleCore(names[i]) : '';
    const id = core ? ids.get(core) || 0 : 0;
    if (id && id !== title.id) return id;
  }
  return 0;
}

function target(list: Torrent[], seasons: Map<string, string>, title: Named): LibraryTarget | null {
  if (title.kind === 'tv') {
    for (let n = SEASONS_MAX; n >= 1; n--) {
      const hash = librarySeasonHash(seasons, title, n);
      const tor = hash ? list.filter((x) => x.hash === hash)[0] : undefined;
      if (tor && (!title.id || !releaseShowId(tor) || releaseShowId(tor) === title.id)) return torrentTarget(list, tor, n);
    }
  }
  const hit = list.filter((x) => inLibrary(libraryIndex([x]), title))[0];
  if (!hit) return null;
  const known = releaseShowId(hit);
  return !title.id || !known || known === title.id ? torrentTarget(list, hit) : null;
}

/** Where «Открыть в медиатеке» goes; null when the library has nothing of the title. */
export function libraryTargetOf(list: Torrent[], title: Named): LibraryTarget | null {
  return target(list, title.kind === 'tv' ? seasonIndex(list) : new Map(), title);
}

/** A check «the library has it», the indexes built once for the whole list (a series counts by any season of it). */
export function ownedChecker(list: Torrent[]): (c: CatalogTitle) => boolean {
  const owned = libraryIndex(list);
  const names = seriesNames(seasonIndex(list));
  const ids = idsOfNames(list);
  return (c) => {
    if (!inLibrary(owned, c) && !(c.kind === 'tv' && inLibrarySeries(names, c))) return false;
    // a release the person already matched to another show cannot wear this card's mark either
    return !conflictOfNames(ids, c);
  };
}

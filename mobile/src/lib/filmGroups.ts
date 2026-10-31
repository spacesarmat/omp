// «Мои»: several releases of one film (the same TMDB id once known, else the same normalized title and year) are one
// card; its releases are chosen on the film's screen («Раздача: 1080p · Сменить»). Series keep their own grouping
// (seriesGroups); the TV library is not changed.
import type { Torrent } from '../../../src/api/types';
import { groupLibrary, isSeries, type LibraryItem } from '../../../src/lib/seriesGroups';
import { cachedMovieId } from '../../../src/lib/useMovieCard';
import { continueWatching, lastPlayedAt } from '../../../src/store/progress';
import { filmKeys } from './duplicates';

export interface FilmGroup {
  kind: 'film';
  key: string;
  /** In the order of the list they came from. */
  members: Torrent[];
  /** The release the card opens: the one watched last, else the newest. */
  lead: Torrent;
}

export type PhoneItem = LibraryItem | FilmGroup;

function isFilm(tor: Torrent): boolean {
  return tor.category !== 'music' && tor.category !== 'audiobook' && !isSeries(tor);
}

/** The keys a film is known by: its TMDB id (once matched), then «title|year» of every name variant. */
function keysOf(tor: Torrent): string[] {
  if (!isFilm(tor)) return [];
  const id = cachedMovieId(tor.hash);
  const out = filmKeys(tor);
  return id ? ['tmdb:' + id].concat(out) : out;
}

/**
 * The film group of each torrent (index of its first member), or -1; films sharing any key are one film, except that
 * two groups matched to different TMDB films are never joined (a shared name key must not chain different films).
 */
function filmOwners(list: Torrent[]): number[] {
  const parent = list.map((_, i) => i);
  // the TMDB id of each group root, 0 while unknown
  const movie = list.map((tor) => (isFilm(tor) ? cachedMovieId(tor.hash) : 0));
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const owner: { [k: string]: number } = {};
  const keys = list.map(keysOf);
  keys.forEach((ks, i) => {
    ks.forEach((k) => {
      if (owner[k] === undefined) owner[k] = i;
      else {
        const a = find(owner[k]);
        const b = find(i);
        if (a === b) return;
        if (movie[a] && movie[b] && movie[a] !== movie[b]) return;
        const root = Math.min(a, b);
        const other = Math.max(a, b);
        parent[other] = root;
        movie[root] = movie[root] || movie[other];
      }
    });
  });
  return keys.map((ks, i) => (ks.length ? find(i) : -1));
}

function leadOf(members: Torrent[]): Torrent {
  // the release played last here, finished or not; else the one being watched on the TV; else the newest
  const played = members.reduce((a, b) => (lastPlayedAt(b.hash) > lastPlayedAt(a.hash) ? b : a), members[0]);
  if (lastPlayedAt(played.hash) > 0) return played;
  const recent = continueWatching(members, 1000)[0];
  if (recent) return recent.torrent;
  return members.reduce((a, b) => ((b.timestamp || 0) > (a.timestamp || 0) ? b : a), members[0]);
}

function makeFilm(members: Torrent[]): FilmGroup {
  const ks = keysOf(members[0]);
  return { kind: 'film', key: ks.length ? ks[ks.length - 1] : members[0].hash, members, lead: leadOf(members) };
}

/**
 * The phone's «Мои» cards: series grouped as on the TV, then the releases of one film made one card at the place of
 * the first of them. With a query a film is kept whole when one of its releases matches.
 */
export function groupPhoneLibrary(list: Torrent[], query = ''): PhoneItem[] {
  const items = groupLibrary(list, query);
  const owners = filmOwners(list);
  const byOwner: { [o: number]: Torrent[] } = {};
  list.forEach((tor, i) => {
    const o = owners[i];
    if (o >= 0) (byOwner[o] = byOwner[o] || []).push(tor);
  });
  const done: { [o: number]: boolean } = {};
  const out: PhoneItem[] = [];
  items.forEach((it) => {
    if (it.kind !== 'torrent') {
      out.push(it);
      return;
    }
    const i = list.indexOf(it.tor);
    const o = i >= 0 ? owners[i] : -1;
    const members = o >= 0 ? byOwner[o] : null;
    if (!members || members.length < 2) {
      out.push(it);
      return;
    }
    if (done[o]) return;
    done[o] = true;
    out.push(makeFilm(members));
  });
  return out;
}

/** Every release of the film `tor` is, itself included, in list order; [] for a series or a film that is not matched. */
export function filmReleases(list: Torrent[], tor: Torrent): Torrent[] {
  const owners = filmOwners(list);
  const i = list.findIndex((x) => x.hash === tor.hash);
  if (i < 0 || owners[i] < 0) return [];
  return list.filter((_, k) => owners[k] === owners[i]);
}

/** Every torrent hash of the cards. */
export function phoneItemHashes(items: PhoneItem[]): string[] {
  const out: string[] = [];
  items.forEach((it) => {
    if (it.kind === 'torrent') out.push(it.tor.hash);
    else it.members.forEach((m) => out.push(m.hash));
  });
  return out;
}

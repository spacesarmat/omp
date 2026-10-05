// «Мои»: the torrents of one series (its seasons, or several releases) shown as one card. The key is the series name
// (the first title variant, normalized) of a torrent in the «Сериалы» category, or guessed as one; films never group.
import type { Torrent } from '../../../src/api/types';
import { seriesNames } from '../../../src/monitor/newEpisodes';
import { parseEpisodeRange } from '../../../src/monitor/episodes';
import { guessCategory } from '../../../src/lib/categoryGuess';
import { displayTitle } from '../../../src/lib/torrentName';
import { parseEpisode, playableFiles } from '../../../src/lib/episodes';
import { filterTorrents } from '../../../src/lib/librarySearch';
import { tp } from '../../../src/i18n';
import { filesOf } from '../watch';

/** Season 0: the torrent says nothing about its season. */
export const NO_SEASON = 0;

export interface SeriesGroup {
  kind: 'series';
  key: string;
  /** In the order of the list they came from. */
  members: Torrent[];
  /** Every season the members cover, ascending (0 when one of them has none). */
  seasons: number[];
  /** The newest season's torrent: its poster and its title stand for the group. */
  lead: Torrent;
}

export interface SingleItem {
  kind: 'torrent';
  tor: Torrent;
}

export type LibraryItem = SingleItem | SeriesGroup;

/** A series by its category, or by its title when the category is not set. */
export function isSeries(tor: Torrent): boolean {
  if (tor.category === 'tv') return true;
  if (tor.category === 'movie' || tor.category === 'music') return false;
  return guessCategory(displayTitle(tor)) === 'tv';
}

/** The grouping key of a series torrent; '' for a film or a title with no name. */
export function seriesKey(tor: Torrent): string {
  if (!isSeries(tor)) return '';
  // seriesNames are lowercased with the yo letter read as e (normalizeTitle)
  const names = seriesNames(displayTitle(tor));
  return names.length ? names[0] : '';
}

/** The seasons of one torrent: from its title («Сезоны 1-3», «S02»), else from its files; [] when unknown. */
export function seasonsOf(tor: Torrent): number[] {
  const r = parseEpisodeRange(displayTitle(tor));
  if (r.season !== undefined) {
    const out: number[] = [];
    const to = r.seasonTo !== undefined && r.seasonTo >= r.season ? r.seasonTo : r.season;
    for (let s = r.season; s <= to && out.length < 100; s++) out.push(s);
    return out;
  }
  const out: number[] = [];
  playableFiles(filesOf(tor)).forEach((f) => {
    const s = parseEpisode(f.path).season;
    if (s !== null && out.indexOf(s) < 0) out.push(s);
  });
  return out.sort((a, b) => a - b);
}

function seasonKeys(tor: Torrent): number[] {
  const s = seasonsOf(tor);
  return s.length ? s : [NO_SEASON];
}

function lastSeason(tor: Torrent): number {
  const s = seasonsOf(tor);
  return s.length ? s[s.length - 1] : NO_SEASON;
}

function makeGroup(key: string, members: Torrent[]): SeriesGroup {
  const seasons: number[] = [];
  let lead = members[0];
  members.forEach((m) => {
    seasonKeys(m).forEach((s) => {
      if (seasons.indexOf(s) < 0) seasons.push(s);
    });
    const a = lastSeason(m);
    const b = lastSeason(lead);
    if (a > b || (a === b && (m.timestamp || 0) > (lead.timestamp || 0))) lead = m;
  });
  seasons.sort((a, b) => a - b);
  return { kind: 'series', key, members, seasons, lead };
}

/**
 * The list as cards: torrents of the same series become one group at the place of the first of them; a series with
 * one torrent stays a plain card. With a query a group is kept (whole) when one of its torrents matches.
 */
export function groupLibrary(list: Torrent[], query = ''): LibraryItem[] {
  const byKey: { [k: string]: Torrent[] } = {};
  const keys: string[] = [];
  list.forEach((tor) => {
    const k = seriesKey(tor);
    keys.push(k);
    if (!k) return;
    (byKey[k] = byKey[k] || []).push(tor);
  });
  const matching = query.trim() ? filterTorrents(list, query) : list;
  const done: { [k: string]: boolean } = {};
  const out: LibraryItem[] = [];
  list.forEach((tor, i) => {
    const k = keys[i];
    const members = k ? byKey[k] : null;
    if (!members || members.length < 2) {
      if (matching.indexOf(tor) >= 0) out.push({ kind: 'torrent', tor });
      return;
    }
    if (done[k]) return;
    if (!members.some((m) => matching.indexOf(m) >= 0)) return;
    done[k] = true;
    out.push(makeGroup(k, members));
  });
  return out;
}

/** The group of `key` in the whole library (the series screen); null when fewer than one torrent is left. */
export function findGroup(list: Torrent[], key: string): SeriesGroup | null {
  const members = list.filter((x) => seriesKey(x) === key);
  return members.length ? makeGroup(key, members) : null;
}

/** The torrents of one season (a pack of seasons is listed under each of them). */
export function seasonMembers(g: SeriesGroup, season: number): Torrent[] {
  return g.members.filter((m) => seasonKeys(m).indexOf(season) >= 0);
}

/** Every torrent hash of the cards. */
export function itemHashes(items: LibraryItem[]): string[] {
  const out: string[] = [];
  items.forEach((it) => {
    if (it.kind === 'torrent') out.push(it.tor.hash);
    else it.members.forEach((m) => out.push(m.hash));
  });
  return out;
}

/** «2 сезона»; several releases of one season: «3 раздачи». */
export function groupLabel(g: SeriesGroup): string {
  const known = g.seasons.filter((s) => s !== NO_SEASON).length;
  return known >= 2 ? tp('series.seasons', known) : tp('series.releases', g.members.length);
}

/** The total size of the group's torrents. */
export function groupSize(g: SeriesGroup): number {
  return g.members.reduce((n, m) => n + (m.torrent_size || 0), 0);
}

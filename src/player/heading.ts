// The player's title bar: «Series name · S02E01 · Episode name» (the TMDB name once known) or the film's name, from the
// library torrent the item plays; never the file name or the raw tracker title.
import type { Torrent } from '../api/types';
import type { PlayItem } from './types';
import { torrents } from '../store/library';
import { libraryTitle } from '../lib/libraryView';
import { baseName, stripExt, type EpisodeInfo } from '../lib/episodes';
import { cleanFileName } from '../lib/episodeNames';
import { useEffect } from 'preact/hooks';
import { episodeCode, episodeOf, filePathOf, playerHeading, seriesGroupOf, torrentName } from '../lib/cleanNames';
import { requestSeriesMatch, seriesMatchVersion } from '../lib/seriesMatch';
import { useEpisodeName } from '../lib/useEpisodeName';

export interface ItemNames {
  /** The library torrent the item plays, when it is in the library. */
  tor?: Torrent;
  /** The series or film name. */
  name: string;
  /** The episode of the file (episode null for a film). */
  ep: EpisodeInfo;
}

/** The clean names of a queue item, at once (no TMDB episode name). */
export function itemNames(item: PlayItem, list: Torrent[]): ItemNames {
  const h = (item.hash || '').toLowerCase();
  const tor = h ? list.filter((x) => x.hash.toLowerCase() === h)[0] : undefined;
  const path = filePathOf(tor, null, item.fileIndex) || item.title;
  const ep = episodeOf(path, tor ? tor.title : item.torrentTitle);
  let name = '';
  if (tor) name = torrentName(tor, list);
  else if (item.torrentTitle) name = libraryTitle({ hash: item.hash || '', title: item.torrentTitle }).title;
  else name = ep.episode === null ? item.title : cleanFileName(stripExt(baseName(item.title)));
  return { tor: tor, name: name, ep: ep };
}

/** The heading of an item without the TMDB episode name: «Name · S02E01», a film's name. */
export function itemHeading(item: PlayItem, list: Torrent[] = torrents.peek()): string {
  const n = itemNames(item, list);
  return playerHeading(n.name, episodeCode(n.ep), '');
}

/** The heading of what plays, with the TMDB episode name once it arrives. */
export function usePlayerHeading(item: PlayItem | undefined): string {
  const list = torrents.value;
  void seriesMatchVersion.value; // the series' TMDB name, once matched
  const n = item ? itemNames(item, list) : null;
  const g = n && n.tor ? seriesGroupOf(n.tor, list) : null;
  useEffect(() => {
    if (g) requestSeriesMatch(g);
  }, [g ? g.key : '']);
  const epName = useEpisodeName(n ? n.tor : undefined, n ? n.ep : { season: null, episode: null });
  return n ? playerHeading(n.name, episodeCode(n.ep), epName) : '';
}

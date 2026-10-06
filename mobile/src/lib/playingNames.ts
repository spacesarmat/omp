// Clean names of what plays: the series or film name (TMDB's once the series is matched, else the short title of the
// torrent) and the episode line «S02E01 · Спокойная жизнь» (the code and the real TMDB name, if any). Never a file
// name or a raw tracker title. Used by «Сейчас на ТВ» and by the «Откуда смотреть?» sheet.
import { useEffect, useState } from 'preact/hooks';
import type { Torrent } from '../../../src/api/types';
import type { PlayerState } from '../../../src/phone/protocol';
import { displayTitle } from '../ui/displayTitle';
import { episodeLabel, parseEpisode } from '../../../src/lib/episodes';
import { libraryTitle } from '../../../src/lib/libraryView';
import { parseTorrentData } from '../../../src/api/torrserver';
import { groupLibrary, singleGroup } from '../../../src/lib/seriesGroups';
import { cachedSeriesMatch, seriesMatchVersion } from '../../../src/lib/seriesMatch';
import { realEpisodeName, seasonEpisodes, showOf } from '../../../src/lib/episodeNames';
import { torrents } from '../../../src/store/library';

const FILE_EXT = /\.(mkv|mp4|avi|mov|m4v|ts|webm|wmv|flv|mpg|mpeg|m2ts)$/i;

/** The library torrent with that hash (any case); undefined when it is not in «Мои». */
export function libraryTorrent(hash: string, list: Torrent[] = torrents.peek()): Torrent | undefined {
  const h = (hash || '').toLowerCase();
  return h ? list.filter((x) => x.hash.toLowerCase() === h)[0] : undefined;
}

/** The series key the tiles match TMDB with: the group's in «Мои», else the lone torrent's; '' for a film. */
function seriesKeyOf(tor: Torrent, list: Torrent[]): string {
  const items = groupLibrary(list);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'series' && it.members.some((m) => m.hash === tor.hash)) return it.key;
  }
  const g = singleGroup(tor);
  return g ? g.key : '';
}

/** The name of a torrent: the TMDB show's once matched, else the short title («Тёмная материя»). */
export function torrentName(tor: Torrent, list: Torrent[] = torrents.peek()): string {
  const key = seriesKeyOf(tor, list);
  const card = key ? cachedSeriesMatch(key) : null;
  return card && card.title ? card.title : libraryTitle(tor).title;
}

/** The path of a file of the torrent; '' when the list has no such file. */
export function filePath(tor: Torrent | undefined, file: number | undefined): string {
  if (!tor || file === undefined) return '';
  const files = tor.file_stats && tor.file_stats.length ? tor.file_stats : parseTorrentData(tor.data);
  const f = files.filter((x) => x.id === file)[0];
  return f ? f.path : '';
}

/** A title that reads as a name: not a file name, no «S02E01» in it. */
export function looksLikeName(title: string): boolean {
  const s = (title || '').trim();
  return !!s && !FILE_EXT.test(s) && !episodeLabel(s) && !/\b(1080p|2160p|720p|WEB-?DL|BDRip|HDTV)\b/i.test(s);
}

/** «S02E01 · Спокойная жизнь», «S02E01» without a real name. */
export function episodeLine(code: string, name: string): string {
  return [code, realEpisodeName(name)].filter(Boolean).join(' · ');
}

/** The real TMDB name of the episode at `path` of the torrent; '' when unknown or TMDB is out of reach. */
export function episodeNameOf(tor: Torrent, path: string): Promise<string> {
  const pe = parseEpisode(path);
  if (pe.episode === null || pe.season === null) return Promise.resolve('');
  const season = pe.season;
  const ep = pe.episode;
  return showOf(tor)
    .then((show) => (show ? seasonEpisodes(show, season) : {}))
    .then(
      (m: { [n: number]: { title: string } }) => (m[ep] ? realEpisodeName(m[ep].title) : ''),
      () => '',
    );
}

/**
 * The label of a launch for the «Откуда смотреть?» sheet, at once: «S02E01» for an episode, the name for a film,
 * the fallback when the torrent is not in «Мои»; named() then gets «S02E01 · Спокойная жизнь» if TMDB knows the name.
 */
export function launchLabel(hash: string, file: number | undefined, fallback: string, named?: (label: string) => void): string {
  const tor = libraryTorrent(hash);
  if (!tor) return fallback;
  const path = filePath(tor, file);
  const code = path ? episodeLabel(path) : '';
  if (!code) return torrentName(tor);
  if (named) {
    episodeNameOf(tor, path).then((name) => {
      if (name) named(episodeLine(code, name));
    });
  }
  return code;
}

/** The episode code the TV puts last in the subtitle («… · S02E03»); '' when there is none. */
export function subtitleCode(subtitle: string): string {
  const i = subtitle.lastIndexOf(' · ');
  return i >= 0 ? subtitle.slice(i + 3) : '';
}

/**
 * The clean names of what plays: the series or film name, and for an episode «S02E01 · Спокойная жизнь». From the
 * library torrent when it is in «Мои» (TMDB's names once known), else from what the TV sent, raw tracker titles and
 * file names cut down to the short name and the episode code.
 */
export function usePlayingNames(s: PlayerState | null): { title: string; sub: string } {
  void torrents.value;
  void seriesMatchVersion.value;
  const hash = s ? s.hash : '';
  const file = s ? s.file : undefined;
  const tor = s ? libraryTorrent(hash) : undefined;
  const path = filePath(tor, file);
  const [tmdbName, setTmdbName] = useState<{ key: string; name: string }>({ key: '', name: '' });
  const key = hash + ':' + file + ':' + path;
  useEffect(() => {
    if (!tor || !path) return;
    let alive = true;
    episodeNameOf(tor, path).then((name) => {
      if (alive) setTmdbName({ key: key, name: name });
    });
    return () => {
      alive = false;
    };
  }, [key]);
  if (!s) return { title: '', sub: '' };
  const fromTv = subtitleCode(s.subtitle);
  // the TV's subtitle is «torrent title · S02E01»: the torrent title without the code
  const tvCode = /^(S\d+)?E\d+$/.test(fromTv) ? fromTv : '';
  const code = (path ? episodeLabel(path) : '') || episodeLabel(s.title) || tvCode;
  const raw = tvCode ? s.subtitle.slice(0, s.subtitle.length - tvCode.length - 3) : s.subtitle;
  const title = tor ? torrentName(tor) : (raw && libraryTitle({ hash: hash, title: raw }).title) || displayTitle(s.title);
  if (!code) return { title: title, sub: '' };
  const known = tmdbName.key === key ? tmdbName.name : '';
  return { title: title, sub: episodeLine(code, known || (looksLikeName(s.title) ? s.title : '')) };
}


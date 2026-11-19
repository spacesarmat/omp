// Clean names of what plays: the series or film name (TMDB's once the series is matched, else the short title of the
// torrent) and the episode line «S02E01 · Спокойная жизнь» (the code and the real TMDB name, if any). Never a file
// name or a raw tracker title. Used by «Сейчас на ТВ» and by the «Откуда смотреть?» sheet.
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import type { Torrent } from '../../../src/api/types';
import type { PlayerState } from '../../../src/phone/protocol';
import { displayTitle } from '../ui/displayTitle';
import { episodeLabel, parseEpisode, playableFiles, spansSeasons } from '../../../src/lib/episodes';
import { libraryTitle } from '../../../src/lib/libraryView';
import { parseTorrentData } from '../../../src/api/torrserver';
import { seriesMatchVersion } from '../../../src/lib/seriesMatch';
import { torrentName as cleanTorrentName } from '../../../src/lib/cleanNames';
import { realEpisodeName, rememberEpisodeName, seasonEpisodes, showForTorrent } from '../../../src/lib/episodeNames';
import { torrents } from '../../../src/store/library';

const httpPoster = (u: string | undefined) => (/^https?:\/\//i.test(u || '') ? String(u) : '');

const FILE_EXT = /\.(mkv|mp4|avi|mov|m4v|ts|webm|wmv|flv|mpg|mpeg|m2ts)$/i;

/** The library torrent with that hash (any case); undefined when it is not in «Мои». */
export function libraryTorrent(hash: string, list: Torrent[] = torrents.peek()): Torrent | undefined {
  const h = (hash || '').toLowerCase();
  return h ? list.filter((x) => x.hash.toLowerCase() === h)[0] : undefined;
}

/** The name of a torrent: the TMDB show's once matched, else the short title («Тёмная материя»); the TV's rule. */
export function torrentName(tor: Torrent, list: Torrent[] = torrents.peek()): string {
  return cleanTorrentName(tor, list);
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

/** A file name with the quality tags taken out. A number in parentheses stays, so two files stay distinct. */
export function readableFileLabel(name: string): string {
  const cleaned = (name || '')
    .replace(/\b(?:\d{3,4}p|4k|uhd|web-?dl|bdrip|hdtv)\b/gi, ' ')
    .replace(/\[([^[\]]*)\]|\(([^()]*)\)/g, (all, bracket, paren) => {
      const inner = String(bracket ?? paren ?? '').replace(/[\s._,\-+/]+/g, '');
      return inner ? all : ' ';
    })
    .replace(/[._]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || (name || '').trim();
}

/** The next-episode card. A rejected file name is not a title: only a real name or the episode code. */
export function nextCardTitle(raw: string, tmdbName = ''): string {
  const s = (raw || '').trim();
  const code = episodeLabel(s);
  if (code) {
    if (tmdbName) return episodeLine(code, tmdbName);
    const rest = s.replace(new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').replace(/^[\s.·-]+|[\s.·-]+$/g, '');
    return episodeLine(code, looksLikeName(rest) ? rest : '');
  }
  return looksLikeName(s) ? s : readableFileLabel(s);
}

/**
 * «1 серия · Спокойная жизнь». The season is added only when the release has more than one
 * (`withSeason`), so a single-season pack stays short. A code that is not SxxEyy is kept as written.
 */

export function episodeLine(code: string, name: string, withSeason = false): string {
  const human = humanEpisodeCode(code, withSeason);
  return [human || code, realEpisodeName(name)].filter(Boolean).join(' · ');
}

/** «1 серия», or «2 сезон · 1 серия» when the season is needed. '' when `code` is not SxxEyy. */
export function humanEpisodeCode(code: string, withSeason: boolean): string {
  const m = /^S(\d+)E(\d+)$/i.exec((code || '').trim());
  if (!m) return '';
  const episode = String(parseInt(m[2], 10));
  const head = t('library.episodeNamed', { n: episode });
  if (!withSeason) return head;
  return t('library.seasonNamed', { n: String(parseInt(m[1], 10)) }) + ' · ' + head;
}

/** The real TMDB name of the episode at `path` of the torrent; '' when unknown or TMDB is out of reach. */
export function episodeNameOf(tor: Torrent, path: string): Promise<string> {
  const pe = parseEpisode(path);
  if (pe.episode === null || pe.season === null) return Promise.resolve('');
  const season = pe.season;
  const ep = pe.episode;
  return showForTorrent(tor)
    .then((show) => (show ? seasonEpisodes(show, season) : {}))
    .then(
      (m: { [n: number]: { title: string } }) => {
        const name = m[ep] ? realEpisodeName(m[ep].title) : '';
        if (name) rememberEpisodeName(tor.hash, season, ep, name);
        return name;
      },
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
  const withSeason = spansSeasons(filesOfTorrent(tor));
  if (named) {
    episodeNameOf(tor, path).then((name) => {
      if (name) named(episodeLine(code, name, withSeason));
    });
  }
  return episodeLine(code, '', withSeason);
}

function filesOfTorrent(tor: Torrent): string[] {
  const files = tor.file_stats && tor.file_stats.length ? tor.file_stats : parseTorrentData(tor.data);
  return files.map((f) => f.path);
}

/** A TMDB title the TV put after the code («… · S04E01 · Что тебя не убивает»); '' when the last part is just the code. */
export function subtitleEpisodeName(subtitle: string): string {
  const bits = (subtitle || '').split(' · ');
  if (bits.length < 2) return '';
  const last = bits[bits.length - 1].trim();
  const prev = bits[bits.length - 2].trim();
  if (!/^(?:S\d+)?E\d+$/i.test(prev)) return '';
  return realEpisodeName(last);
}

/** The episode code the TV puts last in the subtitle («… · S02E03»); '' when there is none. */
export function subtitleCode(subtitle: string): string {
  const i = subtitle.lastIndexOf(' · ');
  return i >= 0 ? subtitle.slice(i + 3) : '';
}

/**
 * Poster for «Сейчас играет»: season → show → library torrent → what the TV sent.
 * Prefer the phone's match so a wrong tracker art on the TV does not win.
 */
export function usePlayingPoster(s: PlayerState | null): string {
  void torrents.value;
  void seriesMatchVersion.value;
  const hash = s ? s.hash : '';
  const file = s ? s.file : undefined;
  const tor = s ? libraryTorrent(hash) : undefined;
  const path = filePath(tor, file);
  const [art, setArt] = useState<{ key: string; url: string }>({ key: '', url: '' });
  const key = hash + ':' + file + ':' + path;
  useEffect(() => {
    if (!tor) {
      setArt({ key: key, url: '' });
      return;
    }
    let alive = true;
    const pe = path ? parseEpisode(path) : { season: null as number | null };
    showForTorrent(tor).then(
      (show) => {
        if (!alive) return;
        const season =
          show && pe.season !== null && show.seasonPosters[pe.season] ? show.seasonPosters[pe.season] : '';
        const url = httpPoster(season) || httpPoster(show ? show.poster : '') || httpPoster(tor.poster);
        setArt({ key: key, url: url });
      },
      () => {
        if (alive) setArt({ key: key, url: httpPoster(tor.poster) });
      },
    );
    return () => {
      alive = false;
    };
  }, [key]);
  if (!s) return '';
  const known = art.key === key ? art.url : '';
  return known || httpPoster(tor && tor.poster) || httpPoster(s.poster);
}

/**
 * The clean names of what plays: the series or film name, and for an episode «S02E01 · Спокойная жизнь». From the
 * library torrent when it is in «Мои» (TMDB's names once known), else from what the TV sent, raw tracker titles and
 * file names cut down to the short name and the episode code.
 */
/** The next video the player will open, skipping subtitles and other files that do not play. */
export function nextPlayablePath(tor: Torrent | undefined, file: number | undefined): string {
  if (!tor || file === undefined) return '';
  const all = tor.file_stats && tor.file_stats.length ? tor.file_stats : parseTorrentData(tor.data);
  const files = playableFiles(all);
  const i = files.findIndex((f) => f.id === file);
  return i >= 0 && files[i + 1] ? files[i + 1].path : '';
}

/** The next episode: TMDB name of the following file when the release is in the library, else a cleaned TV title. */
export function useNextEpisodeTitle(s: PlayerState | null): string {
  void torrents.value;
  const tor = s ? libraryTorrent(s.hash) : undefined;
  const path = nextPlayablePath(tor, s ? s.file : undefined);
  const [tmdb, setTmdb] = useState<{ key: string; name: string }>({ key: '', name: '' });
  const key = (tor ? tor.hash : '') + ':' + path;
  useEffect(() => {
    if (!tor || !path) return;
    let alive = true;
    episodeNameOf(tor, path).then((name) => {
      if (alive) setTmdb({ key, name });
    });
    return () => {
      alive = false;
    };
  }, [key]);
  if (!s || !s.next) return '';
  const code = path ? episodeLabel(path) : '';
  if (code) {
    const known = tmdb.key === key ? tmdb.name : '';
    return episodeLine(code, known, tor ? spansSeasons(filesOfTorrent(tor)) : false);
  }
  return nextCardTitle(s.next.title);
}

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
  const hinted = subtitleEpisodeName(s.subtitle);
  const withSeason = tor ? spansSeasons(filesOfTorrent(tor)) : false;
  return { title: title, sub: episodeLine(code, known || hinted || (looksLikeName(s.title) ? s.title : ''), withSeason) };
}


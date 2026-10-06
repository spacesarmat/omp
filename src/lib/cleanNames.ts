// Clean names for the TV, the same ones the phone shows: a torrent is named by its TMDB show once the series is matched
// (in the UI language), else by the short title of the torrent; an episode by «Season 2 · Episode 1» and its real TMDB
// name; what plays by «Name · S02E01 · Episode name». Never a file name or a raw tracker title.
import type { Torrent } from '../api/types';
import { t } from '../i18n';
import { baseName, parseEpisode, playableFiles, stripExt, type EpisodeInfo, type TorrentFile } from './episodes';
import { libraryTitle } from './libraryView';
import { groupLibrary, singleGroup, type SeriesGroup } from './seriesGroups';
import { cachedSeriesMatch } from './seriesMatch';
import { realEpisodeName, seasonEpisodes, showOf } from './episodeNames';
import { torrentFiles } from './torrentName';
import { parseEpisodeRange } from '../monitor/episodes';

// the groups of the last list asked about: one grouping per list, not one per tile
let lastList: Torrent[] | null = null;
let lastGroups: { [hash: string]: SeriesGroup } = {};

/** The series a torrent belongs to: its group in the library, else the lone torrent as a group; null for a film. */
export function seriesGroupOf(tor: Torrent, list: Torrent[]): SeriesGroup | null {
  if (list !== lastList) {
    lastList = list;
    lastGroups = {};
    groupLibrary(list).forEach((it) => {
      if (it.kind === 'series') it.members.forEach((m) => (lastGroups[m.hash] = it));
    });
  }
  return lastGroups[tor.hash] || singleGroup(tor);
}

/** The name of a series card: the matched TMDB show's in the UI language, else the short title of its named torrent. */
export function seriesName(g: SeriesGroup): string {
  const card = cachedSeriesMatch(g.key);
  return card && card.title ? card.title : libraryTitle(g.named).title;
}

/** The name of a torrent: the matched TMDB show's (as the series screen and the phone show it), else the short title. */
export function torrentName(tor: Torrent, list: Torrent[]): string {
  const g = seriesGroupOf(tor, list);
  const card = g ? cachedSeriesMatch(g.key) : null;
  return card && card.title ? card.title : libraryTitle(tor).title;
}

// anime-style numbers the episode parser leaves alone: «Name - 01 RAW», «Name_[11]_[HEVC]»
const DASH_NUMBER = /\s-\s(\d{1,3})(?:v\d)?(?=[\s.[(]|$)/;
const BRACKET_NUMBER = /[[(](\d{1,3})(?:v\d)?[\])]/;

/**
 * The season and episode of a file, for display: the file name's, else an anime-style number in it; the season from
 * the folder, else from the torrent title when it names one season.
 */
export function episodeOf(path: string, title?: string): EpisodeInfo {
  const pe = parseEpisode(path);
  let episode = pe.episode;
  if (episode === null) {
    const name = stripExt(baseName(path));
    const m = DASH_NUMBER.exec(name) || BRACKET_NUMBER.exec(name);
    if (m) episode = +m[1];
  }
  let season = pe.season;
  if (season === null && episode !== null && title) {
    const r = parseEpisodeRange(title);
    if (r.season !== undefined && (r.seasonTo === undefined || r.seasonTo === r.season)) season = r.season;
  }
  return { season: season, episode: episode };
}

/** One playable file: a film (a lone file with no episode number, or the film category). */
export function isFilmFile(tor: Torrent, path: string): boolean {
  if (episodeOf(path, tor.title).episode !== null) return false;
  if (tor.category === 'movie') return true;
  return playableFiles(torrentFiles(tor)).length <= 1;
}

/**
 * The line under a name in «History»: «Season 2 · Episode 1 · Name» (the season when known, the TMDB name when known),
 * «Film» for a film; '' when the file has no episode number. Never the file name.
 */
export function episodeSubLine(e: EpisodeInfo, name: string, film: boolean): string {
  if (e.episode === null) return film ? t('library.movie') : '';
  const parts: string[] = [];
  if (e.season !== null) parts.push(t('library.season', { n: e.season }));
  parts.push(t('library.episode', { n: e.episode }));
  const real = realEpisodeName(name);
  if (real) parts.push(real);
  return parts.join(' · ');
}

/** «S02E01», «E11» (no season known), '' for no episode. */
export function episodeCode(e: EpisodeInfo): string {
  if (e.episode === null) return '';
  const pad = (n: number) => (n < 10 ? '0' : '') + n;
  return (e.season !== null ? 'S' + pad(e.season) : '') + 'E' + pad(e.episode);
}

/** The player's heading: «Name · S02E01 · Episode name»; a film is its name alone. */
export function playerHeading(name: string, code: string, episodeName: string): string {
  const parts: string[] = [];
  [name, code, code ? realEpisodeName(episodeName) : ''].forEach((p) => {
    if (p && parts.indexOf(p) < 0) parts.push(p);
  });
  return parts.join(' · ');
}

// the TMDB lookups for episode names run 2 at a time: a history of 40 cards must not fire 40 searches at once
const MAX_LOOKUPS = 2;
let running = 0;
const queue: (() => void)[] = [];

function limited<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      running++;
      job().then(
        (v) => {
          running--;
          next();
          resolve(v);
        },
        (e) => {
          running--;
          next();
          reject(e);
        },
      );
    };
    const next = () => {
      const j = queue.shift();
      if (j) j();
    };
    if (running < MAX_LOOKUPS) run();
    else queue.push(run);
  });
}

/** The real TMDB name of an episode of the torrent's show; '' when unknown, a film or TMDB is out of reach. */
export function episodeNameOf(tor: Torrent, e: EpisodeInfo): Promise<string> {
  if (e.episode === null || e.season === null) return Promise.resolve('');
  const season = e.season;
  const ep = e.episode;
  return limited(() => showOf(tor).then((show) => (show ? seasonEpisodes(show, season) : {}))).then(
    (m: { [n: number]: { title: string } }) => (m[ep] ? realEpisodeName(m[ep].title) : ''),
    () => '',
  );
}

/** The path of a file of the torrent; '' when it has no such file. */
export function filePathOf(tor: Torrent | undefined, files: TorrentFile[] | null, id: number | undefined): string {
  if (!tor || id === undefined) return '';
  const list = files && files.length ? files : torrentFiles(tor);
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i].path;
  return '';
}

/** Tests: forget the cached grouping and the lookup queue. */
export function resetCleanNames(): void {
  lastList = null;
  lastGroups = {};
  queue.length = 0;
  running = 0;
}

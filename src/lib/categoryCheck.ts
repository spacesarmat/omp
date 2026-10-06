// Automatic category check: the category a release really has, from its title and files, and the fix of a clear
// contradiction («Фильмы» with 18 episode files → «Сериалы», an album filed as a film → «Музыка»). A category the
// user picked by hand (omp.cm) or anyone else set is never changed: only an empty category or OMP's own (omp.ca) is.
// Each torrent is looked at once per app session once its files are known. Chromium 53 safe.
import type { Torrent } from '../api/types';
import { parseTorrentData } from '../api/torrserver';
import { parseEpisodeRange } from '../monitor/episodes';
import { baseName, fileKind, parseEpisode, type TorrentFile } from './episodes';
import { categoryAuto, categoryPicked } from './journal';
import { loadJson, saveJson, isObject } from '../store/storage';
import { displayTitle, isPlaceholderTitle } from './torrentName';
import { shortTitle } from './libraryView';
import { addCategoryLabel, type AddCategory } from './categoryGuess';
import { log } from './log';
import { t } from '../i18n';

const MUSIC_EXT = /\.(mp3|flac|m4a|ogg|opus|wav|ape)$/i;
const BRACKET_NUM = /\[(\d{1,3})\]/;
/** «Show - 07 [1080p].mkv», the usual anime naming. */
const DASH_NUM = /\s-\s(\d{1,3})(?:v\d)?(?=[\s.\[(]|$)/;
/** One video of at least this share of the size is the film (the rest: extras, samples). */
const MAIN_SHARE = 0.7;
/** Episode files are of comparable size: at least this share of the median video. */
const EPISODE_SHARE = 0.3;
/** Files that make a «Фильмы» torrent a series. */
export const MIN_EPISODE_FILES = 3;

function sizeOf(f: TorrentFile): number {
  return typeof f.length === 'number' && f.length > 0 ? f.length : 0;
}

/** «S01E01-E02», «S01E01-02». */
const SE_RANGE = /s(\d{1,2})[ ._-]?e(\d{1,3})[ ._]?-[ ._]?e?(\d{1,3})(?![0-9])/i;
/** «E01-E02», «EP 1-2», «ep01-02». */
const E_RANGE = /(?:^|[^a-z])(?:ep?|episode)[ ._]?(\d{1,3})[ ._]?-[ ._]?(?:ep?)?[ ._]?(\d{1,3})(?![0-9])/i;
/** «1-2 серия», «01-02 серии». */
const WORD_RANGE = /(?:^|[^0-9])(\d{1,3})[ ._]?-[ ._]?(\d{1,3})[ ._]*(?:серия|серии|серий)/i;
/** «[01-02]», «- 01-02 [». */
const BRACKET_RANGE = /(?:\[|\s-\s)(\d{1,3})-(\d{1,3})(?=[\]\s.\[(]|$)/;
/** «5 серия». */
const WORD_ONE = /(?:^|[^0-9-])(\d{1,3})[ ._]*серия/i;
/** Bracketed numbers that are picture heights, not episodes. */
const NOT_EPISODE = [480, 576, 720];
/** A range in one file holds at most this many episodes (a wider one is something else). */
const MAX_IN_FILE = 6;

function span(from: number, to: number): number[] | null {
  if (!(to > from) || to - from + 1 > MAX_IN_FILE) return null;
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

/**
 * The episodes a file name holds: one («S01E05», «EP05», «5 серия», «[05]», «- 05») or a range in one file («1-2 серия»,
 * «S01E01-E02», «E01-E02», «[01-02]»); null when none.
 */
export function fileEpisodes(path: string): { season: number | null; episodes: number[] } | null {
  const name = baseName(path);
  let m = SE_RANGE.exec(name);
  if (m) {
    const eps = span(+m[2], +m[3]);
    if (eps) return { season: +m[1], episodes: eps };
  }
  const ranges = [E_RANGE, WORD_RANGE, BRACKET_RANGE];
  for (let i = 0; i < ranges.length; i++) {
    m = ranges[i].exec(name);
    const eps = m ? span(+m[1], +m[2]) : null;
    if (eps) return { season: parseEpisode(path).season, episodes: eps };
  }
  const e = parseEpisode(path);
  if (e.episode !== null) return { season: e.season, episodes: [e.episode] };
  m = WORD_ONE.exec(name);
  if (m) return { season: null, episodes: [+m[1]] };
  m = BRACKET_NUM.exec(name) || DASH_NUM.exec(name);
  if (m && NOT_EPISODE.indexOf(+m[1]) < 0) return { season: null, episodes: [+m[1]] };
  return null;
}

/** The (first) episode a file name holds; null when none. */
export function fileEpisode(path: string): { season: number | null; episode: number } | null {
  const e = fileEpisodes(path);
  return e ? { season: e.season, episode: e.episodes[0] } : null;
}

/** One video holds at least 70% of the size: a film (with extras), never a set of episodes. */
export function hasMainVideo(files: TorrentFile[]): boolean {
  const total = files.reduce((n, f) => n + sizeOf(f), 0);
  if (!total) return false;
  const main = files.filter((f) => fileKind(f.path) === 'video').reduce((m, f) => Math.max(m, sizeOf(f)), 0);
  return main / total >= MAIN_SHARE;
}

/** Video files of comparable size (at least 30% of the median) with distinct episode numbers. */
export function episodeFileCount(files: TorrentFile[]): number {
  const videos = files.filter((f) => fileKind(f.path) === 'video');
  if (!videos.length) return 0;
  const sizes = videos.map(sizeOf).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)];
  const seen: string[] = [];
  videos.forEach((f) => {
    if (median > 0 && sizeOf(f) < median * EPISODE_SHARE) return;
    const e = fileEpisodes(f.path);
    if (!e) return;
    e.episodes.forEach((n) => {
      const k = (e.season === null ? 0 : e.season) + ':' + n;
      if (seen.indexOf(k) < 0) seen.push(k);
    });
  });
  return seen.length;
}

/** The files clearly hold episodes: 3+ episode files of comparable size and no main video. */
export function filesHaveEpisodes(files: TorrentFile[]): boolean {
  return !hasMainVideo(files) && episodeFileCount(files) >= MIN_EPISODE_FILES;
}

/**
 * The title marks episodes: S/E marks («S02E05», «S1E1-18») or a range of several («E01-E18», «серии 1-18»). A bare
 * season number («Сезон охоты 2») is not enough.
 */
export function titleHasEpisodes(title: string): boolean {
  const r = parseEpisodeRange(title);
  if (r.to === undefined || r.from === undefined) return false;
  return r.season !== undefined || r.to - r.from >= 3;
}

/**
 * The category the files clearly say, or null when they say nothing sure: mostly audio (80%+ of the size) → music;
 * one main video → movie (numbered extras or a concert's numbered parts beside it change nothing); 3+ episode files
 * of comparable size → tv. The title alone never decides here.
 */
export function decideCategory(title: string, files: TorrentFile[]): AddCategory | null {
  void title;
  const total = files.reduce((n, f) => n + sizeOf(f), 0);
  if (total > 0) {
    const audio = files.filter((f) => MUSIC_EXT.test(f.path)).reduce((n, f) => n + sizeOf(f), 0);
    if (audio / total >= 0.8) return 'music';
  }
  if (hasMainVideo(files)) return 'movie';
  if (episodeFileCount(files) >= MIN_EPISODE_FILES) return 'tv';
  return null;
}

/** The files of a torrent as the list gives them (file_stats, else TorrServer's list in `data`). */
export function torrentFiles(tor: Torrent): TorrentFile[] {
  return tor.file_stats && tor.file_stats.length ? tor.file_stats : parseTorrentData(tor.data);
}

// Categories OMP set itself at an add (by its guess), per hash: the auto-fix may correct only those. Kept locally
// because the torrent's data may not be written yet right after an add.
const AUTO_KEY = 'tsp.categoryAuto';
const AUTO_MAX = 300;

function autoMap(): { [hash: string]: string } {
  return loadJson<{ [hash: string]: string }>(AUTO_KEY, {}, isObject);
}

/** An add set this category by OMP's own guess (not picked by the user). */
export function recordAutoCategory(hash: string, category: string): void {
  if (!hash) return;
  const map = autoMap();
  map[hash.toLowerCase()] = category || '';
  const keys = Object.keys(map);
  if (keys.length > AUTO_MAX) keys.slice(0, keys.length - AUTO_MAX).forEach((k) => delete map[k]);
  saveJson(AUTO_KEY, map);
}

/** The category OMP itself set for the torrent (omp.ca, else the local record of an add); null when none. */
export function autoCategoryOf(tor: Torrent): string | null {
  const own = categoryAuto(tor.data);
  if (own !== null) return own;
  const map = autoMap();
  const k = String(tor.hash || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null;
}

/**
 * The category to set, or null to leave it. OMP never fights the user: only an empty category, or one OMP itself set
 * (omp.ca / its add record) that nobody changed since, is touched; a hand pick (omp.cm) or any other category (the TV,
 * the web UI, Lampa, an older OMP) is respected. An empty one is filled (by the files, else by episode marks in the
 * title); OMP's own guess is corrected only for clear contradictions: a film of episode files becomes a series, a
 * film or series of audio becomes music.
 */
export function categoryFix(tor: Torrent, files?: TorrentFile[]): AddCategory | null {
  if (categoryPicked(tor.data)) return null;
  const cur = tor.category || '';
  if (cur !== '' && autoCategoryOf(tor) !== cur) return null;
  const list = files || torrentFiles(tor);
  let verdict = decideCategory(displayTitle(tor), list);
  if (!verdict && cur === '' && titleHasEpisodes(displayTitle(tor))) verdict = 'tv';
  if (!verdict || cur === verdict) return null;
  if (cur === '') return verdict;
  if (cur === 'movie' && verdict === 'tv') return verdict;
  if ((cur === 'movie' || cur === 'tv') && verdict === 'music') return verdict;
  return null;
}

export interface CategoryClient {
  /** Writes the category and records it as OMP's own (omp.ca); title, poster and data are read again first. */
  setCategory(tor: Pick<Torrent, 'hash' | 'title' | 'poster'> & { name?: string }, category: string): Promise<void>;
}

/** A torrent added this recently is left for a later refresh (its add may still be writing its category). */
export const FRESH_ADD_MS = 60 * 1000;

/** Hashes looked at with their files in this session, or whose write was refused (lowercase). */
const checked: { [hash: string]: boolean } = {};

function addedAt(tor: Torrent): number {
  const ts = typeof tor.timestamp === 'number' ? tor.timestamp : 0;
  return ts > 1e12 ? ts : ts * 1000;
}

/**
 * Fixes the categories of the torrents not looked at yet in this session; resolves with the torrents changed (their
 * new category). A torrent without files yet is looked at by its title only and again when its files come; one
 * added in the last minute waits; a refused write is not tried again in this session.
 */
export function fixCategories(c: CategoryClient, list: Torrent[], now: number = Date.now()): Promise<{ hash: string; category: AddCategory }[]> {
  const done: { hash: string; category: AddCategory }[] = [];
  let chain: Promise<void> = Promise.resolve();
  list.forEach((tor) => {
    if (!tor || !tor.hash) return;
    const key = String(tor.hash).toLowerCase();
    // a placeholder title is being repaired by another `set` now: looked at once it has its name
    if (checked[key] || isPlaceholderTitle(tor.title, tor.hash)) return;
    const at = addedAt(tor);
    if (at && now - at >= 0 && now - at < FRESH_ADD_MS) return;
    const files = torrentFiles(tor);
    if (files.length) checked[key] = true;
    const next = categoryFix(tor, files);
    if (!next) return;
    checked[key] = true;
    chain = chain.then(() =>
      c.setCategory(tor, next).then(
        () => {
          done.push({ hash: tor.hash, category: next });
          log('info', 'app', t('log.categoryFixed', { title: shortTitle(displayTitle(tor)), category: addCategoryLabel(next) }));
        },
        // refused: stays checked, not asked again on every poll of this session
        () => undefined,
      ),
    );
  });
  return chain.then(() => done);
}

/** Tests: every torrent is looked at again. */
export function resetCategoryCheck(): void {
  Object.keys(checked).forEach((k) => {
    delete checked[k];
  });
}

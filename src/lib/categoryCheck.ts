// Automatic category check: the category a release really has, from its title and files, and the fix of a clear
// contradiction («Фильмы» with 18 episode files → «Сериалы», an album filed as a film → «Музыка»). A category the
// user picked by hand (omp.cm in the torrent's data) is never changed; an empty one is filled. Each torrent is looked
// at once per app session once its files are known. Chromium 53 safe.
import type { Torrent } from '../api/types';
import { parseTorrentData } from '../api/torrserver';
import { parseEpisodeRange } from '../monitor/episodes';
import { baseName, fileKind, parseEpisode, type TorrentFile } from './episodes';
import { categoryPicked } from './journal';
import { displayTitle, isPlaceholderTitle } from './torrentName';
import { shortTitle } from './libraryView';
import { addCategoryLabel, type AddCategory } from './categoryGuess';
import { log } from './log';
import { t } from '../i18n';

const MUSIC_EXT = /\.(mp3|flac|m4a|ogg|opus|wav|ape)$/i;
const BRACKET_NUM = /\[(\d{1,3})\]/;
/** «Show - 07 [1080p].mkv», the usual anime naming. */
const DASH_NUM = /\s-\s(\d{1,3})(?:v\d)?(?=[\s.\[(]|$)/;

function sizeOf(f: TorrentFile): number {
  return typeof f.length === 'number' && f.length > 0 ? f.length : 0;
}

/** The title names a season or several episodes («S1E1-18», «E01-E18», «серии 1-18», «2 сезон»). */
export function titleHasEpisodes(title: string): boolean {
  const r = parseEpisodeRange(title);
  return r.season !== undefined || (r.to !== undefined && r.from !== undefined && r.to - r.from >= 3);
}

/** Video files with distinct episode numbers (SxxEyy, EPxx, «[07]»). */
function episodeFiles(files: TorrentFile[]): number {
  const seen: string[] = [];
  files.forEach((f) => {
    if (fileKind(f.path) !== 'video') return;
    const e = parseEpisode(f.path);
    let k = '';
    if (e.episode !== null) k = (e.season || 0) + ':' + e.episode;
    else {
      const name = baseName(f.path);
      const m = BRACKET_NUM.exec(name) || DASH_NUM.exec(name);
      if (m) k = '0:' + +m[1];
    }
    if (k && seen.indexOf(k) < 0) seen.push(k);
  });
  return seen.length;
}

/**
 * The category the title and files clearly say, or null when they say nothing sure:
 * mostly audio (≥ 80% of the size) → music; episodes in the title or several episode files → tv; one main video
 * (≥ 70% of the size) with no episode marks → movie.
 */
export function decideCategory(title: string, files: TorrentFile[]): AddCategory | null {
  const total = files.reduce((n, f) => n + sizeOf(f), 0);
  if (total > 0) {
    const audio = files.filter((f) => MUSIC_EXT.test(f.path)).reduce((n, f) => n + sizeOf(f), 0);
    if (audio / total >= 0.8) return 'music';
  }
  if (titleHasEpisodes(title) || episodeFiles(files) >= 2) return 'tv';
  if (total > 0) {
    const videos = files.filter((f) => fileKind(f.path) === 'video');
    const main = videos.reduce((m, f) => Math.max(m, sizeOf(f)), 0);
    if (videos.length && main / total >= 0.7 && episodeFiles(files) === 0) return 'movie';
  }
  return null;
}

/** The files of a torrent as the list gives them (file_stats, else TorrServer's list in `data`). */
export function torrentFiles(tor: Torrent): TorrentFile[] {
  return tor.file_stats && tor.file_stats.length ? tor.file_stats : parseTorrentData(tor.data);
}

/**
 * The category to set, or null to leave it: never over a hand-picked one; an empty one is filled; otherwise only
 * clear contradictions — a film with episodes becomes a series, a film or series of audio becomes music.
 */
export function categoryFix(tor: Torrent, files?: TorrentFile[]): AddCategory | null {
  if (categoryPicked(tor.data)) return null;
  const verdict = decideCategory(displayTitle(tor), files || torrentFiles(tor));
  if (!verdict) return null;
  const cur = tor.category || '';
  if (cur === verdict) return null;
  if (cur === '') return verdict;
  if (cur === 'movie' && verdict === 'tv') return verdict;
  if ((cur === 'movie' || cur === 'tv') && verdict === 'music') return verdict;
  return null;
}

export interface CategoryClient {
  setCategory(tor: Pick<Torrent, 'hash' | 'title' | 'poster'> & { name?: string }, category: string): Promise<void>;
}

/** Hashes looked at with their files in this session (lowercase). */
const checked: { [hash: string]: boolean } = {};

/**
 * Fixes the categories of the torrents not looked at yet in this session; resolves with the torrents changed
 * (their new category). A torrent without files yet is looked at by its title only and again when its files come.
 */
export function fixCategories(c: CategoryClient, list: Torrent[]): Promise<{ hash: string; category: AddCategory }[]> {
  const done: { hash: string; category: AddCategory }[] = [];
  let chain: Promise<void> = Promise.resolve();
  list.forEach((tor) => {
    if (!tor || !tor.hash) return;
    const key = String(tor.hash).toLowerCase();
    // a placeholder title is being repaired by another `set` now: looked at once it has its name
    if (checked[key] || isPlaceholderTitle(tor.title, tor.hash)) return;
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
        () => {
          // the server refused: tried again in the next session
          delete checked[key];
        },
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

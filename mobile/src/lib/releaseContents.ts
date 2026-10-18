// «18 серий» / «16 файлов»: what a release holds, the same everywhere (library rows, the series screen, the torrent
// screen, the info row of a season's releases). Episodes come from the file names, ranges included («1-2 серия»,
// «S01E01-E02»), each counted once; when a file names no episode, the files are counted instead.
import type { Torrent } from '../../../src/api/types';
import { tp } from '../../../src/i18n';
import { episodesOutOf } from '../../../src/lib/episodesOutOf';
import { baseName, playableFiles, type TorrentFile } from '../../../src/lib/episodes';
import { fileEpisodes } from '../../../src/lib/categoryCheck';
import { filesOf } from '../watch';

/** Samples and trailers are no episodes. */
const SAMPLE = /(?:^|[^a-z])(?:sample|trailer)(?:[^a-z]|$)/i;

/** The playable files of a release, samples and trailers aside. */
function contentFiles(files: TorrentFile[]): TorrentFile[] {
  return playableFiles(files).filter((f) => !SAMPLE.test(baseName(f.path)));
}

/** The episodes the files name (each once), or null when a file names none. */
export function episodeCountOf(files: TorrentFile[]): number | null {
  const list = contentFiles(files);
  const seen: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const e = fileEpisodes(list[i].path);
    if (!e) return null;
    e.episodes.forEach((n) => {
      const k = (e.season === null ? 0 : e.season) + ':' + n;
      if (seen.indexOf(k) < 0) seen.push(k);
    });
  }
  return seen.length ? seen.length : null;
}

/** «18 серий» when every file names its episodes, else «16 файлов»; '' for fewer than 2 files (a film). */
export function contentsTextOf(files: TorrentFile[]): string {
  const list = contentFiles(files);
  if (list.length < 2) return '';
  const n = episodeCountOf(files);
  return n !== null ? tp('library.episodes', n) : tp('series.files', list.length);
}

export function contentsText(tor: Torrent): string {
  return contentsTextOf(filesOf(tor));
}

/** Every content file's episodes belong to `season` (a file with no season number counts as this season). */
function oneSeason(files: TorrentFile[], season: number): boolean {
  const list = contentFiles(files);
  for (let i = 0; i < list.length; i++) {
    const e = fileEpisodes(list[i].path);
    if (!e) return false;
    if (e.season !== null && e.season !== season) return false;
  }
  return list.length > 0;
}

/**
 * The episode part of the torrent header. «5 из 8 серий» when the files are that one season and its TMDB total is
 * known; a pack of several seasons stays «18 серий» (one season's total would not match the count). Unknown total,
 * or files that are not episodes, stays «5 серий» / «16 файлов».
 */
export function torrentHeaderEpisodes(files: TorrentFile[], season: number | null, total: number): string {
  const plain = contentsTextOf(files);
  if (!plain || season === null || !(total > 0)) return plain;
  const n = episodeCountOf(files);
  if (n === null || !oneSeason(files, season)) return plain;
  return episodesOutOf(n, total);
}

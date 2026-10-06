// «18 серий» / «16 файлов»: what a release holds, the same everywhere (library rows, the series screen, the torrent
// screen, the info row of a season's releases). Episodes come from the file names, ranges included («1-2 серия»,
// «S01E01-E02»), each counted once; when a file names no episode, the files are counted instead.
import type { Torrent } from '../../../src/api/types';
import { tp } from '../../../src/i18n';
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

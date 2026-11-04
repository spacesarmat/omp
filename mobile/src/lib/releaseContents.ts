// «18 серий» / «16 файлов»: what a release holds, the same everywhere (library rows, the series screen, the torrent
// screen, the info row of a season's releases). Episodes come from the file names, ranges included («1-2 серия»,
// «S01E01-E02»), each counted once; when a file names no episode, the files are counted instead.
import type { Torrent } from '../../../src/api/types';
import { tp } from '../../../src/i18n';
import { episodesOutOf } from '../../../src/lib/episodesOutOf';
import { baseName, filesOfSeason, parseEpisode, playableFiles, type TorrentFile } from '../../../src/lib/episodes';
import { fileEpisodes } from '../../../src/lib/categoryCheck';
import { externalNoteText } from '../../../src/lib/externalNote';
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

/** «+3 озвучки, субтитры»: the external dubs and subtitles of a release; '' when none (or its files are not known). */
export function extrasText(tor: Torrent): string {
  return externalNoteText(filesOf(tor));
}

/** Season numbers the files name. */
function numberedSeasons(files: TorrentFile[]): number[] {
  const seen: number[] = [];
  files.forEach((file) => {
    const s = parseEpisode(file.path).season;
    if (s !== null && seen.indexOf(s) < 0) seen.push(s);
  });
  return seen;
}

/** Files that name an episode but no season (Show.E02.mkv). */
function looseEpisodeFiles(files: TorrentFile[]): TorrentFile[] {
  const out: TorrentFile[] = [];
  files.forEach((file) => {
    if (parseEpisode(file.path).season !== null) return;
    const e = fileEpisodes(file.path);
    if (e && e.episodes.length) out.push(file);
  });
  return out;
}

/**
 * The episode part of the torrent header. «5 из 8 серий» when that season's total is known.
 * A pack is counted for the season on screen, not for every episode in the torrent.
 * A file that names an episode but no season is counted once, in the total header (`season` null,
 * «Дополнительно» or the whole torrent). It is also counted in a header that is the torrent's only
 * season (S02E01 next to E02). It is not added to every season of a multi-season pack.
 * Unknown total, or files that are not episodes, stays «5 серий» / «16 файлов».
 */
export function torrentHeaderEpisodes(files: TorrentFile[], season: number | null, total: number): string {
  const seasons = numberedSeasons(files);
  const ownsLoose = season !== null && seasons.length === 1 && seasons[0] === season;
  const scoped = season === null ? files : filesOfSeason(files, season).concat(ownsLoose ? looseEpisodeFiles(files) : []);
  const counting = scoped.length ? scoped : files;
  // one episode of a pack is still «1 серия»; a torrent that is a single file stays blank
  const oneOfPack = season !== null && files.length > 1 && counting.length === 1;
  const nOne = oneOfPack ? episodeCountOf(counting) : null;
  const plain = nOne ? tp('library.episodes', nOne) : contentsTextOf(counting);
  if (!plain || season === null || !(total > 0)) return plain;
  const n = episodeCountOf(counting);
  if (n === null) return plain;
  return episodesOutOf(n, total);
}

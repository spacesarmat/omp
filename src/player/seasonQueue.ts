// One season, from the episode the person chose, using only files of the current release.
// The next season is never added. A hole in the numbering stops the queue: another torrent is not chosen.
import { fileEpisodes } from '../lib/categoryCheck';
import { isExtraFile, parseEpisode, playableFiles, type TorrentFile } from '../lib/episodes';

export interface SeasonSpan {
  /** Chosen episode through the last contiguous episode of the same season in this release. */
  files: TorrentFile[];
  /** Index of the chosen file. Always 0 when the file is an episode: earlier ones are left out. */
  start: number;
  season: number | null;
  /**
   * The next episode number that this release does not have.
   * Null at the end of a contiguous run when no later episode of the season is known
   * (`total` reached, or nothing past the last file and no hole before it).
   */
  missing: number | null;
}

/**
 * `total` is the season's episode count when the catalog knows it.
 * A file that is not an episode (a film) stays a one-item queue and does not constrain the rest.
 */
export function seasonSpan(all: TorrentFile[], startId: number, total?: number): SeasonSpan {
  const playable = playableFiles(all);
  const start = playable.filter((f) => f.id === startId)[0];
  if (!start) return { files: [], start: 0, season: null, missing: null };
  const pe = parseEpisode(start.path);
  const season = pe.season;
  const episode = pe.episode;
  if (season === null || episode === null || isExtraFile(start.path)) {
    return { files: [start], start: 0, season: null, missing: null };
  }
  const covered = fileEpisodes(start.path);
  const startEps = covered && (covered.season === null || covered.season === season) ? covered.episodes : [episode];
  const from = startEps.reduce((m, n) => (n < m ? n : m), startEps[0]);
  const covers: { id: number; file: TorrentFile; episodes: number[] }[] = [];
  playable.forEach((f) => {
    if (isExtraFile(f.path)) return;
    const info = fileEpisodes(f.path);
    if (!info) return;
    if (info.season !== null && info.season !== season) return;
    const eps = info.episodes.filter((e) => e >= from);
    if (!eps.length) return;
    covers.push({ id: f.id, file: f, episodes: eps });
  });
  const files: TorrentFile[] = [];
  const used: { [id: number]: boolean } = {};
  let n = from;
  const knownEnd = total !== undefined && total >= from ? total : 0;
  while (!knownEnd || n <= knownEnd) {
    let hit: { id: number; file: TorrentFile; episodes: number[] } | undefined;
    for (let i = 0; i < covers.length; i++) {
      if (covers[i].episodes.indexOf(n) >= 0) {
        hit = covers[i];
        break;
      }
    }
    if (!hit) break;
    if (!used[hit.id]) {
      files.push(hit.file);
      used[hit.id] = true;
    }
    let max = n;
    for (let i = 0; i < hit.episodes.length; i++) if (hit.episodes[i] > max) max = hit.episodes[i];
    n = max + 1;
    if (n > from + 10000) break;
  }
  let missing: number | null = null;
  const coversN = covers.some((c) => c.episodes.indexOf(n) >= 0);
  if (!coversN) {
    const later = covers.some((c) => c.episodes.some((e) => e > n));
    if (later || (knownEnd && n <= knownEnd)) missing = n;
  }
  return { files: files.length ? files : [start], start: 0, season: season, missing: missing };
}

/** File ids to send to the TV. Undefined when the start file is not an episode, so a film's queue stays as it was. */
export function seasonFileIds(all: TorrentFile[], startId: number, total?: number): number[] | undefined {
  const span = seasonSpan(all, startId, total);
  if (span.season === null || !span.files.length) return undefined;
  return span.files.map((f) => f.id);
}

export type SeasonStep =
  | { kind: 'stay' }
  | { kind: 'next'; index: number }
  | { kind: 'done'; missing: number | null };

/**
 * What to do when an item reports its end. Cancel and a second end for the same index do not move.
 * `seen` is the index whose end was already consumed.
 */
export function seasonStep(o: {
  length: number;
  index: number;
  ended: boolean;
  cancel: boolean;
  seen: number | null;
  missing: number | null;
}): { step: SeasonStep; seen: number | null } {
  if (o.cancel || !o.ended) return { step: { kind: 'stay' }, seen: o.seen };
  if (o.seen === o.index) return { step: { kind: 'stay' }, seen: o.seen };
  const seen = o.index;
  if (o.index + 1 < o.length) return { step: { kind: 'next', index: o.index + 1 }, seen: seen };
  return { step: { kind: 'done', missing: o.missing }, seen: seen };
}

/** One visit to a queue item on the TV player. A new index starts a fresh visit, so going back can advance again. */
export interface SeasonVisit {
  index: number;
  ended: number;
  advanced: boolean;
}

export function seasonVisit(
  prev: SeasonVisit,
  index: number,
  ended: number,
  hasNext: boolean,
): { state: SeasonVisit; go: 'stay' | 'next' | 'end' } {
  if (index !== prev.index) return { state: { index, ended, advanced: false }, go: 'stay' };
  if (!ended || ended === prev.ended) return { state: prev, go: 'stay' };
  if (prev.advanced) return { state: { index, ended, advanced: true }, go: 'stay' };
  return { state: { index, ended, advanced: true }, go: hasNext ? 'next' : 'end' };
}

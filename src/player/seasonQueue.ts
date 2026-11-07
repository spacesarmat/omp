// One season, from the episode the person chose, using only files of the current release.
// The next season is never added. A hole in the numbering stops the queue: another torrent is not chosen.
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
  const byEp: { [n: number]: TorrentFile } = {};
  playable.forEach((f) => {
    if (isExtraFile(f.path)) return;
    const p = parseEpisode(f.path);
    if (p.season !== season || p.episode === null || p.episode < episode) return;
    if (!byEp[p.episode] || f.id === startId) byEp[p.episode] = f;
  });
  const files: TorrentFile[] = [];
  let n = episode;
  const knownEnd = total !== undefined && total >= episode ? total : 0;
  while (byEp[n] && (!knownEnd || n <= knownEnd)) {
    files.push(byEp[n]);
    n++;
  }
  let missing: number | null = null;
  if (!byEp[n]) {
    const later = Object.keys(byEp).some((k) => +k > n);
    if (later) missing = n;
    else if (knownEnd && n <= knownEnd) missing = n;
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

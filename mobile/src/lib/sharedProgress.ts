// The phone's view of a file's progress with the copies of its episode in the other releases of the series
// (src/lib/episodeProgress): checkmarks, progress bars, the resume position and the «Смотреть на ТВ» target.
import { episodeProgress, type EpisodeProgress } from '../../../src/lib/episodeProgress';
import { progressReader } from '../../../src/store/progress';
import { torrents } from '../../../src/store/library';

export function sharedProgress(hash: string, idx: number): EpisodeProgress {
  return episodeProgress(torrents.value, hash, idx, progressReader);
}

export function sharedWatched(hash: string, idx: number): boolean {
  return sharedProgress(hash, idx).watched;
}

/** Seconds to resume the file from (its own record or a sibling copy's); 0 for none. */
export function sharedResume(hash: string, idx: number): number {
  return sharedProgress(hash, idx).position;
}

/** The watched share for a progress bar: 1 when watched. */
export function sharedRatio(hash: string, idx: number): number {
  const p = sharedProgress(hash, idx);
  return p.watched ? 1 : p.ratio;
}

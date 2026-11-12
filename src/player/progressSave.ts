import type { TorrServerClient } from '../api/torrserver';
import { episodeLabel } from '../lib/episodes';
import { saveProgress, MIN_RESUME, WATCHED_RATIO } from '../store/progress';
import { progressIdentity, pushProgress } from '../viewer/progressSync';
import type { PlayItem } from './types';

/** One progress save: always local, and to TorrServer /viewed when `remote` (shared by the HTML5 and native players). */
export function saveItemProgress(
  c: TorrServerClient | null,
  item: PlayItem | undefined,
  time: number,
  duration: number,
  remote: boolean,
  /** The player said this is not a finish. Keep the position and do not send the watched timecode. */
  open = false,
): void {
  if (!item) return;
  const hash = item.hash;
  const idx = item.fileIndex;
  if (!hash || idx === undefined) return;
  if (!(duration > 0) || !(time >= 1)) return;
  saveProgress(hash, idx, time, duration, open);
  if (remote && c && time >= MIN_RESUME) {
    // 1 marks a finish. 0 is what TorrServer writes when a file is only opened, so it cannot mean watched.
    const tc = !open && time / duration >= WATCHED_RATIO ? 1 : Math.floor(time);
    c.setViewed(hash, idx, tc).catch(() => undefined);
  }
  if (remote) {
    const title = item.torrentTitle || item.title;
    const film = !episodeLabel(item.title);
    const id = progressIdentity(title, item.title, film);
    const finished = !open && duration > 0 && time / duration >= WATCHED_RATIO;
    pushProgress({
      titleKey: id.titleKey,
      episodeKey: id.episodeKey,
      positionSec: finished ? 0 : Math.floor(time),
      durationSec: Math.floor(duration),
      title: title,
      label: episodeLabel(item.title),
    });
  }
}

export const LOCAL_SAVE_MS = 5000;
export const REMOTE_SAVE_MS = 15000;

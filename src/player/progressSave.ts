import type { TorrServerClient } from '../api/torrserver';
import { saveProgress, MIN_RESUME, WATCHED_RATIO } from '../store/progress';
import type { PlayItem } from './types';

/** One progress save: always local, and to TorrServer /viewed when `remote` (shared by the HTML5 and native players). */
export function saveItemProgress(
  c: TorrServerClient | null,
  item: PlayItem | undefined,
  time: number,
  duration: number,
  remote: boolean,
): void {
  if (!item) return;
  const hash = item.hash;
  const idx = item.fileIndex;
  if (!hash || idx === undefined) return;
  if (!(duration > 0) || !(time >= 1)) return;
  saveProgress(hash, idx, time, duration);
  if (remote && c && time >= MIN_RESUME) {
    // server: timecode < MIN_RESUME means watched, so send 0 once the file is (nearly) finished
    const tc = time / duration >= WATCHED_RATIO ? 0 : Math.floor(time);
    c.setViewed(hash, idx, tc).catch(() => undefined);
  }
}

export const LOCAL_SAVE_MS = 5000;
export const REMOTE_SAVE_MS = 15000;

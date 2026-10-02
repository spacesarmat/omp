import { useEffect } from 'preact/hooks';
import type { TorrServerClient } from '../api/torrserver';
import { saveProgress, MIN_RESUME, WATCHED_RATIO } from '../store/progress';
import type { PlayItem } from './types';

/** Saves position locally every 5 s and to TorrServer /viewed every 15 s and on exit. */
export function useProgressSync(
  c: TorrServerClient | null,
  item: PlayItem,
  pos: { current: { time: number; duration: number } },
): void {
  useEffect(() => {
    const hash = item.hash;
    const idx = item.fileIndex;
    if (!hash || idx === undefined) return;
    const save = (remote: boolean) => {
      const p = pos.current;
      if (p.duration <= 0 || p.time < 1) return;
      saveProgress(hash, idx, p.time, p.duration);
      if (remote && c && p.time >= MIN_RESUME) {
        // server: timecode < MIN_RESUME means watched, so send 0 once the file is (nearly) finished
        const tc = p.time / p.duration >= WATCHED_RATIO ? 0 : Math.floor(p.time);
        c.setViewed(hash, idx, tc).catch(() => undefined);
      }
    };
    const local = setInterval(() => save(false), 5000);
    const remote = setInterval(() => save(true), 15000);
    return () => {
      clearInterval(local);
      clearInterval(remote);
      save(true);
    };
  }, [item]);
}

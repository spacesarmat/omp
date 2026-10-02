import { useEffect } from 'preact/hooks';
import type { TorrServerClient } from '../api/torrserver';
import type { PlayItem } from './types';
import { saveItemProgress, LOCAL_SAVE_MS, REMOTE_SAVE_MS } from './progressSave';

/** Saves position locally every 5 s and to TorrServer /viewed every 15 s and on exit. */
export function useProgressSync(
  c: TorrServerClient | null,
  item: PlayItem,
  pos: { current: { time: number; duration: number } },
): void {
  useEffect(() => {
    if (!item.hash || item.fileIndex === undefined) return;
    const save = (remote: boolean) => saveItemProgress(c, item, pos.current.time, pos.current.duration, remote);
    const local = setInterval(() => save(false), LOCAL_SAVE_MS);
    const remote = setInterval(() => save(true), REMOTE_SAVE_MS);
    return () => {
      clearInterval(local);
      clearInterval(remote);
      save(true);
    };
  }, [item]);
}

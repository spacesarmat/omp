import { useEffect, useState } from 'preact/hooks';
import type { TorrServerClient } from '../api/torrserver';
import type { CacheState } from '../api/types';

/** idle: not asking. pending: no answer yet. ok: a body. down: the request failed (TorrServer unreachable). */
export type CacheRead =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'ok'; cache: CacheState }
  | { status: 'down' };

/**
 * TorrServer /cache of the torrent playing while [active] (once a second). A failed request is `down`, never frozen
 * numbers; another torrent and closing the panel (`active` false) drop the previous answer.
 */
export function useCacheStats(c: TorrServerClient | null, hash: string | undefined, active: boolean): CacheRead {
  const [read, setRead] = useState<CacheRead>({ status: 'idle' });
  useEffect(() => {
    if (!active || !c || !hash) {
      setRead({ status: 'idle' });
      return undefined;
    }
    setRead({ status: 'pending' });
    let alive = true;
    const tick = () => c.cache(hash).then(
      (r) => { if (alive) setRead(r ? { status: 'ok', cache: r } : { status: 'down' }); },
      () => { if (alive) setRead({ status: 'down' }); },
    );
    tick();
    const timer = setInterval(tick, CACHE_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [active, hash]);
  return read;
}

export const CACHE_REFRESH_MS = 1000;

import { useEffect, useState } from 'preact/hooks';
import type { TorrServerClient } from '../api/torrserver';
import type { CacheState } from '../api/types';

/**
 * TorrServer /cache of the torrent playing while [active] (once a second, «Инфо»): null while unknown, after a failed
 * request (never frozen numbers), for another torrent and once inactive (a reopened panel never shows old numbers).
 */
export function useCacheStats(c: TorrServerClient | null, hash: string | undefined, active: boolean): CacheState | null {
  const [cache, setCache] = useState<CacheState | null>(null);
  useEffect(() => {
    setCache(null);
    if (!active || !c || !hash) return;
    let alive = true;
    const tick = () => c.cache(hash).then((r) => { if (alive) setCache(r || null); }, () => { if (alive) setCache(null); });
    tick();
    const t = setInterval(tick, CACHE_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [active, hash]);
  return cache;
}

export const CACHE_REFRESH_MS = 1000;

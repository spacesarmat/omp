import { useEffect, useState } from 'preact/hooks';
import type { TorrServerClient } from '../api/torrserver';
import type { CacheState } from '../api/types';

export function useCacheStats(c: TorrServerClient | null, hash: string | undefined, active: boolean): CacheState | null {
  const [cache, setCache] = useState<CacheState | null>(null);
  useEffect(() => {
    if (!active || !c || !hash) return;
    let alive = true;
    const tick = () => c.cache(hash).then((r) => { if (alive) setCache(r); }, () => undefined);
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [active, hash]);
  return cache;
}

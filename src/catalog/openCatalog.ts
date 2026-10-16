// Builds the catalog client for one server address and remembers it. A read that produced no key is not remembered,
// so the next «Обзор» open and «Повторить» ask the server again. `fresh` asks again even when a client is remembered
// (the key or the mirror may have changed).
import type { SourceHttp } from '../sources/types';
import { createCatalogClient, type CatalogClient } from './client';
import { endpointOf } from './tmdb';
import { resolveTmdbKey } from './resolveTmdb';
import type { TmdbSource } from './localTmdb';

export interface CatalogCache {
  slot: { server: string; client: Promise<CatalogClient> } | null;
}

export function openCatalog(
  cache: CatalogCache,
  opts: {
    fresh: boolean;
    server: string;
    active: TmdbSource | null;
    http: SourceHttp;
    fallbackKey: string;
  },
): Promise<CatalogClient> {
  const slot = cache.slot;
  if (!opts.fresh && slot && slot.server === opts.server) return slot.client;
  let p: Promise<CatalogClient>;
  p = resolveTmdbKey({ active: opts.active, fallbackKey: opts.fallbackKey }).then((res) => {
    if (res.status !== 'ok') {
      if (cache.slot && cache.slot.client === p) cache.slot = null;
      return createCatalogClient(null, opts.http, { missing: res.status === 'unreachable' ? 'unreachable' : 'nokey' });
    }
    const ep = endpointOf(res.config, '');
    if (!ep) {
      if (cache.slot && cache.slot.client === p) cache.slot = null;
      return createCatalogClient(null, opts.http, { missing: 'nokey' });
    }
    return createCatalogClient(ep, opts.http);
  });
  cache.slot = { server: opts.server, client: p };
  return p;
}

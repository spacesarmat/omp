// Catalog of the hidden RPC page (mobile/rpc.html). That WebView only has OmpRpcHost, not the Capacitor
// OmpNative plugin, so a TMDB request has to use the page bridge. phoneCatalog's http would fail here.
import { client } from '../../../src/store/servers';
import { openCatalog, type CatalogCache } from '../../../src/catalog/openCatalog';
import { setCatalogProvider } from '../../../src/catalog/activeCatalog';
import { TMDB_FALLBACK_KEY } from '../../../src/catalog/fallbackKey';
import type { CatalogClient } from '../../../src/catalog/client';
import type { SourceHttp } from '../../../src/sources/types';

const cache: CatalogCache = { slot: null };

/** The catalog client for this page: the active server's TMDB settings when they can be read, else the built-in key. */
export function rpcCatalog(http: SourceHttp, fresh?: boolean): Promise<CatalogClient> {
  const ts = client.value;
  return openCatalog(cache, {
    fresh: !!fresh,
    server: ts ? ts.baseUrl : '',
    active: ts ? { baseUrl: ts.baseUrl, readTmdbSettings: () => ts.readTmdbSettings() } : null,
    http: http,
    fallbackKey: TMDB_FALLBACK_KEY,
  });
}

/** Poster lookups on this page use `http` (the RPC bridge). */
export function installRpcCatalog(http: SourceHttp): void {
  cache.slot = null;
  setCatalogProvider((fresh) => rpcCatalog(http, fresh));
}

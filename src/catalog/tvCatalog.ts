// The TV's TMDB client: native HTTP on Android TV, plain fetch on webOS (TMDB answers with CORS).
import { client } from '../store/servers';
import type { CatalogClient } from './client';
import { TMDB_FALLBACK_KEY } from './fallbackKey';
import { openCatalog, type CatalogCache } from './openCatalog';
import { nativeSourceHttp } from '../platform/androidNative';
import type { HttpOptions, HttpResponse, SourceHttp } from '../sources/types';

const DEFAULT_TIMEOUT_MS = 15000;

/** GET-only SourceHttp over fetch. A network error or timeout resolves status 0 (the client maps it to offline). */
export function fetchSourceHttp(fetchImpl?: typeof fetch): SourceHttp {
  return {
    get(url: string, opts?: HttpOptions): Promise<HttpResponse> {
      const f: typeof fetch | undefined = fetchImpl || (typeof fetch === 'function' ? fetch : undefined);
      const failed: HttpResponse = { status: 0, url: url, text: '' };
      if (!f) return Promise.resolve(failed);
      const ms = opts && opts.timeoutMs ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const init: RequestInit = { method: 'GET' };
      if (opts && opts.headers) init.headers = opts.headers;
      if (ctl) init.signal = ctl.signal;
      return new Promise<HttpResponse>((resolve) => {
        const timer = setTimeout(() => {
          if (ctl) ctl.abort();
          resolve(failed);
        }, ms);
        let req: Promise<Response>;
        try {
          req = f(url, init);
        } catch (e) {
          clearTimeout(timer);
          resolve(failed);
          return;
        }
        req
          .then((r) => r.text().then((text) => ({ status: r.status, url: r.url || url, text: text })))
          .then(
            (res) => {
              clearTimeout(timer);
              resolve(res);
            },
            () => {
              clearTimeout(timer);
              resolve(failed);
            },
          );
      });
    },
    post: () => Promise.reject(new Error('post is not supported')),
    clearCookies: () => Promise.resolve(),
  };
}

let forTests: CatalogClient | null = null;
const cache: CatalogCache = { slot: null };

export function setTvCatalogForTests(c: CatalogClient | null): void {
  forTests = c;
  cache.slot = null;
}

/**
 * The catalog client: the active server's TMDB key, else the phone's running TorrServer (when this bundle
 * registered one), else OMP's built-in key. `fresh` reads again — «Обзор» does that on open and on «Повторить».
 * A read that found no key is not kept.
 */
export function tvCatalog(fresh?: boolean): Promise<CatalogClient> {
  if (forTests) return Promise.resolve(forTests);
  const ts = client.value;
  const server = ts ? ts.baseUrl : '';
  const http = nativeSourceHttp() || fetchSourceHttp();
  return openCatalog(cache, {
    fresh: !!fresh,
    server: server,
    active: ts ? { baseUrl: ts.baseUrl, readTmdbSettings: () => ts.readTmdbSettings() } : null,
    http: http,
    fallbackKey: TMDB_FALLBACK_KEY,
  });
}

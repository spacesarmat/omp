// «Обзор» on the phone: the TMDB catalog client of the active TorrServer and the «Мои / Обзор» mode of «Каталог».
import { signal } from '@preact/signals';
import { client } from '../../../src/store/servers';
import { loadJson, saveJson } from '../../../src/store/storage';
import type { CatalogClient } from '../../../src/catalog/client';
import { TMDB_FALLBACK_KEY } from '../../../src/catalog/fallbackKey';
import { openCatalog, type CatalogCache } from '../../../src/catalog/openCatalog';
import { setLocalTmdbSource } from '../../../src/catalog/localTmdb';
import type { Key } from '../../../src/i18n';
import { setCatalogProvider } from '../../../src/catalog/activeCatalog';
import { phoneSourceContext } from '../searchContext';
import { LOCAL_URL, localServer } from '../server/localServer';
import { TorrServerClient } from '../../../src/api/torrserver';

export type CatalogMode = 'mine' | 'discover';

const MODE_KEY = 'tsp.catalogMode';

const isMode = (v: unknown): v is CatalogMode => v === 'mine' || v === 'discover';

export const catalogMode = signal<CatalogMode>(loadJson<CatalogMode>(MODE_KEY, 'mine', isMode));

export function setCatalogMode(m: CatalogMode): void {
  catalogMode.value = m;
  saveJson(MODE_KEY, m);
}

// The error copy as i18n keys (the texts live in ru.ts / en.ts): render them with t().
export const OFFLINE_TITLE: Key = 'discover.offlineTitle';
export const OFFLINE_TEXT: Key = 'discover.offlineText';
export const NOKEY_TEXT: Key = 'discover.nokeyText';

let forTests: CatalogClient | null = null;
const cache: CatalogCache = { slot: null };

/** A fake client for tests; one without `season` or `person` rejects those requests. */
export function setCatalogClientForTests(
  c:
    | (Omit<CatalogClient, 'season' | 'person' | 'similar' | 'posters' | 'home'> &
        Partial<Pick<CatalogClient, 'season' | 'person' | 'similar' | 'posters' | 'home'>>)
    | null,
): void {
  const bad = () => Promise.reject(new Error('catalog:bad'));
  forTests = c
    ? {
        ...c,
        season: c.season || bad,
        person: c.person || bad,
        similar: c.similar || (() => Promise.resolve([])),
        posters: c.posters || (() => Promise.resolve([])),
        home: c.home || (() => Promise.resolve([])),
      }
    : null;
  cache.slot = null;
}

// The embedded TorrServer on this phone, only while it is running. Shared with posters and the TV catalog path.
setLocalTmdbSource(() => {
  if (!localServer.value.running) return null;
  const c = new TorrServerClient({ url: LOCAL_URL });
  return { baseUrl: c.baseUrl, readTmdbSettings: () => c.readTmdbSettings() };
});

/**
 * The catalog client: the active server's TMDB key, else the phone's running TorrServer, else OMP's built-in key.
 * `fresh` reads again (each «Обзор» visit and «Повторить» do: the key or the mirror may have changed); otherwise
 * the client of the last successful read for this server is reused. A read that found no key is never kept, and an
 * unreachable server is reported as such instead of "no key".
 */
export function phoneCatalog(fresh?: boolean): Promise<CatalogClient> {
  if (forTests) return Promise.resolve(forTests);
  const ts = client.value;
  const server = ts ? ts.baseUrl : '';
  const http = phoneSourceContext().http;
  return openCatalog(cache, {
    fresh: !!fresh,
    server: server,
    active: ts ? { baseUrl: ts.baseUrl, readTmdbSettings: () => ts.readTmdbSettings() } : null,
    http: http,
    fallbackKey: TMDB_FALLBACK_KEY,
  });
}

setCatalogProvider((fresh) => phoneCatalog(fresh));

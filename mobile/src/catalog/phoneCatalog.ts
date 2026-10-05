// «Обзор» on the phone: the TMDB catalog client of the active TorrServer and the «Мои / Обзор» mode of «Каталог».
import { signal } from '@preact/signals';
import { client } from '../../../src/store/servers';
import { loadJson, saveJson } from '../../../src/store/storage';
import { createCatalogClient, type CatalogClient } from '../../../src/catalog/client';
import { endpointOf } from '../../../src/catalog/tmdb';
import { TMDB_FALLBACK_KEY } from '../../../src/catalog/fallbackKey';
import type { Key } from '../../../src/i18n';
import { phoneSourceContext } from '../searchContext';

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
let cached: { server: string; client: Promise<CatalogClient> } | null = null;

export function setCatalogClientForTests(c: CatalogClient | null): void {
  forTests = c;
  cached = null;
}

/**
 * The catalog client for the active server: its TMDB settings when it has a key, else OMP's built-in key.
 * Resolved once per server; a server without any key is asked again next time (the key may be added meanwhile).
 */
export function phoneCatalog(): Promise<CatalogClient> {
  if (forTests) return Promise.resolve(forTests);
  const ts = client.value;
  const server = ts ? ts.baseUrl : '';
  if (cached && cached.server === server) return cached.client;
  const http = phoneSourceContext().http;
  const p = (ts ? ts.tmdbSettings() : Promise.resolve(null)).then((cfg) => {
    const endpoint = endpointOf(cfg, TMDB_FALLBACK_KEY);
    if (!endpoint && cached && cached.client === p) cached = null;
    return createCatalogClient(endpoint, http);
  });
  cached = { server, client: p };
  return p;
}

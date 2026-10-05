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
 * `fresh` reads the server's settings again (each «Обзор» visit and «Повторить» do: the key or the mirror may have
 * changed); otherwise the client of the last read for this server is reused (chips, next pages). A failed or empty
 * read is never kept.
 */
export function phoneCatalog(fresh?: boolean): Promise<CatalogClient> {
  if (forTests) return Promise.resolve(forTests);
  const ts = client.value;
  const server = ts ? ts.baseUrl : '';
  if (!fresh && cached && cached.server === server) return cached.client;
  const http = phoneSourceContext().http;
  const p: Promise<CatalogClient> = (ts ? ts.tmdbSettings() : Promise.resolve(null)).then((cfg) => {
    if (!cfg && cached && cached.client === p) cached = null;
    return createCatalogClient(endpointOf(cfg, TMDB_FALLBACK_KEY), http);
  });
  cached = { server, client: p };
  return p;
}

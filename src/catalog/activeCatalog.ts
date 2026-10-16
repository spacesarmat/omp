// The catalog client the running app uses. The phone registers its own provider
// (phoneCatalog); shared series code asks for it here without importing the phone.
import type { CatalogClient } from './client';

export type CatalogProvider = (fresh?: boolean) => Promise<CatalogClient>;

let provider: CatalogProvider | null = null;

export function setCatalogProvider(p: CatalogProvider | null): void {
  provider = p;
}

/**
 * The catalog client. `fresh` reads the TMDB key again (an «Обзор» open and «Повторить» pass true).
 * Rejects with catalog code 'nokey' when no provider is registered.
 */
export function activeCatalog(fresh?: boolean): Promise<CatalogClient> {
  if (!provider) return Promise.reject(Object.assign(new Error('catalog:nokey'), { code: 'nokey' }));
  return provider(fresh);
}

import { beforeEach, vi } from 'vitest';
import { setTmdbFallbackKeyForTests } from '../../src/catalog/fallbackKey';

/**
 * A release job used to export TMDB_API_KEY for every step. Vite then baked that secret into
 * __TMDB_FALLBACK_KEY__, and tests that expected "no key" called the live TMDB API.
 * Clear both the env var and the live binding before any test reads them.
 */
function clearTmdbKey(): void {
  vi.stubEnv('TMDB_API_KEY', '');
  setTmdbFallbackKeyForTests('');
}

clearTmdbKey();

beforeEach(() => {
  clearTmdbKey();
});

// OMP's built-in TMDB key, used when neither the active TorrServer nor the phone's own TorrServer has one.
// Empty in the repository and in dev/PR builds. Release builds inject it from the GitHub Actions secret TMDB_API_KEY
// (vite define __TMDB_FALLBACK_KEY__). The key is never committed.
declare const __TMDB_FALLBACK_KEY__: string;

function readBuiltinKey(): string {
  try {
    return typeof __TMDB_FALLBACK_KEY__ === 'string' ? __TMDB_FALLBACK_KEY__ : '';
  } catch (e) {
    return '';
  }
}

// A live binding: tests replace it after Vite has already baked __TMDB_FALLBACK_KEY__.
export let TMDB_FALLBACK_KEY = readBuiltinKey();

/** Tests drop a key that leaked in from TMDB_API_KEY so catalog calls stay offline. */
export function setTmdbFallbackKeyForTests(key: string): void {
  TMDB_FALLBACK_KEY = key;
}

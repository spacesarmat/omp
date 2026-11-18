// LG Content Store build: a home-media player for the user's own TorrServer, without public torrent search or
// discovery. The flag is baked at build time (vite.store.config.ts); every regular build keeps it false, so the
// full-featured sideload/dev-mode app is unchanged. Features are gated, not removed.
declare const __STORE_BUILD__: boolean;

export const STORE_BUILD: boolean = __STORE_BUILD__;

/** Public torrent search / discovery (the add screen, tracker sources, TMDB title/person lookup) is off in the store build. */
export function publicSearchEnabled(): boolean {
  return !STORE_BUILD;
}
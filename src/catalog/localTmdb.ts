// The phone's embedded TorrServer, when the phone app has registered it. The TV bundle leaves this unset: a TV has
// no TorrServer of its own at 127.0.0.1. Catalog, posters and the TV catalog all ask here for the second key.
import type { TmdbSettingsRead } from '../api/torrserver';

export interface TmdbSource {
  baseUrl: string;
  readTmdbSettings(): Promise<TmdbSettingsRead>;
}

let getter: (() => TmdbSource | null) | null = null;

/** The phone registers the embedded server here; null clears it (tests). */
export function setLocalTmdbSource(fn: (() => TmdbSource | null) | null): void {
  getter = fn;
}

/** The phone's running TorrServer, or null when it is not running or nobody registered it. */
export function localTmdbSource(): TmdbSource | null {
  return getter ? getter() : null;
}

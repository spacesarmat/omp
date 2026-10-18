// A release TorrServer is working on that never receives a seeder or a byte.
// Pure: the caller owns the clock and what "active" means.

/** How long a live torrent may sit at 0 seeders and 0 bytes before it is called dead. */
export const DEAD_RELEASE_MS = 60000;

export interface DeadSample {
  /** TorrServer is getting info, preloading, or working (stat 1–3), or the player is still waiting on it. */
  active: boolean;
  /** `connected_seeders`. */
  seeders: number;
  /** `loaded_size` + `preloaded_bytes`. Any byte already stored means the swarm answered. */
  bytes: number;
}

export interface DeadState {
  /** When the silent streak started, or null when it is not silent. */
  since: number | null;
  dead: boolean;
}

/**
 * Next streak. Not active, a connected seeder, or any downloaded byte clears it.
 * Silent and active for DEAD_RELEASE_MS (from `since`, or from `now` when `since` is null) is dead.
 */
export function deadRelease(since: number | null, now: number, sample: DeadSample): DeadState {
  const seeders = sample.seeders > 0 ? sample.seeders : 0;
  const bytes = sample.bytes > 0 ? sample.bytes : 0;
  if (!sample.active || seeders > 0 || bytes > 0) return { since: null, dead: false };
  const start = since === null ? now : since;
  return { since: start, dead: now - start >= DEAD_RELEASE_MS };
}

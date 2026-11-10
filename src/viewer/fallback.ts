// When playback has had 15-20 s and the buffer is still not playable, offer another release.
// Chromium 53 safe.

/** Inside the 15-20 s window. Earlier than this, keep waiting. */
export const FALLBACK_WAIT_MS = 18000;

/** A download at least this fast, with a small head, can start. */
export const PLAYABLE_SPEED = 200 * 1024;

/** This much already in cache is enough even when the instantaneous speed dipped. */
export const PLAYABLE_BYTES = 2 * 1024 * 1024;

const HEAD_BYTES = 32 * 1024;

export function isPlayable(played: boolean, bytes: number, speedBps: number): boolean {
  if (played) return true;
  if (bytes >= PLAYABLE_BYTES) return true;
  if (speedBps >= PLAYABLE_SPEED && bytes >= HEAD_BYTES) return true;
  return false;
}

/** True once the wait has elapsed and the stream is still not playable. */
export function fallbackDue(elapsedMs: number, played: boolean, bytes: number, speedBps: number): boolean {
  if (!(elapsedMs >= FALLBACK_WAIT_MS)) return false;
  return !isPlayable(played, bytes, speedBps);
}

export type FallbackAction = 'wait' | 'offer' | 'switch';

/** `auto` switches by itself. Otherwise the viewer only sees an offer. Not due: keep waiting. */
export function fallbackAction(due: boolean, auto: boolean): FallbackAction {
  if (!due) return 'wait';
  return auto ? 'switch' : 'offer';
}

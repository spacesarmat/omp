import type { FfprobeResult } from '../api/types';
import { skipSegments } from './chapters';

/**
 * Intro of one queue item for the native player (Android TV): `{ type: 'intro', index, start, end, session }`
 * sent with nativePlayerCommand (seconds). The native overlay shows «Пропустить заставку» inside it.
 * Later releases add more segment kinds (credits) to the same per-item message.
 */
export interface IntroMark {
  type: 'intro';
  index: number;
  start: number;
  end: number;
  session: number;
}

/** The intro of `probe` (chapters only: no manual marks here) as a message for item `index`; null when there is none. */
export function introMark(probe: FfprobeResult | null, index: number, session: number): IntroMark | null {
  const seg = skipSegments(probe, null, 0).intro;
  if (!seg || !(seg.end > seg.start) || seg.start < 0) return null;
  return { type: 'intro', index, start: seg.start, end: seg.end, session };
}

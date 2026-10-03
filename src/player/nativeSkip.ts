import type { FfprobeResult } from '../api/types';
import type { SkipPrefs } from '../lib/journal';
import type { MarkKind } from './chapters';
import { chapterList, skipSegments } from './chapters';

/**
 * Chapters and skips of one queue item for the native player (Android TV), sent with nativePlayerCommand
 * (seconds): the chapter list (ticks, «Главы», CH±), the intro and credits start chosen by skipSegments
 * (chapters win over the manual marks), the auto skip flags of the torrent and its manual marks (`mi`, `mc`,
 * the intro start marked and waiting for its end) for the «Отметить …» rows of the player menu.
 * An item's message also tells the player that ffprobe has answered: CH± fall back to the next / previous
 * episode only once it has, and only without chapters.
 */
export interface NativeSegments {
  type: 'segments';
  index: number;
  session: number;
  chapters: { start: number; title: string }[];
  intro?: { start: number; end: number };
  credits?: { start: number };
  autoIntro: boolean;
  autoCredits: boolean;
  mi?: [number, number];
  mc?: number;
  pending?: number;
}

export function segmentsMessage(
  probe: FfprobeResult | null,
  prefs: SkipPrefs | null,
  duration: number,
  index: number,
  session: number,
  pending: number | null,
): NativeSegments {
  const segs = skipSegments(probe, prefs, duration > 0 ? duration : 0);
  const m: NativeSegments = {
    type: 'segments', index, session,
    chapters: chapterList(probe).map((c) => ({ start: c.start, title: c.title })),
    autoIntro: !!(prefs && prefs.i),
    autoCredits: !!(prefs && prefs.c),
  };
  if (segs.intro && segs.intro.start >= 0 && segs.intro.end > segs.intro.start) m.intro = { start: segs.intro.start, end: segs.intro.end };
  if (segs.credits && segs.credits.start > 0) m.credits = { start: segs.credits.start };
  if (prefs && prefs.mi) m.mi = [prefs.mi[0], prefs.mi[1]];
  if (prefs && prefs.mc) m.mc = prefs.mc;
  if (pending !== null) m.pending = pending;
  return m;
}

/** «Отметить …» chosen in the native player menu: `now` is the position when the menu opened (seconds). */
export interface NativeMark {
  index: number;
  kind: MarkKind;
  now: number;
  duration: number;
}

export function sanitizeNativeMark(v: unknown): NativeMark | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const index = o.index;
  if (typeof index !== 'number' || !isFinite(index) || Math.floor(index) !== index || index < 0) return null;
  if (o.kind !== 'intro-start' && o.kind !== 'intro-end' && o.kind !== 'credits') return null;
  const now = typeof o.now === 'number' && isFinite(o.now) && o.now >= 0 ? o.now : null;
  if (now === null) return null;
  const duration = typeof o.duration === 'number' && isFinite(o.duration) && o.duration > 0 ? o.duration : 0;
  return { index, kind: o.kind, now, duration };
}

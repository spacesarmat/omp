// Manual intro / credits marks as text (m:ss, h:mm:ss) and the status line of the torrent card.
import { formatDuration } from './format';
import type { SkipPrefs } from './journal';

/** «45», «0:45», «1:02:03» → seconds; null for anything else (empty, letters, seconds or minutes over 59 with a hour part). */
export function parseMark(text: string): number | null {
  const s = text.replace(/^\s+|\s+$/g, '');
  if (!/^\d+(:\d{1,2}){0,2}$/.test(s)) return null;
  const parts = s.split(':').map((x) => parseInt(x, 10));
  let sec = 0;
  for (let i = 0; i < parts.length; i++) {
    if (i > 0 && parts[i] > 59) return null;
    sec = sec * 60 + parts[i];
  }
  return sec;
}

/** The manual marks as text («заставка 0:45–2:15», «титры: последние 1:30»). */
export function manualMarks(prefs: SkipPrefs): string[] {
  const marks: string[] = [];
  if (prefs.mi) marks.push('заставка ' + formatDuration(prefs.mi[0]) + '–' + formatDuration(prefs.mi[1]));
  if (prefs.mc) marks.push('титры: последние ' + formatDuration(prefs.mc));
  return marks;
}

/**
 * Status of «Заставка и титры»: «по главам файла» when the file has chapters (plus the manual marks, if one of the two
 * is set by hand), else the manual marks, else nothing.
 */
export function skipStatus(hasChapters: boolean, prefs: SkipPrefs): string {
  const marks = manualMarks(prefs);
  if (hasChapters) return marks.length ? 'по главам файла · вручную: ' + marks.join(' · ') : 'по главам файла';
  return marks.length ? 'в файле нет глав · ' + marks.join(' · ') : 'не заданы';
}

/** Manual marks as the TV dialog edits them: the intro as a pair, the credits as «last N seconds»; null = not set. */
export interface TvMarks {
  mi: [number, number] | null;
  mc: number | null;
}

export type MarkRow = 'from' | 'to' | 'last';

/** ◀ ▶ step, and the step while the key is held. */
export const MARK_STEP = 5;
export const MARK_FAST_STEP = 30;
/** Marks never go past six hours. */
export const MARK_MAX = 6 * 3600;
/** An intro that is not set yet starts from this pair on the first press, the credits from this length. */
const DEFAULT_INTRO: [number, number] = [0, 90];
const DEFAULT_LAST = 90;

/** The marks after ◀ (dir -1) / ▶ (dir 1) on `row` by `amount` seconds; always valid (0 ≤ from < to ≤ MARK_MAX, 1 ≤ last ≤ MARK_MAX). */
export function stepMark(m: TvMarks, row: MarkRow, dir: 1 | -1, amount: number): TvMarks {
  const d = dir * amount;
  if (row === 'last') {
    const base = m.mc === null ? DEFAULT_LAST : m.mc;
    return { mi: m.mi, mc: Math.min(MARK_MAX, Math.max(1, base + d)) };
  }
  const base = m.mi || DEFAULT_INTRO;
  if (row === 'from') return { mi: [Math.min(base[1] - 1, Math.max(0, base[0] + d)), base[1]], mc: m.mc };
  return { mi: [base[0], Math.min(MARK_MAX, Math.max(base[0] + 1, base[1] + d))], mc: m.mc };
}

/** Marks from the journal brought into the dialog bounds (the phone does not cap them at six hours). */
export function clampMarks(m: TvMarks): TvMarks {
  const cl = (v: number, lo: number) => Math.min(MARK_MAX, Math.max(lo, v));
  let mi: [number, number] | null = null;
  if (m.mi) {
    const a = Math.min(cl(m.mi[0], 0), MARK_MAX - 1);
    mi = [a, Math.max(a + 1, cl(m.mi[1], 0))];
  }
  return { mi, mc: m.mc === null ? null : cl(m.mc, 1) };
}

/** Marks that can be written as they are: the intro ends after it starts, both inside the limit, the credits are positive. */
export function marksValid(m: TvMarks): boolean {
  if (m.mi && !(m.mi[0] >= 0 && m.mi[1] > m.mi[0] && m.mi[1] <= MARK_MAX)) return false;
  if (m.mc !== null && !(m.mc >= 1 && m.mc <= MARK_MAX)) return false;
  return true;
}

/** The value of a row as shown: «0:45», or «—» when the mark is not set. */
export function markText(m: TvMarks, row: MarkRow): string {
  if (row === 'last') return m.mc === null ? '—' : formatDuration(m.mc);
  return m.mi ? formatDuration(row === 'from' ? m.mi[0] : m.mi[1]) : '—';
}

/** A key press in the dialog counts as held: auto-repeat, or the same direction again within this many ms. */
export const HOLD_GAP_MS = 180;
/** While held, at most one fast step per this many ms (remotes repeat at 10-30 Hz). */
export const FAST_STEP_MS = 250;

export interface KeyTrack {
  dir: number;
  at: number;
  fastAt: number;
}

/** Amount to step for a left/right press now (0: drop it; a held key repeats faster than a fast step is useful); updates the track). */
export function holdStep(track: KeyTrack, dir: 1 | -1, repeat: boolean, now: number): number {
  const held = repeat || (track.dir === dir && now - track.at < HOLD_GAP_MS);
  track.dir = dir;
  track.at = now;
  if (!held) return MARK_STEP;
  if (now - track.fastAt < FAST_STEP_MS) return 0;
  track.fastAt = now;
  return MARK_FAST_STEP;
}

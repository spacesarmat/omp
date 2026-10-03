import type { FfprobeResult } from '../api/types';
import type { SkipPrefs } from '../lib/journal';

const INTRO_RE = /(^|[^a-zа-яё])(intro|opening|op|заставк[а-яё]*|опенинг|вступлени[а-яё]*)([^a-zа-яё]|$)/i;
const CREDITS_RE = /(^|[^a-zа-яё])(credits|end credits|ending|ed|outro|титры|эндинг)([^a-zа-яё]|$)/i;

export interface Chapter {
  start: number;
  end: number;
  title: string;
  kind: 'intro' | 'credits' | null;
}

/** Finite chapters of a file with their kind (intro / credits by title, longer than 5 s), sorted by start. */
export function chapterList(probe: FfprobeResult | null): Chapter[] {
  const chapters = probe && probe.chapters;
  if (!chapters) return [];
  const out: Chapter[] = [];
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const start = parseFloat(ch.start_time);
    const end = parseFloat(ch.end_time);
    if (!isFinite(start) || !isFinite(end) || end <= start) continue;
    const title = (ch.tags && ch.tags.title) || '';
    const long = end - start > 5;
    const kind = long && INTRO_RE.test(title) ? 'intro' : long && CREDITS_RE.test(title) ? 'credits' : null;
    out.push({ start, end, title, kind });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/** Chapter name for lists: its title, else «Глава N» (N is the 1-based place in the list, so untitled chapters never repeat). */
export function chapterLabel(c: { title: string }, index: number): string {
  const t = c.title.replace(/^\s+|\s+$/g, '');
  return t || 'Глава ' + (index + 1);
}

/** The phone gets at most this many chapters (a file with hundreds would bloat every state message). */
export const MAX_PHONE_CHAPTERS = 100;
/** Longest chapter title sent to the phone. */
export const MAX_PHONE_CHAPTER_TITLE = 80;

/** Intro and credits of a file: chapters win over the manual marks (credits mark: the last `mc` seconds). */
export function skipSegments(
  probe: FfprobeResult | null,
  prefs: SkipPrefs | null,
  duration: number,
): { intro?: { start: number; end: number }; credits?: { start: number } } {
  const list = chapterList(probe);
  const out: { intro?: { start: number; end: number }; credits?: { start: number } } = {};
  const intro = list.filter((c) => c.kind === 'intro')[0];
  const credits = list.filter((c) => c.kind === 'credits')[0];
  if (intro) out.intro = { start: intro.start, end: intro.end };
  else if (prefs && prefs.mi) out.intro = { start: prefs.mi[0], end: prefs.mi[1] };
  if (credits) out.credits = { start: credits.start };
  else if (prefs && prefs.mc && duration > prefs.mc) out.credits = { start: duration - prefs.mc };
  return out;
}

export function introChapter(probe: FfprobeResult | null, t: number): { start: number; end: number } | null {
  const list = chapterList(probe);
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch.kind === 'intro' && t >= ch.start && t < ch.end - 1) return { start: ch.start, end: ch.end };
  }
  return null;
}

/** How long «Заставка пропущена · Вернуть» stays on screen (LG and Android TV). */
export const SKIP_TOAST_MS = 5000;
/** CH− within this many seconds of a chapter start goes to the previous chapter, later it restarts the current one. */
export const PREV_CHAPTER_WINDOW = 3;

/** Index of the chapter playing at `t` (the last one that started), -1 before the first. */
export function chapterIndexAt(list: Chapter[], t: number): number {
  let idx = -1;
  for (let i = 0; i < list.length; i++) if (list[i].start <= t) idx = i;
  return idx;
}

/** Where CH+ (dir 1) / CH− (dir -1) go from `t`: a chapter start in seconds, null when there is nowhere to go. */
export function chapterTarget(list: Chapter[], t: number, dir: 1 | -1): number | null {
  if (!list.length) return null;
  const cur = chapterIndexAt(list, t);
  if (dir > 0) return cur + 1 < list.length ? list[cur + 1].start : null;
  if (cur < 0) return 0;
  if (cur > 0 && t - list[cur].start < PREV_CHAPTER_WINDOW) return list[cur - 1].start;
  return list[cur].start;
}

/** Same as chapterTarget, as a chapter index (-1: the start of the file, before the first chapter); null = nowhere to go. */
export function chapterStepIndex(list: Chapter[], t: number, dir: 1 | -1): number | null {
  const target = chapterTarget(list, t, dir);
  return target === null ? null : chapterIndexAt(list, target);
}

/** True while `t` is inside the intro (not in its last second, so the button never flashes at the very end). */
export function inIntro(seg: { start: number; end: number } | undefined, t: number): boolean {
  return !!seg && t >= seg.start && t < seg.end - 1;
}

/** Where to seek to skip the intro: its end, but never past the last second (a manual mark may exceed the duration). */
export function introSkipTarget(seg: { start: number; end: number }, duration: number): number {
  return duration > 1 ? Math.min(seg.end, duration - 1) : seg.end;
}

export type MarkKind = 'intro-start' | 'intro-end' | 'credits';

export interface MarkResult {
  /** Patch for saveSkip, absent when nothing can be written yet. */
  patch?: { mi?: [number, number]; mc?: number };
  /** Intro start marked and waiting for its end (or null). */
  pending: number | null;
  text: string;
  error?: boolean;
}

/** «Отметить …» from the player menu: what to write and what to tell the viewer. */
export function applyMark(
  kind: MarkKind,
  now: number,
  duration: number,
  cur: { mi?: [number, number] } | null,
  pending: number | null,
  fmt: (sec: number) => string,
): MarkResult {
  const at = Math.round(now);
  if (kind === 'credits') {
    const mc = Math.round(duration - now);
    if (!(duration > 0) || mc < 1) return { pending, text: 'Не удалось отметить титры', error: true };
    return { patch: { mc }, pending, text: 'Отмечено: титры с ' + fmt(Math.round(duration - mc)) };
  }
  const mi = cur && cur.mi;
  if (kind === 'intro-start') {
    if (mi && mi[1] > at) return { patch: { mi: [at, mi[1]] }, pending: null, text: 'Отмечено: заставка с ' + fmt(at) };
    return { pending: at, text: 'Начало заставки ' + fmt(at) + ' · теперь отметьте конец' };
  }
  const start = pending !== null ? pending : mi ? mi[0] : null;
  if (start === null || start >= at) return { pending, text: 'Сначала отметьте начало заставки', error: true };
  return { patch: { mi: [start, at] }, pending: null, text: 'Отмечено: заставка ' + fmt(start) + '–' + fmt(at) };
}

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

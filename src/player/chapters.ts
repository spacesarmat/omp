import type { FfprobeResult } from '../api/types';

const INTRO_RE = /(^|[^a-zа-яё])(intro|opening|op|заставк[а-яё]*|опенинг|вступлени[а-яё]*)([^a-zа-яё]|$)/i;

export function introChapter(probe: FfprobeResult | null, t: number): { start: number; end: number } | null {
  const chapters = probe && probe.chapters;
  if (!chapters) return null;
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const start = parseFloat(ch.start_time);
    const end = parseFloat(ch.end_time);
    const title = (ch.tags && ch.tags.title) || '';
    if (isFinite(start) && isFinite(end) && end - start > 5 && t >= start && t < end - 1 && INTRO_RE.test(title)) {
      return { start, end };
    }
  }
  return null;
}

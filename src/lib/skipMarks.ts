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

/** Status of «Заставка и титры»: chapters of the file, else the manual marks, else nothing. */
export function skipStatus(hasChapters: boolean, prefs: SkipPrefs): string {
  if (hasChapters) return 'по главам файла';
  const marks: string[] = [];
  if (prefs.mi) marks.push('заставка ' + formatDuration(prefs.mi[0]) + '–' + formatDuration(prefs.mi[1]));
  if (prefs.mc) marks.push('титры: последние ' + formatDuration(prefs.mc));
  return marks.length ? 'в файле нет глав · ' + marks.join(' · ') : 'не заданы';
}

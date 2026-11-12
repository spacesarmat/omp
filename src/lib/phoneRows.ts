// The second line of a phone catalog row. One season is «1 сезон · 6 серий», not the range plus the count again.
import { fmtDuration, t, tp } from '../i18n';

/** «Фильм · 2011 · 2 ч 10 мин». A missing year or runtime is left out. */
export function movieRowLine(year: string, runtimeMin: number): string {
  const parts = [t('library.movie')];
  if (year) parts.push(year);
  if (runtimeMin > 0) parts.push(fmtDuration(runtimeMin));
  return parts.join(' · ');
}

/** «S01E04, осталось 22 мин». A missing code or remaining time is left out. */
export function continueStatus(code: string, left: string): string {
  return [code, left].filter(Boolean).join(', ');
}

/** «1 сезон · 6 серий», «2 сезона», «5 сезонов · завершён». */
export function seriesRowLine(seasons: number, episodes: number, ended: boolean): string {
  const parts: string[] = [];
  if (seasons > 0) parts.push(tp('series.seasons', seasons));
  if (episodes > 1) parts.push(tp('library.episodes', episodes));
  if (ended && seasons > 1) parts.push(t('series.rowEnded'));
  return parts.join(' · ');
}

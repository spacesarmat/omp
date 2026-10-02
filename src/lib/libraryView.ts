import { CATEGORY_TABS, Category } from './category';
import { parseEpisode, baseName, stripExt } from './episodes';
import { formatDuration } from './format';

export type LibraryView = 'large' | 'small' | 'list' | 'compact';

export const VIEW_OPTIONS: { value: LibraryView; label: string }[] = [
  { value: 'large', label: 'Крупные постеры' },
  { value: 'small', label: 'Мелкие постеры' },
  { value: 'list', label: 'Список' },
  { value: 'compact', label: 'Компактный' },
];

function indexOfView(v: LibraryView): number {
  for (let k = 0; k < VIEW_OPTIONS.length; k++) if (VIEW_OPTIONS[k].value === v) return k;
  return 0;
}

export function nextView(v: LibraryView): LibraryView {
  return VIEW_OPTIONS[(indexOfView(v) + 1) % VIEW_OPTIONS.length].value;
}

export function viewLabel(v: LibraryView): string {
  return VIEW_OPTIONS[indexOfView(v)].label;
}

export type LibraryTab = 'history' | 'all' | Category;

export const LIBRARY_TABS: { id: LibraryTab; label: string }[] = [
  { id: 'history' as LibraryTab, label: 'История' },
].concat(CATEGORY_TABS);

export const POSTER_COLORS = ['#2B3A55', '#4A2E3A', '#2F4A3A', '#4A3F2A', '#3A2F55', '#2A4A4F'];

export function posterColor(hash: string): string {
  let h = 0;
  for (let i = 0; i < hash.length; i++) h = (h * 31 + hash.charCodeAt(i)) >>> 0;
  return POSTER_COLORS[h % POSTER_COLORS.length];
}

// first of: bracket, year, season/episode, resolution
const CUT = /(\[|\(|\b(?:19[5-9][0-9]|20[0-4][0-9])\b|\bS[0-9]{1,2}(?:E[0-9]{1,3})?\b|\b(?:2160|1080|720|480)[pi]\b)/i;

export function shortTitle(title: string): string {
  const first = (title || '').split(' / ')[0].replace(/[._]+/g, ' ').trim();
  if (!first) return '?';
  const m = CUT.exec(first);
  const cut = (m ? first.slice(0, m.index) : first).replace(/[\s\-–:,]+$/, '').trim();
  return cut || first;
}

export function episodeLine(path: string, isMovie: boolean): string {
  const e = parseEpisode(path);
  if (e.episode !== null) return (e.season !== null ? 'Сезон ' + e.season + ' · ' : '') + 'Серия ' + e.episode;
  if (isMovie) return 'Фильм';
  return stripExt(baseName(path));
}

export function positionLabel(time: number, duration: number): string {
  return formatDuration(time) + (duration > 0 ? ' / ' + formatDuration(duration) : '');
}

export function remainingLabel(time: number, duration: number): string {
  if (!(duration > 0)) return '';
  const left = Math.max(0, Math.round((duration - time) / 60));
  if (left < 1) return 'осталось меньше минуты';
  if (left < 60) return 'осталось ' + left + ' мин';
  const h = Math.floor(left / 60);
  const m = left % 60;
  return 'осталось ' + h + ' ч' + (m ? ' ' + m + ' мин' : '');
}

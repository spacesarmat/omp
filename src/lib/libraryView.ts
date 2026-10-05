import { categoryTabs, Category } from './category';
import { parseEpisode, baseName, stripExt } from './episodes';
import { formatDuration } from './format';
import { t, fmtDuration } from '../i18n';

export type LibraryView = 'large' | 'small' | 'list' | 'compact';

export const viewOptions = (): { value: LibraryView; label: string }[] => [
  { value: 'large', label: t('library.viewLarge') },
  { value: 'small', label: t('library.viewSmall') },
  { value: 'list', label: t('library.viewList') },
  { value: 'compact', label: t('library.viewCompact') },
];

function indexOfView(v: LibraryView): number {
  const list = viewOptions();
  for (let k = 0; k < list.length; k++) if (list[k].value === v) return k;
  return 0;
}

export function nextView(v: LibraryView): LibraryView {
  const list = viewOptions();
  return list[(indexOfView(v) + 1) % list.length].value;
}

// smallest to biggest: what a two-finger pinch steps through (spread = bigger)
const BY_SIZE: LibraryView[] = ['compact', 'list', 'small', 'large'];

/** One step bigger (dir 1) or smaller (dir -1); the ends of the range stay put. */
export function zoomView(v: LibraryView, dir: 1 | -1): LibraryView {
  const i = BY_SIZE.indexOf(v);
  if (i < 0) return v;
  return BY_SIZE[Math.max(0, Math.min(BY_SIZE.length - 1, i + dir))];
}

export function viewLabel(v: LibraryView): string {
  return viewOptions()[indexOfView(v)].label;
}

export type LibraryTab = 'history' | 'all' | Category;

export const libraryTabs = (): { id: LibraryTab; label: string }[] =>
  [{ id: 'history' as LibraryTab, label: t('library.tabHistory') }].concat(categoryTabs());

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
  if (e.episode !== null) return (e.season !== null ? t('library.season', { n: e.season }) + ' · ' : '') + t('library.episode', { n: e.episode });
  if (isMovie) return t('library.movie');
  return stripExt(baseName(path));
}

export function positionLabel(time: number, duration: number): string {
  return formatDuration(time) + (duration > 0 ? ' / ' + formatDuration(duration) : '');
}

export function remainingLabel(time: number, duration: number): string {
  if (!(duration > 0)) return '';
  const left = Math.max(0, Math.round((duration - time) / 60));
  if (left < 1) return t('library.leftLess');
  return t('library.left', { time: fmtDuration(left) });
}

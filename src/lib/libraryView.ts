import { categoryTabs, Category } from './category';
import { parseEpisode, baseName, stripExt, type TorrentFile } from './episodes';
import { formatDuration } from './format';
import { t, fmtDuration } from '../i18n';
import { displayTitle, yearOf } from './torrentName';
import { parseEpisodeRange, SEASON_WORDS } from '../monitor/episodes';

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
export const BY_SIZE: LibraryView[] = ['compact', 'list', 'small', 'large'];

/** One step bigger (dir 1) or smaller (dir -1); the ends of the range stay put. */
export function zoomView(v: LibraryView, dir: 1 | -1): LibraryView {
  const i = BY_SIZE.indexOf(v);
  if (i < 0) return v;
  return BY_SIZE[Math.max(0, Math.min(BY_SIZE.length - 1, i + dir))];
}

export function viewLabel(v: LibraryView): string {
  return viewOptions()[indexOfView(v)].label;
}

/** 'discover' is the TV «Обзор» tab (TMDB catalog); the phone has its own «Мои / Обзор» switch. 'news' is the TV
 * «Новое» tab (findings from OMP on the phone). */
export type LibraryTab = 'history' | 'news' | 'discover' | 'all' | Category;

export const libraryTabs = (): { id: LibraryTab; label: string }[] =>
  [{ id: 'history' as LibraryTab, label: t('library.tabHistory') }].concat(categoryTabs());

/** The TV tabs: «История», «Новое», «Обзор», then the categories. */
export const tvLibraryTabs = (): { id: LibraryTab; label: string }[] => {
  const list = libraryTabs();
  const own: { id: LibraryTab; label: string }[] = [
    { id: 'news', label: t('tv.news.tab') },
    { id: 'discover', label: t('discover.browse') },
  ];
  return list.slice(0, 1).concat(own, list.slice(1));
};

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

// a tracker string, not a name typed by the user: title variants, brackets, quality / source / SxxEyy marks,
// «Сезон: 2», or a dotted release name without spaces (Chromium 53: no  next to Cyrillic)
const RAW_MARKS = /(?:^|[^0-9a-z])(?:2160p|1080[pi]|720p|480p|4k|uhd|hdr|web-?dl|web-?rip|bd-?rip|blu-?ray|hd-?rip|hdtv|remux|x26[45]|h\.?26[45]|hevc|s\d{1,2}(?:e\d{1,3})?)(?:[^0-9a-z]|$)/i;
const RAW_SEP = / \/ |[[\]|]|(?:сезон|сезоны|серии|серия)\s*:/i;

function looksRaw(s: string): boolean {
  return RAW_SEP.test(s) || RAW_MARKS.test(s) || (s.indexOf(' ') < 0 && /[._]/.test(s));
}

export interface LibraryTitle {
  /** The name to show: the first title variant without season, year and release details. */
  title: string;
  /** Short details: «2 сезон · серии 1–6 из 10» for a series, the year for a film; '' when none. */
  meta: string;
}

/**
 * A short title for the library rows: «Темная материя» + «2 сезон · серии 1–6 из 10» from a tracker string.
 * A name the user typed (no tracker marks) and one derived from the files stay as they are.
 */
export function libraryTitle(tor: { hash: string; title?: string; name?: string; data?: string; file_stats?: TorrentFile[] }): LibraryTitle {
  const own = (tor.title || '').trim();
  const shown = displayTitle(tor);
  // a plain name with the year in brackets («Название (2026)») reads like the others: «Название · 2026»
  const plainYear = shown === own ? /^(.+?)\s*\((19\d\d|20\d\d)\)$/.exec(own) : null;
  if (plainYear && !looksRaw(plainYear[1])) return { title: plainYear[1], meta: plainYear[2] };
  if (shown !== own || !looksRaw(own)) return { title: shown, meta: '' };
  const first = own.split(' / ')[0];
  const core = shortTitle(first.replace(SEASON_WORDS, ''));
  const name = core === '?' ? shortTitle(first) : core;
  if (name === '?') return { title: shown, meta: '' };
  const r = parseEpisodeRange(own);
  const parts: string[] = [];
  if (r.season !== undefined) {
    parts.push(r.seasonTo !== undefined ? t('library.metaSeasons', { a: r.season, b: r.seasonTo }) : t('filters.season', { n: r.season }));
  }
  if (r.from !== undefined && r.to !== undefined) {
    if (r.from === r.to) parts.push(t('library.metaEpisode', { n: r.to }));
    else if (r.total !== undefined) parts.push(t('library.metaEpisodesOf', { from: r.from, to: r.to, total: r.total }));
    else parts.push(t('library.metaEpisodes', { from: r.from, to: r.to }));
  }
  if (!parts.length) {
    const y = yearOf(own.replace(/[._]+/g, ' '));
    if (y) parts.push(y);
  }
  return { title: name, meta: parts.join(' · ') };
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

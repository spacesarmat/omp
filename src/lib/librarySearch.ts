import type { Torrent } from '../api/types';
import { naturalCompare } from './episodes';
import { displayTitle } from './torrentName';
import { t } from '../i18n';

export type LibrarySort = 'new' | 'title' | 'size';

export const sortOptions = (): { value: LibrarySort; label: string }[] => [
  { value: 'new', label: t('library.sortNew') },
  { value: 'title', label: t('library.sortTitle') },
  { value: 'size', label: t('library.sortSize') },
];

function indexOfSort(s: LibrarySort): number {
  const list = sortOptions();
  for (let k = 0; k < list.length; k++) if (list[k].value === s) return k;
  return 0;
}

export function nextSort(s: LibrarySort): LibrarySort {
  const list = sortOptions();
  return list[(indexOfSort(s) + 1) % list.length].value;
}

export function sortLabel(s: LibrarySort): string {
  return sortOptions()[indexOfSort(s)].label;
}

function norm(s: string): string {
  return (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[._\-]+/g, ' ');
}

export function filterTorrents(list: Torrent[], query: string): Torrent[] {
  const q = norm(query).trim();
  if (!q) return list;
  const words = q.split(/\s+/);
  return list.filter((t) => {
    const n = norm(displayTitle(t));
    return words.every((w) => n.indexOf(w) >= 0);
  });
}

function byHash(x: Torrent, y: Torrent): number {
  return x.hash < y.hash ? -1 : x.hash > y.hash ? 1 : 0;
}

// hash is the final tiebreak: Chromium 53 sort is unstable for >10 items
export function sortTorrents(list: Torrent[], mode: LibrarySort): Torrent[] {
  const a = list.slice();
  if (mode === 'title') a.sort((x, y) => naturalCompare(norm(displayTitle(x)), norm(displayTitle(y))) || byHash(x, y));
  else if (mode === 'size') a.sort((x, y) => (y.torrent_size || 0) - (x.torrent_size || 0) || byHash(x, y));
  else a.sort((x, y) => (y.timestamp || 0) - (x.timestamp || 0) || byHash(x, y));
  return a;
}

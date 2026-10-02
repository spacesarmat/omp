import type { Torrent } from '../api/types';
import { naturalCompare } from './episodes';

export type LibrarySort = 'new' | 'title' | 'size';

export const SORT_OPTIONS: { value: LibrarySort; label: string }[] = [
  { value: 'new', label: 'Новые' },
  { value: 'title', label: 'По названию' },
  { value: 'size', label: 'По размеру' },
];

function indexOfSort(s: LibrarySort): number {
  for (let k = 0; k < SORT_OPTIONS.length; k++) if (SORT_OPTIONS[k].value === s) return k;
  return 0;
}

export function nextSort(s: LibrarySort): LibrarySort {
  return SORT_OPTIONS[(indexOfSort(s) + 1) % SORT_OPTIONS.length].value;
}

export function sortLabel(s: LibrarySort): string {
  return SORT_OPTIONS[indexOfSort(s)].label;
}

function norm(s: string): string {
  return (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[._\-]+/g, ' ');
}

export function filterTorrents(list: Torrent[], query: string): Torrent[] {
  const q = norm(query).trim();
  if (!q) return list;
  const words = q.split(/\s+/);
  return list.filter((t) => {
    const n = norm(t.title || t.name || '');
    return words.every((w) => n.indexOf(w) >= 0);
  });
}

export function sortTorrents(list: Torrent[], mode: LibrarySort): Torrent[] {
  const a = list.slice();
  if (mode === 'title') a.sort((x, y) => naturalCompare(norm(x.title || x.name || ''), norm(y.title || y.name || '')));
  else if (mode === 'size') a.sort((x, y) => (y.torrent_size || 0) - (x.torrent_size || 0));
  else a.sort((x, y) => (y.timestamp || 0) - (x.timestamp || 0));
  return a;
}

import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from './storage';
import type { Torrent } from '../api/types';
import type { LibraryTab } from '../lib/libraryView';

const KEY = 'tsp.torrents';

export function sanitizeTorrents(v: unknown): Torrent[] {
  if (!Array.isArray(v)) return [];
  return v.filter((t): t is Torrent => isObject(t) && typeof t.hash === 'string');
}

export const torrents = signal<Torrent[]>(sanitizeTorrents(loadJson<unknown>(KEY, [], Array.isArray)));

// Library view state; module-level so it survives screen remounts on navigation
export const libraryTab = signal<LibraryTab>('all');
export const librarySearchOpen = signal(false);
export const libraryQuery = signal('');

let inflight: Promise<Torrent[]> | null = null;
let gen = 0;

// drop data of the previous server and invalidate any pending refresh
export function resetLibrary(): void {
  gen++;
  inflight = null;
  torrents.value = [];
  libraryTab.value = 'all';
  librarySearchOpen.value = false;
  libraryQuery.value = '';
  saveJson(KEY, []);
}

export function refreshTorrents(c: { list(): Promise<Torrent[]> }): Promise<Torrent[]> {
  if (inflight) return inflight;
  const my = gen;
  inflight = c.list().then(
    (list) => {
      const sorted = list.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      if (my !== gen) return sorted;
      inflight = null;
      torrents.value = sorted;
      saveJson(
        KEY,
        sorted.map((t) => ({
          hash: t.hash, title: t.title, category: t.category, poster: t.poster,
          torrent_size: t.torrent_size, data: t.data, stat: t.stat, timestamp: t.timestamp,
        })),
      );
      return sorted;
    },
    (e) => {
      if (my === gen) inflight = null;
      throw e;
    },
  );
  return inflight;
}

export function addedTorrents(prev: Torrent[], next: Torrent[]): Torrent[] {
  if (!prev.length) return [];
  const known: { [h: string]: boolean } = {};
  prev.forEach((t) => { known[t.hash] = true; });
  return next.filter((t) => !known[t.hash]);
}

export function addedMessage(added: Torrent[]): string | null {
  if (!added.length) return null;
  if (added.length > 3) return 'Добавлено торрентов: ' + added.length;
  return 'Добавлено: ' + added.map((t) => t.title || t.hash).join(', ');
}

import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from './storage';
import type { Torrent } from '../api/types';

const KEY = 'tsp.torrents';

export function sanitizeTorrents(v: unknown): Torrent[] {
  if (!Array.isArray(v)) return [];
  return v.filter((t): t is Torrent => isObject(t) && typeof t.hash === 'string');
}

export const torrents = signal<Torrent[]>(sanitizeTorrents(loadJson<unknown>(KEY, [], Array.isArray)));

let inflight: Promise<Torrent[]> | null = null;

export function refreshTorrents(c: { list(): Promise<Torrent[]> }): Promise<Torrent[]> {
  if (inflight) return inflight;
  inflight = c.list().then(
    (list) => {
      inflight = null;
      const sorted = list.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
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
      inflight = null;
      throw e;
    },
  );
  return inflight;
}

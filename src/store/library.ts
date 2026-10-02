import { signal } from '@preact/signals';
import { loadJson, saveJson } from './storage';
import type { Torrent } from '../api/types';

const KEY = 'tsp.torrents';

export const torrents = signal<Torrent[]>(loadJson<Torrent[]>(KEY, []));

export function refreshTorrents(c: { list(): Promise<Torrent[]> }): Promise<Torrent[]> {
  return c.list().then((list) => {
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
  });
}

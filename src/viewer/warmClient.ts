import type { TorrServerClient } from '../api/torrserver';
import type { Torrent } from '../api/types';
import type { WarmClient } from './prebuffer';

export function asWarm(c: TorrServerClient): WarmClient {
  return {
    get: (hash) => c.get(hash),
    addTemporary: (link) => c.addTemporary(link),
    remove: (hash) => c.remove(hash),
    loadInfo: (hash) => c.loadInfo(hash),
    files: (t) => c.files(t as Torrent),
    preload: (hash, index, name, signal) => c.preloadAbortable(hash, index, name, signal),
    preloadTail: (hash, index, name, start, end, signal) => c.preloadTail(hash, index, name, start, end, signal),
  };
}

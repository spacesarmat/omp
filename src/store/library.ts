import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from './storage';
import type { Torrent } from '../api/types';
import type { LibraryTab } from '../lib/libraryView';
import { attachPoster, fillPosters, type FillResult, type PosterClient } from '../lib/autoPoster';

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

/**
 * A torrent just added on the server: it shows up in the list at once (the library refreshes when shown),
 * then its poster is looked up in the background and the list is refreshed when one is set.
 */
export function rememberAdded(c: PosterClient & { list(): Promise<Torrent[]> }, t: Torrent, hint: string): Promise<string> {
  if (!t || !t.hash) return Promise.resolve('');
  if (!torrents.value.some((x) => x.hash === t.hash)) torrents.value = [t].concat(torrents.value);
  return attachPoster(c, t.hash, hint).then((poster) => {
    if (poster) {
      patchPoster(t.hash, poster);
      refreshTorrents(c).catch(() => {});
    }
    return poster;
  });
}

const TRIED_KEY = 'tsp.posterTried';
let filling: Promise<FillResult | null> | null = null;

function patchPoster(hash: string, poster: string): void {
  torrents.value = torrents.value.map((x) => (x.hash === hash ? { ...x, poster } : x));
}

/**
 * Background lookup for torrents without a poster, e.g. added from the TorrServer page or Lampa.
 * Each torrent is tried once (remembered in `tsp.posterTried`); nothing happens without a TMDB key.
 */
export function autoFillPosters(c: PosterClient): Promise<FillResult | null> {
  if (filling) return filling;
  const tried = loadJson<unknown[]>(TRIED_KEY, [], Array.isArray).filter((h): h is string => typeof h === 'string');
  const seen: { [h: string]: boolean } = {};
  tried.forEach((h) => (seen[h] = true));
  filling = fillPosters(c, torrents.value, {
    skip: (h) => !!seen[h],
    onEach: (h, poster) => {
      if (poster) patchPoster(h, poster);
      seen[h] = true;
      tried.push(h);
      saveJson(TRIED_KEY, tried.slice(-500));
    },
  }).then(
    (r) => {
      filling = null;
      return r;
    },
    () => {
      filling = null;
      return null;
    },
  );
  return filling;
}

/** Explicit lookup for one torrent or for all without a poster (also the ones tried before). */
export function findPosters(
  c: PosterClient,
  list: Torrent[],
  onEach?: (hash: string, poster: string, done: number, total: number) => void,
): Promise<FillResult> {
  return fillPosters(c, list, {
    onEach: (h, poster, done, total) => {
      if (poster) patchPoster(h, poster);
      if (onEach) onEach(h, poster, done, total);
    },
  });
}

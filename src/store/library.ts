import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from './storage';
import type { Torrent } from '../api/types';
import type { LibraryTab } from '../lib/libraryView';
import { attachPoster, fillPosters, type FillResult, type PosterClient } from '../lib/autoPoster';
import { displayTitle } from '../lib/torrentName';
import { fixPlaceholderTitles, type TitleClient } from '../lib/titleFix';
import { fixCategories, type CategoryClient } from '../lib/categoryCheck';
import { t } from '../i18n';

const KEY = 'tsp.torrents';
const AT_KEY = 'tsp.torrentsAt';

export function sanitizeTime(v: unknown): number {
  return typeof v === 'number' && isFinite(v) && v > 0 && v <= Date.now() + 86400000 ? Math.floor(v) : 0;
}

export function sanitizeTorrents(v: unknown): Torrent[] {
  if (!Array.isArray(v)) return [];
  return v.filter((t): t is Torrent => isObject(t) && typeof t.hash === 'string');
}

export const torrents = signal<Torrent[]>(sanitizeTorrents(loadJson<unknown>(KEY, [], Array.isArray)));

// time of the last successful refresh (0 = unknown), kept next to the cached list
export const torrentsAt = signal<number>(sanitizeTime(loadJson<unknown>(AT_KEY, 0, (v): v is number => typeof v === 'number')));

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
  torrentsAt.value = 0;
  saveJson(AT_KEY, 0);
  libraryTab.value = 'all';
  librarySearchOpen.value = false;
  libraryQuery.value = '';
  saveJson(KEY, []);
}

/**
 * «infohash:…» titles get the name from the files, once per torrent; the shown list is patched when the server took it.
 */
export function repairTitles(c: TitleClient, list: Torrent[]): void {
  const my = gen;
  void fixPlaceholderTitles(c, list).then((done) => {
    if (my !== gen || !done.length) return;
    const by: { [h: string]: string } = {};
    done.forEach((d) => { by[d.hash] = d.title; });
    torrents.value = torrents.value.map((x) => (by[x.hash] ? { ...x, title: by[x.hash] } : x));
  });
}

/**
 * The automatic category check of the torrents not looked at yet (a «Фильмы» release with 18 episode files becomes
 * «Сериалы»); the shown list is patched when the server took it.
 */
export function checkCategories(c: CategoryClient, list: Torrent[]): Promise<void> {
  const my = gen;
  return fixCategories(c, list).then((done) => {
    if (my !== gen || !done.length) return;
    const by: { [h: string]: string } = {};
    done.forEach((d) => { by[d.hash] = d.category; });
    torrents.value = torrents.value.map((x) => (by[x.hash] !== undefined ? { ...x, category: by[x.hash] } : x));
  });
}

/** How the automatic category check writes (registered by store/journal: through its per-torrent write queue). */
export type CategoryWriter = (c: CategoryWriteClient, hash: string, category: string) => Promise<void>;
export interface CategoryWriteClient {
  list(): Promise<Torrent[]>;
  setData(t: Pick<Torrent, 'hash' | 'title' | 'poster' | 'category'>, data: string): Promise<void>;
}
let categoryWriter: CategoryWriter | null = null;

export function setCategoryWriter(w: CategoryWriter | null): void {
  categoryWriter = w;
}

export function refreshTorrents(c: { list(): Promise<Torrent[]> } & Partial<TitleClient> & Partial<CategoryWriteClient>): Promise<Torrent[]> {
  if (inflight) return inflight;
  const my = gen;
  inflight = c.list().then(
    (list) => {
      const sorted = list.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      if (my !== gen) return sorted;
      inflight = null;
      torrents.value = sorted;
      torrentsAt.value = Date.now();
      saveJson(AT_KEY, torrentsAt.value);
      saveJson(
        KEY,
        sorted.map((t) => ({
          hash: t.hash, title: t.title, category: t.category, poster: t.poster,
          torrent_size: t.torrent_size, data: t.data, stat: t.stat, timestamp: t.timestamp,
        })),
      );
      if (c.setTitle) repairTitles(c as TitleClient, sorted);
      const w = categoryWriter;
      if (w && c.setData) {
        const wc = c as CategoryWriteClient;
        void checkCategories({ setCategory: (tor, cat) => w(wc, tor.hash, cat) }, sorted);
      }
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
  if (added.length > 3) return t('library.addedMany', { n: added.length });
  return t('library.added', { titles: added.map((x) => displayTitle(x)).join(', ') });
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

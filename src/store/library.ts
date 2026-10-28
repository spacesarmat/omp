import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from './storage';
import type { Torrent } from '../api/types';
import type { LibraryTab } from '../lib/libraryView';
import { attachPoster, fillPosters, posterConfig, type FillResult, type PosterClient } from '../lib/autoPoster';
import type { TmdbConfig } from '../api/types';
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
/** A torrent the background lookup found nothing for is tried again after this long (TMDB gets new films). */
export const POSTER_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const TRIED_MAX = 500;
/**
 * The version of the poster search (findPoster). Raise it when the search finds more than before: the marks of the
 * older search are dropped, so every torrent without a poster is tried once more. 2: «ё» variants and the English
 * title from the release name (0.20.6-beta.10).
 */
export const POSTER_SEARCH_VERSION = 2;
let filling: Promise<FillResult | null> | null = null;

/**
 * `tsp.posterTried`: when each torrent was last tried, a fingerprint of the TMDB key it was tried with and the version
 * of the search (a new key or a newer search tries everything again). The fingerprint is a short hash, never the key.
 * The old format (a list of hashes) counts as tried long ago, so those torrents get one more try; marks without a
 * version are of version 1 (0.20.6-beta.9).
 */
export interface PosterTried {
  key: string;
  /** POSTER_SEARCH_VERSION of the search that made these marks */
  v: number;
  at: { [hash: string]: number };
}

/** A short non-reversible fingerprint of the TMDB key and API address (FNV-1a), to notice a changed key. */
export function tmdbKeyPrint(cfg: TmdbConfig | null | undefined): string {
  const s = (cfg && cfg.APIKey ? cfg.APIKey.trim() : '') + '|' + (cfg && cfg.APIURL ? cfg.APIURL.trim() : '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

export function loadPosterTried(): PosterTried {
  const raw = loadJson<unknown>(TRIED_KEY, null, () => true);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as { key?: unknown; v?: unknown; at?: unknown };
    const at: { [hash: string]: number } = {};
    if (o.at && typeof o.at === 'object') {
      const src = o.at as { [hash: string]: unknown };
      Object.keys(src).forEach((h) => {
        const v = src[h];
        if (typeof v === 'number' && isFinite(v)) at[h] = v;
      });
    }
    const v = typeof o.v === 'number' && isFinite(o.v) ? o.v : 1;
    return { key: typeof o.key === 'string' ? o.key : '', v: v, at: at };
  }
  // 0.20.6-beta.8 and older: the hashes only
  const at: { [hash: string]: number } = {};
  if (Array.isArray(raw)) raw.forEach((h) => { if (typeof h === 'string') at[h] = 0; });
  return { key: '', v: 0, at: at };
}

function savePosterTried(v: PosterTried): void {
  const hashes = Object.keys(v.at).sort((a, b) => v.at[b] - v.at[a]).slice(0, TRIED_MAX);
  const at: { [hash: string]: number } = {};
  hashes.forEach((h) => (at[h] = v.at[h]));
  saveJson(TRIED_KEY, { key: v.key, v: v.v, at: at });
}

/**
 * True when the background lookup should skip `hash`: tried with this key and this version of the search less than
 * POSTER_RETRY_MS ago.
 */
export function triedRecently(v: PosterTried, key: string, hash: string, now: number): boolean {
  if (v.key !== key || v.v !== POSTER_SEARCH_VERSION) return false;
  const at = v.at[hash];
  return typeof at === 'number' && at > 0 && now - at < POSTER_RETRY_MS;
}

function patchPoster(hash: string, poster: string): void {
  torrents.value = torrents.value.map((x) => (x.hash === hash ? { ...x, poster } : x));
}

/** The list after a poster choice: `poster` on each of `hashes` ('' clears it). */
export function patchPosters(hashes: string[], poster: string): void {
  const set: { [h: string]: boolean } = {};
  hashes.forEach((h) => (set[h] = true));
  torrents.value = torrents.value.map((x) => (set[x.hash] ? { ...x, poster } : x));
}

/**
 * Background lookup for torrents without a poster, e.g. added from the TorrServer page or Lampa.
 * Each torrent is tried once per POSTER_RETRY_MS and again when the TMDB key changes (remembered in
 * `tsp.posterTried`); nothing happens without a TMDB key.
 */
export function autoFillPosters(c: PosterClient, now: () => number = Date.now): Promise<FillResult | null> {
  if (filling) return filling;
  filling = posterConfig(c, undefined)
    .then((cfg) => {
      if (!cfg || !cfg.APIKey) return { tried: 0, found: 0, hasKey: false };
      const key = tmdbKeyPrint(cfg);
      const stored = loadPosterTried();
      // a new key or a newer search: the old marks are dropped, every torrent without a poster gets one more try
      const tried: PosterTried =
        stored.key === key && stored.v === POSTER_SEARCH_VERSION ? stored : { key: key, v: POSTER_SEARCH_VERSION, at: {} };
      const start = now();
      return fillPosters(c, torrents.value, {
        cfg: cfg,
        skip: (h) => triedRecently(tried, key, h, start),
        onEach: (h, poster) => {
          if (poster) patchPoster(h, poster);
          tried.at[h] = now();
          savePosterTried(tried);
        },
      });
    })
    .then(
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

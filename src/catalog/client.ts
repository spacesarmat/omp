// TMDB requests for «Обзор»: through SourceHttp, with a cache (memory + storage) and error codes.
// An error never carries the URL or the key; nothing here logs them.
// The stored cache (tsp.tmdbCache) shares the origin's localStorage with the monitoring stores, so it is bounded: at
// most MAX_ENTRIES entries and CACHE_BUDGET_CHARS characters of JSON, the least recently used evicted first; entries
// older than the longest TTL are dropped. Writes are debounced (SAVE_DELAY_MS). A write the storage refuses (quota)
// removes the key and the cache stays in memory only. One cache (memory map and debounced save) serves every
// client of the page; a hidden or closing page writes it at once.
import type { SourceHttp } from '../sources/types';
import { loadJson, isObject } from '../store/storage';
import { lang } from '../i18n';
import {
  releaseRegions, noveltiesUrl, discoverUrl, searchUrl, cardUrl, personUrl, personBioUrl, seasonUrl, sanitizeList, sanitizeCard, sanitizePerson, sanitizePersonBio, sanitizeSeason,
  type Kind, type CatalogTitle, type CatalogCard, type PersonCard, type SeasonDetails, type TmdbEndpoint,
} from './tmdb';
import { digitalSoonItems, type DiscoverQuery } from './discoverQuery';

export type CatalogErrorCode = 'offline' | 'nokey' | 'blocked' | 'bad';

export interface CatalogClient {
  novelties(kind: Kind | 'all', page: number): Promise<{ items: CatalogTitle[]; pages: number }>;
  /** «Обзор» with its sort and filters; 'all' merges a page of films and a page of series. */
  discover(kind: Kind | 'all', query: DiscoverQuery, page: number): Promise<{ items: CatalogTitle[]; pages: number }>;
  search(q: string, page: number): Promise<{ items: CatalogTitle[]; pages: number }>;
  card(kind: Kind, id: number, opts?: FetchOpts): Promise<CatalogCard>;
  /** A person with the filmography (cached like cards). */
  person(id: number, opts?: FetchOpts): Promise<PersonCard>;
  /** A season of a series with its episodes (cached like cards). */
  season(id: number, n: number, opts?: SeasonOpts): Promise<SeasonDetails>;
}

/**
 * `force`: fetched again even when cached (pull to refresh); `store: false`: kept out of the shared cache (bulk
 * lookups such as the «Обзор» tile labels keep their own small projection).
 */
export interface FetchOpts { force?: boolean; store?: boolean; }
/** `full`: the episode overviews are needed (a season restored from storage has none). */
export interface SeasonOpts extends FetchOpts { full?: boolean; }

export const CACHE_KEY = 'tsp.tmdbCache';
const LIST_TTL = 15 * 60 * 1000;
const CARD_TTL = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;
/** The stored JSON at most, in characters (Chromium keeps them as UTF-16: about 1 MB). */
export const CACHE_BUDGET_CHARS = 512 * 1024;
/** The memory cache at most: larger than the stored one (storage is the scarce part), still bounded. */
export const MEM_MAX_ENTRIES = 800;
export const MEM_BUDGET_CHARS = 4 * 1024 * 1024;
const SAVE_DELAY_MS = 2000;
/** «Скоро в цифре»: a page with fewer films than this is filled from the next region. */
export const DIGITAL_FILL_MIN = 10;
const TIMEOUT_MS = 15000;

/** `at`: fetched (the TTL counts from it); `used`: last served (the eviction order). */
interface Entry { at: number; used: number; data: unknown; }

// One cache for every client of the page (each «Обзор» visit makes a new client): one map, one debounced save of the
// whole map, so an older client can never write over newer answers.
let mem: { [k: string]: Entry } = {};
/** Serialized length of each entry with its key. */
let size: { [k: string]: number } = {};
let loaded = false;
let timer: ReturnType<typeof setTimeout> | null = null;
/** The storage refused a write: the cache stays in memory only for the rest of the page's life. */
let storageOff = false;
/** The clock of the last client that touched the cache (tests pass their own). */
let clock: () => number = function () { return Date.now(); };
let listening = false;

function put(key: string, e: Entry): void {
  mem[key] = e;
  size[key] = JSON.stringify(key).length + JSON.stringify(e).length + 1;
}

function drop(key: string): void {
  delete mem[key];
  delete size[key];
}

function load(): void {
  if (loaded) return;
  loaded = true;
  const stored = loadJson<{ [k: string]: Entry }>(CACHE_KEY, {}, isObject);
  Object.keys(stored).forEach((k) => {
    const v = stored[k];
    if (v && typeof v === 'object' && typeof v.at === 'number') put(k, { at: v.at, used: typeof v.used === 'number' ? v.used : v.at, data: v.data });
  });
}

/** Expired entries out of memory; then the least recently used until within the memory bounds. */
function evict(): void {
  const t = clock();
  Object.keys(mem).forEach((k) => {
    const at = mem[k].at;
    if (t - at >= CARD_TTL || t < at) drop(k);
  });
  const keys = Object.keys(mem).sort((x, y) => mem[y].used - mem[x].used);
  let total = 2;
  keys.forEach((k, i) => {
    if (i < MEM_MAX_ENTRIES && total + size[k] <= MEM_BUDGET_CHARS) total += size[k];
    else drop(k);
  });
}

/** A season as stored: without the episode overviews (only the title card shows them; it asks `full`). */
function storedData(key: string, data: unknown): unknown {
  if (key.indexOf('/season/') < 0 || !data || typeof data !== 'object') return data;
  const d = data as SeasonDetails;
  if (!Array.isArray(d.episodes)) return data;
  return { ...d, lite: true, episodes: d.episodes.map((e) => ({ n: e.n, title: e.title, airDate: e.airDate, runtime: e.runtime, overview: '' })) };
}

/** The stored part of the memory cache: the most recently used within MAX_ENTRIES and CACHE_BUDGET_CHARS. */
function storedPart(): { [k: string]: Entry } {
  const out: { [k: string]: Entry } = {};
  const keys = Object.keys(mem).sort((x, y) => mem[y].used - mem[x].used);
  let total = 2;
  let n = 0;
  keys.forEach((k) => {
    if (n >= MAX_ENTRIES) return;
    const e = mem[k];
    const entry: Entry = { at: e.at, used: e.used, data: storedData(k, e.data) };
    const len = JSON.stringify(k).length + JSON.stringify(entry).length + 1;
    if (total + len > CACHE_BUDGET_CHARS) return;
    total += len;
    n++;
    out[k] = entry;
  });
  return out;
}

function save(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (storageOff) return;
  evict();
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(storedPart()));
  } catch (e) {
    // storage full: the other stores need the room more; the cache goes on in memory
    storageOff = true;
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch (e2) {
      /* storage unavailable */
    }
  }
}

function scheduleSave(): void {
  if (storageOff || timer !== null) return;
  timer = setTimeout(save, SAVE_DELAY_MS);
}

/** A page going to the background or away may be killed: the pending write goes now. */
function listen(): void {
  if (listening) return;
  listening = true;
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushCatalogCache();
    });
    window.addEventListener('pagehide', function () {
      flushCatalogCache();
    });
  } catch (e) {
    /* no document (a worker): the debounced write still runs */
  }
}

/** The local calendar date YYYY-MM-DD: «Обзор» novelties are released up to the person's today, not UTC's. */
export function localDate(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
}

/** Writes the pending cache save now (a hidden or closing page; tests). */
export function flushCatalogCache(): void {
  if (timer !== null) save();
}

/** Tests: the pending save is written, then the memory is forgotten and read from storage again on the next client. */
export function resetCatalogCache(): void {
  flushCatalogCache();
  mem = {};
  size = {};
  loaded = false;
  storageOff = false;
}

function fail(code: CatalogErrorCode): Error {
  const e = new Error('catalog:' + code);
  (e as Error & { code?: string }).code = code;
  return e;
}

export function catalogErrorCode(e: unknown): CatalogErrorCode {
  const c = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined;
  return c === 'offline' || c === 'nokey' || c === 'blocked' || c === 'bad' ? c : 'bad';
}

/** The URL without the api_key parameter: the cache key (it keeps the language, so ru and en never mix). */
function cacheKeyOf(url: string): string {
  return url.replace(/([?&])api_key=[^&]*&?/, '$1').replace(/[?&]$/, '');
}

export function createCatalogClient(
  endpoint: TmdbEndpoint | null,
  http: SourceHttp,
  opts?: { now?: () => number; today?: () => string },
): CatalogClient {
  const now = opts && opts.now ? opts.now : function () { return Date.now(); };
  const today = opts && opts.today ? opts.today : function () { return localDate(now()); };
  clock = now;
  load();
  listen();

  function remember(key: string, data: unknown): void {
    clock = now;
    const t = now();
    put(key, { at: t, used: t, data: data });
    evict();
    scheduleSave();
  }

  /** The sanitized answer for the URL (only that is cached, never the raw body): from the cache while fresh, else fetched. */
  function fetchJson<T>(url: string, ttl: number, parse: (raw: unknown) => T, current?: (data: T) => boolean, o?: FetchOpts): Promise<T> {
    const key = cacheKeyOf(url);
    const hit = o && o.force ? undefined : mem[key];
    const store = !(o && o.store === false);
    // `current`: a stored answer of an older shape (fields added since) is fetched again
    if (hit && now() - hit.at < ttl && now() >= hit.at && (!current || current(hit.data as T))) {
      hit.used = now();
      clock = now;
      scheduleSave();
      return Promise.resolve(hit.data as T);
    }
    return http.get(url, { timeoutMs: TIMEOUT_MS }).then(
      (r) => {
        const s = r.status;
        if (!s) throw fail('offline');
        if (s === 401) throw fail('nokey');
        if (s === 403 || s === 451) throw fail('blocked');
        if (s < 200 || s >= 300) throw fail('bad');
        let data: unknown;
        try {
          data = JSON.parse(r.text);
        } catch (e) {
          throw fail('blocked');
        }
        const out = parse(data);
        if (store) remember(key, out);
        return out;
      },
      () => { throw fail('offline'); },
    );
  }

  function need(): TmdbEndpoint {
    if (!endpoint) throw fail('nokey');
    return endpoint;
  }

  /** A page of films and a page of series, interleaved. */
  function merge(r: { items: CatalogTitle[]; pages: number }[]): { items: CatalogTitle[]; pages: number } {
    const items: CatalogTitle[] = [];
    const len = Math.max(r[0].items.length, r[1].items.length);
    for (let i = 0; i < len; i++) {
      if (i < r[0].items.length) items.push(r[0].items[i]);
      if (i < r[1].items.length) items.push(r[1].items[i]);
    }
    return { items: items, pages: Math.max(r[0].pages, r[1].pages) };
  }

  function list(url: string, kind: Kind | null, dated?: boolean): Promise<{ items: CatalogTitle[]; pages: number }> {
    const e = need();
    return fetchJson(url, LIST_TTL, (raw) => sanitizeList(e, raw, kind, dated));
  }

  return {
    novelties(kind, page) {
      let e: TmdbEndpoint;
      try { e = need(); } catch (err) { return Promise.reject(err); }
      const d = today();
      if (kind !== 'all') return list(noveltiesUrl(e, kind, page, d), kind);
      return Promise.all([list(noveltiesUrl(e, 'movie', page, d), 'movie'), list(noveltiesUrl(e, 'tv', page, d), 'tv')]).then(merge);
    },
    discover(kind, query, page) {
      let e: TmdbEndpoint;
      try { e = need(); } catch (err) { return Promise.reject(err); }
      const d = today();
      const one = (k: Kind, region?: string) => {
        const u = discoverUrl(e, k, query, page, d, region);
        return u ? list(u, k, query.sort === 'digitalSoon') : Promise.resolve({ items: [] as CatalogTitle[], pages: 0 });
      };
      // «Скоро в цифре» is about films only: every kind chip shows films. TMDB knows few digital dates of some regions
      // (Russia): a thin page of the UI language's region is filled from the next region (the US), like the cards are.
      // Each item carries the digital date TMDB matched; the page keeps the dated ones within the window, by that date
      if (query.sort === 'digitalSoon') {
        const regions = releaseRegions();
        return one('movie', regions[0]).then((r) => {
          const own = { items: digitalSoonItems(r.items, d), pages: r.pages };
          if (own.items.length >= DIGITAL_FILL_MIN || regions.length < 2) return own;
          return one('movie', regions[1]).then(
            (more) => ({ items: digitalSoonItems(r.items.concat(more.items), d), pages: Math.max(r.pages, more.pages) }),
            () => own,
          );
        });
      }
      if (kind !== 'all') return one(kind);
      return Promise.all([one('movie'), one('tv')]).then(merge);
    },
    search(q, page) {
      let e: TmdbEndpoint;
      try { e = need(); } catch (err) { return Promise.reject(err); }
      return list(searchUrl(e, q, page), null);
    },
    card(kind, id, opts) {
      let e: TmdbEndpoint;
      try { e = need(); } catch (err) { return Promise.reject(err); }
      return fetchJson(cardUrl(e, kind, id), CARD_TTL, (raw) => {
        const c = sanitizeCard(e, raw, kind);
        if (!c) throw fail('bad');
        return c;
      }, (c) => (kind === 'tv' ? (c as { status?: unknown }).status !== undefined : (c as { releases?: unknown }).releases !== undefined)
        // cards cached before 0.19.0-beta.1 have people without a TMDB id
        && (c as CatalogCard).cast.every((p) => typeof p.id === 'number'), opts);
    },
    person(id, opts) {
      let e: TmdbEndpoint;
      try { e = need(); } catch (err) { return Promise.reject(err); }
      return fetchJson(personUrl(e, id), CARD_TTL, (raw) => {
        const p = sanitizePerson(e, raw);
        if (!p) throw fail('bad');
        return p;
        // persons cached before 0.19.0-beta.2 have no biography
      }, (p) => typeof (p as PersonCard).bio === 'string', opts).then((p) => {
        if (p.bio || lang.peek() === 'en') return p;
        // TMDB has no biography in the UI language: the English one, if it can be had
        return fetchJson(personBioUrl(e, id), CARD_TTL, sanitizePersonBio, undefined, opts).then(
          (bio) => (bio ? { ...p, bio: bio } : p),
          () => p,
        );
      });
    },
    season(id, n, opts) {
      let e: TmdbEndpoint;
      try { e = need(); } catch (err) { return Promise.reject(err); }
      const full = !!(opts && opts.full);
      return fetchJson(seasonUrl(e, id, n), CARD_TTL, (raw) => {
        const s = sanitizeSeason(raw, n);
        if (!s) throw fail('bad');
        return s;
      }, (s) => !full || !(s as { lite?: boolean }).lite, opts);
    },
  };
}

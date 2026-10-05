// TMDB requests for «Обзор»: through SourceHttp, with a cache (memory + storage) and error codes.
// An error never carries the URL or the key; nothing here logs them.
// The stored cache (tsp.tmdbCache) shares the origin's localStorage with the monitoring stores, so it is bounded: at
// most MAX_ENTRIES entries and CACHE_BUDGET_CHARS characters of JSON, the least recently used evicted first; entries
// older than the longest TTL are dropped. Writes are debounced (SAVE_DELAY_MS). A write the storage refuses (quota)
// removes the key and that client's cache stays in memory only.
import type { SourceHttp } from '../sources/types';
import { loadJson, isObject } from '../store/storage';
import {
  noveltiesUrl, searchUrl, cardUrl, seasonUrl, sanitizeList, sanitizeCard, sanitizeSeason,
  type Kind, type CatalogTitle, type CatalogCard, type SeasonDetails, type TmdbEndpoint,
} from './tmdb';

export type CatalogErrorCode = 'offline' | 'nokey' | 'blocked' | 'bad';

export interface CatalogClient {
  novelties(kind: Kind | 'all', page: number): Promise<{ items: CatalogTitle[]; pages: number }>;
  search(q: string, page: number): Promise<{ items: CatalogTitle[]; pages: number }>;
  card(kind: Kind, id: number): Promise<CatalogCard>;
  /** A season of a series with its episodes (cached like cards). */
  season(id: number, n: number): Promise<SeasonDetails>;
}

export const CACHE_KEY = 'tsp.tmdbCache';
const LIST_TTL = 15 * 60 * 1000;
const CARD_TTL = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;
/** The stored JSON at most, in characters (Chromium keeps them as UTF-16: about 1 MB). */
export const CACHE_BUDGET_CHARS = 512 * 1024;
const SAVE_DELAY_MS = 2000;
const TIMEOUT_MS = 15000;

/** `at`: fetched (the TTL counts from it); `used`: last served (the eviction order). */
interface Entry { at: number; used: number; data: unknown; }

/** Pending debounced saves, run by flushCatalogCache. */
const pending: Array<() => void> = [];

/** Runs the pending cache writes now (tests; a page about to close). */
export function flushCatalogCache(): void {
  const list = pending.splice(0, pending.length);
  list.forEach((save) => save());
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
  const today = opts && opts.today ? opts.today : function () { return new Date(now()).toISOString().slice(0, 10); };
  const mem: { [k: string]: Entry } = {};
  /** Serialized length of each entry with its key. */
  const size: { [k: string]: number } = {};
  const stored = loadJson<{ [k: string]: Entry }>(CACHE_KEY, {}, isObject);
  Object.keys(stored).forEach((k) => {
    const v = stored[k];
    if (v && typeof v === 'object' && typeof v.at === 'number') put(k, { at: v.at, used: typeof v.used === 'number' ? v.used : v.at, data: v.data });
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The storage refused a write: this client keeps its cache in memory only. */
  let storageOff = false;

  function put(key: string, e: Entry): void {
    mem[key] = e;
    size[key] = JSON.stringify(key).length + JSON.stringify(e).length + 1;
  }

  function drop(key: string): void {
    delete mem[key];
    delete size[key];
  }

  /** Expired entries out; then the least recently used until within MAX_ENTRIES and CACHE_BUDGET_CHARS. */
  function evict(): void {
    const t = now();
    let keys = Object.keys(mem);
    keys.forEach((k) => {
      const at = mem[k].at;
      if (t - at >= CARD_TTL || t < at) drop(k);
    });
    keys = Object.keys(mem).sort((a, b) => mem[b].used - mem[a].used);
    let total = 2;
    keys.forEach((k, i) => {
      if (i < MAX_ENTRIES && total + size[k] <= CACHE_BUDGET_CHARS) total += size[k];
      else drop(k);
    });
  }

  function save(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const i = pending.indexOf(save);
    if (i >= 0) pending.splice(i, 1);
    if (storageOff) return;
    evict();
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(mem));
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
    pending.push(save);
    timer = setTimeout(save, SAVE_DELAY_MS);
  }

  function remember(key: string, data: unknown): void {
    const t = now();
    put(key, { at: t, used: t, data: data });
    evict();
    scheduleSave();
  }

  /** The sanitized answer for the URL (only that is cached, never the raw body): from the cache while fresh, else fetched. */
  function fetchJson<T>(url: string, ttl: number, parse: (raw: unknown) => T): Promise<T> {
    const key = cacheKeyOf(url);
    const hit = mem[key];
    if (hit && now() - hit.at < ttl && now() >= hit.at) {
      hit.used = now();
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
        remember(key, out);
        return out;
      },
      () => { throw fail('offline'); },
    );
  }

  function need(): TmdbEndpoint {
    if (!endpoint) throw fail('nokey');
    return endpoint;
  }

  function list(url: string, kind: Kind | null): Promise<{ items: CatalogTitle[]; pages: number }> {
    const e = need();
    return fetchJson(url, LIST_TTL, (raw) => sanitizeList(e, raw, kind));
  }

  return {
    novelties(kind, page) {
      let e: TmdbEndpoint;
      try { e = need(); } catch (err) { return Promise.reject(err); }
      const d = today();
      if (kind !== 'all') return list(noveltiesUrl(e, kind, page, d), kind);
      return Promise.all([list(noveltiesUrl(e, 'movie', page, d), 'movie'), list(noveltiesUrl(e, 'tv', page, d), 'tv')]).then((r) => {
        const items: CatalogTitle[] = [];
        const len = Math.max(r[0].items.length, r[1].items.length);
        for (let i = 0; i < len; i++) {
          if (i < r[0].items.length) items.push(r[0].items[i]);
          if (i < r[1].items.length) items.push(r[1].items[i]);
        }
        return { items: items, pages: Math.max(r[0].pages, r[1].pages) };
      });
    },
    search(q, page) {
      let e: TmdbEndpoint;
      try { e = need(); } catch (err) { return Promise.reject(err); }
      return list(searchUrl(e, q, page), null);
    },
    card(kind, id) {
      let e: TmdbEndpoint;
      try { e = need(); } catch (err) { return Promise.reject(err); }
      return fetchJson(cardUrl(e, kind, id), CARD_TTL, (raw) => {
        const c = sanitizeCard(e, raw, kind);
        if (!c) throw fail('bad');
        return c;
      });
    },
    season(id, n) {
      let e: TmdbEndpoint;
      try { e = need(); } catch (err) { return Promise.reject(err); }
      return fetchJson(seasonUrl(e, id, n), CARD_TTL, (raw) => {
        const s = sanitizeSeason(raw, n);
        if (!s) throw fail('bad');
        return s;
      });
    },
  };
}

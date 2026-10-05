// TMDB requests for «Обзор»: through SourceHttp, with a cache (memory + storage) and error codes.
// An error never carries the URL or the key; nothing here logs them.
import type { SourceHttp } from '../sources/types';
import { loadJson, saveJson, isObject } from '../store/storage';
import {
  noveltiesUrl, searchUrl, cardUrl, sanitizeList, sanitizeCard,
  type Kind, type CatalogTitle, type CatalogCard, type TmdbEndpoint,
} from './tmdb';

export type CatalogErrorCode = 'offline' | 'nokey' | 'blocked' | 'bad';

export interface CatalogClient {
  novelties(kind: Kind | 'all', page: number): Promise<{ items: CatalogTitle[]; pages: number }>;
  search(q: string, page: number): Promise<{ items: CatalogTitle[]; pages: number }>;
  card(kind: Kind, id: number): Promise<CatalogCard>;
}

export const CACHE_KEY = 'tsp.tmdbCache';
const LIST_TTL = 15 * 60 * 1000;
const CARD_TTL = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;
const TIMEOUT_MS = 15000;

interface Entry { at: number; data: unknown; }

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
  const stored = loadJson<{ [k: string]: Entry }>(CACHE_KEY, {}, isObject);
  Object.keys(stored).forEach((k) => {
    const v = stored[k];
    if (v && typeof v === 'object' && typeof v.at === 'number') mem[k] = v;
  });

  function remember(key: string, data: unknown): void {
    mem[key] = { at: now(), data: data };
    const keys = Object.keys(mem);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => mem[a].at - mem[b].at);
      for (let i = 0; i < keys.length - MAX_ENTRIES; i++) delete mem[keys[i]];
    }
    saveJson(CACHE_KEY, mem);
  }

  /** The sanitized answer for the URL (only that is cached, never the raw body): from the cache while fresh, else fetched. */
  function fetchJson<T>(url: string, ttl: number, parse: (raw: unknown) => T): Promise<T> {
    const key = cacheKeyOf(url);
    const hit = mem[key];
    if (hit && now() - hit.at < ttl && now() >= hit.at) return Promise.resolve(hit.data as T);
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
  };
}

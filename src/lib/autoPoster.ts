import type { Torrent, TmdbConfig } from '../api/types';
import { request } from '../api/http';
import { posterQuery, tmdbSearchUrl, firstPoster } from './posterSearch';

export interface PosterClient {
  get(hash: string): Promise<Torrent>;
  tmdbSettings(): Promise<TmdbConfig | null>;
  setPoster(t: Pick<Torrent, 'hash' | 'title' | 'category'> & { name?: string }, poster: string): Promise<void>;
}

export interface PosterDeps {
  fetchJson?: (url: string) => Promise<unknown>;
  wait?: (ms: number) => Promise<void>;
  /** how many times to ask for the title while TorrServer reads the metadata */
  tries?: number;
  /** TMDB settings already read from the server (skips `/tmdb/settings`) */
  cfg?: TmdbConfig | null;
}

const fetchTmdb = (url: string) => request<unknown>(url, { method: 'GET', timeoutMs: 15000, quiet: true });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function getOrNull(c: PosterClient, hash: string): Promise<Torrent | null> {
  return c.get(hash).then(
    (t) => t || null,
    () => null,
  );
}

/**
 * Finds a poster on TMDB with the server's key and stores it on the torrent, like the TorrServer web page.
 * `hint` is a known title (search result, magnet `dn`); without it the title is awaited from the server.
 * Resolves to the poster URL, or '' when nothing was set (no key, already has a poster, nothing found).
 */
export function attachPoster(c: PosterClient, hash: string, hint: string, deps: PosterDeps = {}): Promise<string> {
  const fetchJson = deps.fetchJson || fetchTmdb;
  const wait = deps.wait || sleep;
  const tries = deps.tries === undefined ? 15 : deps.tries;
  const settings = deps.cfg !== undefined ? Promise.resolve(deps.cfg) : c.tmdbSettings();
  return settings
    .then((cfg) => {
      if (!cfg || !cfg.APIKey) return '';
      const named = (left: number): Promise<string> =>
        getOrNull(c, hash).then((t) => {
          if (t && t.poster) return '';
          const name = hint || (t && (t.title || t.name)) || '';
          if (name || left <= 1) return name;
          return wait(2000).then(() => named(left - 1));
        });
      return named(tries).then((name) => {
        const q = posterQuery(name);
        if (!q) return '';
        return fetchJson(tmdbSearchUrl(cfg, q)).then((r) => {
          const poster = firstPoster(cfg, r && (r as { results?: unknown }).results);
          if (!poster) return '';
          // re-read: the title may have arrived and the user may have set a poster meanwhile
          return getOrNull(c, hash).then((t) => {
            if (!t || t.poster) return '';
            return c.setPoster(t, poster).then(() => poster);
          });
        });
      });
    })
    .catch(() => '');
}

export interface FillResult {
  /** torrents without a poster that were tried */
  tried: number;
  /** posters found and stored */
  found: number;
  /** false when the server has no TMDB key */
  hasKey: boolean;
}

/**
 * Looks up posters, one torrent at a time, for every torrent in `list` that has none.
 * `skip` filters out torrents already tried; `onEach` reports each torrent once it is done.
 */
export function fillPosters(
  c: PosterClient,
  list: Torrent[],
  opts: { skip?: (hash: string) => boolean; onEach?: (hash: string, poster: string, done: number, total: number) => void } & PosterDeps = {},
): Promise<FillResult> {
  return c.tmdbSettings().then(
    (cfg) => {
      if (!cfg || !cfg.APIKey) return { tried: 0, found: 0, hasKey: false };
      const todo = list.filter((t) => !t.poster && (t.title || t.name) && !(opts.skip && opts.skip(t.hash)));
      let found = 0;
      const step = (i: number): Promise<FillResult> => {
        if (i >= todo.length) return Promise.resolve({ tried: todo.length, found, hasKey: true });
        const t = todo[i];
        return attachPoster(c, t.hash, t.title || t.name || '', { ...opts, cfg, tries: 1 }).then((poster) => {
          if (poster) found++;
          if (opts.onEach) opts.onEach(t.hash, poster, i + 1, todo.length);
          return step(i + 1);
        });
      };
      return step(0);
    },
    () => ({ tried: 0, found: 0, hasKey: false }),
  );
}

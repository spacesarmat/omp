import type { Torrent, TmdbConfig } from '../api/types';
import type { TmdbSettingsRead } from '../api/torrserver';
import { request } from '../api/http';
import { posterQuery, tmdbSearchRequest, firstPoster } from './posterSearch';
import { localTmdbSource, type TmdbSource } from '../catalog/localTmdb';
import { resolveTmdbKey } from '../catalog/resolveTmdb';
import { TMDB_FALLBACK_KEY } from '../catalog/fallbackKey';

export interface PosterClient {
  get(hash: string): Promise<Torrent>;
  tmdbSettings(): Promise<TmdbConfig | null>;
  setPoster(t: Pick<Torrent, 'hash' | 'title' | 'category'> & { name?: string }, poster: string): Promise<void>;
}

export interface PosterDeps {
  fetchJson?: (url: string, headers?: { [name: string]: string }) => Promise<unknown>;
  wait?: (ms: number) => Promise<void>;
  /** how many times to ask for the title while TorrServer reads the metadata */
  tries?: number;
  /** TMDB settings already read from the server (skips `/tmdb/settings`) */
  cfg?: TmdbConfig | null;
}

const fetchTmdb = (url: string, headers?: { [name: string]: string }) =>
  request<unknown>(url, { method: 'GET', timeoutMs: 15000, quiet: true, headers: headers });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function getOrNull(c: PosterClient, hash: string): Promise<Torrent | null> {
  return c.get(hash).then(
    (t) => t || null,
    () => null,
  );
}

function sourceOf(c: PosterClient): TmdbSource {
  const rich = c as PosterClient & { baseUrl?: string; readTmdbSettings?: () => Promise<TmdbSettingsRead> };
  if (typeof rich.readTmdbSettings === 'function') {
    const read = rich.readTmdbSettings;
    return { baseUrl: rich.baseUrl || '', readTmdbSettings: () => read.call(c) };
  }
  return {
    baseUrl: rich.baseUrl || '',
    readTmdbSettings: () =>
      c.tmdbSettings().then(
        (config) => ({ status: 'ok' as const, config: config || {} }),
        () => ({ status: 'unreachable' as const }),
      ),
  };
}

/** The key this poster lookup will use: this server, else the phone's TorrServer, else the built-in key. */
function posterConfig(c: PosterClient, preset: TmdbConfig | null | undefined): Promise<TmdbConfig | null> {
  if (preset !== undefined) return Promise.resolve(preset);
  return resolveTmdbKey({ active: sourceOf(c), fallbackKey: TMDB_FALLBACK_KEY }).then((r) => (r.status === 'ok' ? r.config : null));
}

/**
 * Finds a poster on TMDB and stores it on the torrent, like the TorrServer web page.
 * The key is the server's, else the phone's running TorrServer, else OMP's built-in key.
 * `hint` is a known title (search result, magnet `dn`); without it the title is awaited from the server.
 * Resolves to the poster URL, or '' when nothing was set (no key, already has a poster, nothing found).
 */
export function attachPoster(c: PosterClient, hash: string, hint: string, deps: PosterDeps = {}): Promise<string> {
  const fetchJson = deps.fetchJson || fetchTmdb;
  const wait = deps.wait || sleep;
  const tries = deps.tries === undefined ? 15 : deps.tries;
  const settings = posterConfig(c, deps.cfg);
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
        const req = tmdbSearchRequest(cfg, q);
        return fetchJson(req.url, req.headers).then((r) => {
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
  return posterConfig(c, opts.cfg).then(
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

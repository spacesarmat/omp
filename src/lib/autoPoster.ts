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
}

const fetchTmdb = (url: string) => request<unknown>(url, { method: 'GET', timeoutMs: 15000 });
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
  return c
    .tmdbSettings()
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

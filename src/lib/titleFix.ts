import type { Torrent } from '../api/types';
import { isPlaceholderTitle, deriveName, torrentFiles } from './torrentName';

export interface TitleClient {
  setTitle(t: Pick<Torrent, 'hash' | 'poster' | 'category'>, title: string): Promise<void>;
}

// hashes handled in this session: a written one is never touched again; a failed write is retried after RETRY_MS,
// at most MAX_TRIES times, so it does not run on every refresh
export const RETRY_MS = 10 * 60 * 1000;
export const MAX_TRIES = 3;
const tried: { [hash: string]: { at: number; n: number; ok: boolean } } = {};

export function resetTitleFix(): void {
  Object.keys(tried).forEach((k) => delete tried[k]);
}

/**
 * Gives torrents with a placeholder title («infohash:…») the name derived from their files, once per hash.
 * Real titles are never touched. Resolves with the titles that were written.
 */
export function fixPlaceholderTitles(c: TitleClient, list: Torrent[], now: number = Date.now()): Promise<{ hash: string; title: string }[]> {
  const todo: { t: Torrent; title: string }[] = [];
  list.forEach((t) => {
    const prev = tried[t.hash];
    if (prev && (prev.ok || prev.n >= MAX_TRIES || now - prev.at < RETRY_MS)) return;
    if (!isPlaceholderTitle(t.title, t.hash)) return;
    const title = deriveName(torrentFiles(t), '');
    if (!title) return;
    tried[t.hash] = { at: now, n: prev ? prev.n + 1 : 1, ok: false };
    todo.push({ t, title });
  });
  const done: { hash: string; title: string }[] = [];
  return todo
    .reduce(
      (p, x) =>
        p.then(() =>
          c.setTitle(x.t, x.title).then(
            () => {
              tried[x.t.hash].ok = true;
              done.push({ hash: x.t.hash, title: x.title });
            },
            () => undefined,
          ),
        ),
      Promise.resolve(),
    )
    .then(() => done);
}

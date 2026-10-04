import type { Torrent } from '../api/types';
import { isPlaceholderTitle, deriveName, torrentFiles } from './torrentName';

export interface TitleClient {
  setTitle(t: Pick<Torrent, 'hash' | 'poster' | 'category'>, title: string): Promise<void>;
}

// hashes already handled in this session: a failed write is not retried on every refresh
const tried: { [hash: string]: boolean } = {};

export function resetTitleFix(): void {
  Object.keys(tried).forEach((k) => delete tried[k]);
}

/**
 * Gives torrents with a placeholder title («infohash:…») the name derived from their files, once per hash.
 * Real titles are never touched. Resolves with the titles that were written.
 */
export function fixPlaceholderTitles(c: TitleClient, list: Torrent[]): Promise<{ hash: string; title: string }[]> {
  const todo: { t: Torrent; title: string }[] = [];
  list.forEach((t) => {
    if (tried[t.hash] || !isPlaceholderTitle(t.title, t.hash)) return;
    const title = deriveName(torrentFiles(t), '');
    if (!title) return;
    tried[t.hash] = true;
    todo.push({ t, title });
  });
  const done: { hash: string; title: string }[] = [];
  return todo
    .reduce(
      (p, x) =>
        p.then(() =>
          c.setTitle(x.t, x.title).then(
            () => { done.push({ hash: x.t.hash, title: x.title }); },
            () => undefined,
          ),
        ),
      Promise.resolve(),
    )
    .then(() => done);
}

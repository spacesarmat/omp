import type { Torrent } from '../api/types';
import { isPlaceholderTitle, deriveName, torrentFiles, displayTitle } from './torrentName';
import { cleanStoredTitle } from './libraryView';
import { rememberRawTitle } from './keptQuality';
import { nameLocked, parseData, serializeData, withReleaseMeta } from './journal';
import { enqueueTorrentWrite } from './dataQueue';

export interface TitleClient {
  setTitle(t: Pick<Torrent, 'hash' | 'poster' | 'category'>, title: string): Promise<void>;
  setData?(t: Pick<Torrent, 'hash' | 'title' | 'poster' | 'category'>, data: string): Promise<void>;
  list?(): Promise<Torrent[]>;
}

// hashes handled in this session: a written one is never touched again; a failed write is retried after RETRY_MS,
// at most MAX_TRIES times, so it does not run on every refresh
export const RETRY_MS = 10 * 60 * 1000;
export const MAX_TRIES = 3;
const tried: { [hash: string]: { at: number; n: number; ok: boolean } } = {};
const cleaned: { [hash: string]: { at: number; n: number; ok: boolean } } = {};

export function resetTitleFix(): void {
  Object.keys(tried).forEach((k) => delete tried[k]);
  Object.keys(cleaned).forEach((k) => delete cleaned[k]);
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

/**
 * Replaces a tracker title with the clean name, after the original string is stored on the torrent
 * (omp.rt) so quality and season checks still see it. A title the person typed (omp.nm) is left as it is.
 * Without setData, or when the data is not a JSON object, nothing is written.
 */
export function cleanReleaseTitles(c: TitleClient, list: Torrent[], now: number = Date.now()): Promise<{ hash: string; title: string; data: string }[]> {
  const todo: Torrent[] = [];
  if (!c.setData) return Promise.resolve([]);
  list.forEach((t) => {
    const prev = cleaned[t.hash];
    if (prev && (prev.ok || prev.n >= MAX_TRIES || now - prev.at < RETRY_MS)) return;
    if (nameLocked(t.data)) return;
    if (!cleanStoredTitle(t)) return;
    if (!parseData(t.data)) return;
    cleaned[t.hash] = { at: now, n: prev ? prev.n + 1 : 1, ok: false };
    todo.push(t);
  });
  const done: { hash: string; title: string; data: string }[] = [];
  return todo
    .reduce(
      (p, t) =>
        p.then(() =>
          enqueueTorrentWrite(t.hash, () => {
            if (nameLocked(t.data) || !c.setData) return Promise.resolve();
            const title = cleanStoredTitle(t);
            const parsed = parseData(t.data);
            if (!title || !parsed) return Promise.resolve();
            const raw = displayTitle(t);
            rememberRawTitle(t.hash, raw);
            const data = serializeData(withReleaseMeta(parsed.obj, raw, false), parsed.journal);
            return c.setData({ hash: t.hash, title: t.title || '', poster: t.poster, category: t.category }, data).then(() =>
              c.setTitle(t, title).then(() => {
                cleaned[t.hash].ok = true;
                done.push({ hash: t.hash, title, data });
              }),
            );
          }).then(
            () => undefined,
            () => undefined,
          ),
        ),
      Promise.resolve(),
    )
    .then(() => done);
}

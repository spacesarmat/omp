// «Заменить»: a newer release of a library series replaces the old torrent. The new one is added with the old one's
// category and poster, the watch journal (omp.h) is moved to it with the files matched by episode, together with the skip
// settings (omp.s), omp.w and every other key of `omp`; only then the old torrent is removed. Whatever fails before that,
// the old torrent stays and a torrent added by this call is taken back. Chromium 53 safe.
import type { Torrent } from '../api/types';
import { parseTorrentData } from '../api/torrserver';
import { baseName, episodeLabel, fileKind, parseEpisode, type TorrentFile } from '../lib/episodes';
import { JOURNAL_KEY, JOURNAL_MAX, JOURNAL_VERSION, parseData, serializeData, type JournalEntry } from '../lib/journal';
import { baseOf, type JournalClient } from '../store/journal';
import { torrents } from '../store/library';
import { resolveLink } from '../sources/view';
import type { SourceContext, SourceResult } from '../sources/types';

export interface ReplaceClient extends JournalClient {
  add(p: { link: string; title?: string; poster?: string; category?: string }): Promise<Torrent>;
  /** Activates the torrent and waits for its file list. */
  loadInfo(hash: string): Promise<Torrent>;
  remove(hash: string): Promise<void>;
}

export interface ReplaceOptions {
  /** How long to wait for the file list of the new torrent, ms (default 60000). */
  timeoutMs?: number;
  /**
   * Keep the title of the old torrent. By default the new torrent keeps the title TorrServer gave it from its metadata
   * (OMP cannot tell a title the user typed from the one the server made), so the title follows the release.
   */
  keepTitle?: boolean;
}

export type ReplaceResult = { ok: true; hash: string } | { ok: false; error: string };

const DEFAULT_TIMEOUT = 60000;

function sameHash(a: string, b: string): boolean {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function filesOf(t: Torrent): TorrentFile[] {
  return t.file_stats && t.file_stats.length ? t.file_stats : parseTorrentData(t.data);
}

function uniqueOf(list: TorrentFile[]): TorrentFile | null {
  return list.length === 1 ? list[0] : null;
}

/**
 * For each file of the old torrent, the id of the matching file of the new one (null: no match). Order: the label
 * «SxxEyy»; the episode number when one side has no season; the same file name; the same index, the last one only when
 * both torrents have the same number of files and the two files are not different episodes. Only files of the same kind
 * (video, audio, …) match, and a candidate must be unique at its step, otherwise the next step decides.
 */
export function mapFiles(oldFiles: TorrentFile[], newFiles: TorrentFile[]): { [oldId: number]: number | null } {
  const out: { [oldId: number]: number | null } = {};
  oldFiles.forEach((o) => {
    const kind = fileKind(o.path);
    const pool = newFiles.filter((n) => fileKind(n.path) === kind);
    const oe = parseEpisode(o.path);
    const label = episodeLabel(o.path);
    let hit: TorrentFile | null = null;
    if (label) {
      hit = uniqueOf(pool.filter((n) => episodeLabel(n.path) === label));
      if (!hit) {
        hit = uniqueOf(
          pool.filter((n) => {
            const ne = parseEpisode(n.path);
            return ne.episode === oe.episode && (oe.season === null || ne.season === null);
          }),
        );
      }
    }
    if (!hit) {
      const name = baseName(o.path).toLowerCase();
      hit = uniqueOf(pool.filter((n) => baseName(n.path).toLowerCase() === name));
    }
    if (!hit && oldFiles.length === newFiles.length) {
      const same = newFiles.filter((n) => n.id === o.id)[0];
      if (same && fileKind(same.path) === kind) {
        const nl = episodeLabel(same.path);
        if (!label || !nl || nl === label) hit = same;
      }
    }
    out[o.id] = hit ? hit.id : null;
  });
  return out;
}

/** The journal moved to the new file indices: unmapped entries dropped, one entry per slot (the newest), newest first. */
export function mapJournal(journal: JournalEntry[], map: { [oldId: number]: number | null }): JournalEntry[] {
  const out: JournalEntry[] = [];
  journal
    .slice()
    .sort((a, b) => b.at - a.at)
    .forEach((e) => {
      const f = map[e.f];
      if (f === null || f === undefined) return;
      const dup = out.filter((x) => x.f === f && x.src === e.src && (x.name || '') === (e.name || ''))[0];
      if (!dup) out.push({ ...e, f });
    });
  return out.slice(0, JOURNAL_MAX);
}

function plainObject(v: unknown): { [k: string]: unknown } | null {
  return v && typeof v === 'object' && !(v instanceof Array) ? (v as { [k: string]: unknown }) : null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** A failure with the text for the user (a rejection of anything else becomes the generic text). */
class Step {
  readonly msg: string;
  constructor(msg: string) {
    this.msg = msg;
  }
}

function stop(msg: string): Promise<never> {
  return Promise.reject(new Step(msg));
}

function find(all: Torrent[] | null | undefined, hash: string): Torrent | undefined {
  return (all || []).filter((x) => !!x && sameHash(x.hash, hash))[0];
}

/** Puts the new torrent where the old one was in the library list (the old one is dropped when `oldHash` is given). */
function swapInLibrary(oldHash: string, fresh: Torrent): void {
  let placed = false;
  const next: Torrent[] = [];
  torrents.value.forEach((t) => {
    if ((oldHash && sameHash(t.hash, oldHash)) || sameHash(t.hash, fresh.hash)) {
      if (!placed) next.push(fresh);
      placed = true;
    } else next.push(t);
  });
  if (!placed) next.unshift(fresh);
  torrents.value = next;
}

interface Prepared {
  done: Torrent;
}

/**
 * Replaces the library torrent `oldHash` by the release at `link`. Never rejects: `{ ok: true, hash }` of the new
 * torrent, or `{ ok: false, error }` (Russian); on a failure before the old torrent is removed it is untouched.
 */
export function replaceTorrent(c: ReplaceClient, oldHash: string, link: string, opts?: ReplaceOptions): Promise<ReplaceResult> {
  const timeoutMs = opts && opts.timeoutMs ? opts.timeoutMs : DEFAULT_TIMEOUT;
  const keepTitle = !!opts && !!opts.keepTitle;
  let added: Torrent | null = null;
  let preexisting = false;

  const undo = (): Promise<void> => {
    if (!added || preexisting) return Promise.resolve();
    const h = added.hash;
    added = null;
    return c.remove(h).then(
      () => undefined,
      () => undefined,
    );
  };

  const prepare = (old: Torrent, oldParsed: NonNullable<ReturnType<typeof parseData>>, all: Torrent[]): Promise<Prepared> =>
    c
      .add({ link, title: keepTitle ? old.title : '', poster: old.poster || '', category: old.category || '' })
      .then(
        (t) => t,
        () => stop('Не удалось добавить новую раздачу.'),
      )
      .then((t) => {
        if (!t || !t.hash) return stop('Сервер не принял новую раздачу.');
        if (sameHash(t.hash, old.hash)) return stop('Это та же раздача, заменять нечего.');
        // a torrent that was there before this call is never taken back
        preexisting = !!find(all, t.hash);
        added = t;
        return withTimeout(c.loadInfo(t.hash), timeoutMs).then(
          (info) => ({ t, info }),
          () => stop('Новая раздача не получила список файлов. Старая раздача осталась.'),
        );
      })
      .then((x) => {
        const newFiles = filesOf(x.info);
        if (!newFiles.length) return stop('В новой раздаче нет файлов. Старая раздача осталась.');
        // the list holds the torrent as the server stores it (its own `data`), the same source the journal writes read
        return c.list().then(
          (all2) => ({ info: x.info, listed: find(all2, x.t.hash) || { ...x.t, ...x.info }, newFiles }),
          () => ({ info: x.info, listed: { ...x.t, ...x.info } as Torrent, newFiles }),
        );
      })
      .then((x) => {
        const listed = x.listed;
        const newParsed = parseData(listed.data || x.info.data);
        if (!newParsed) return stop('Данные новой раздачи не удалось прочитать. Старая раздача осталась.');
        const base = baseOf({ ...listed, file_stats: listed.file_stats || x.newFiles } as Torrent, newParsed);
        const journal = mapJournal(oldParsed.journal, mapFiles(filesOf(old), x.newFiles));
        // everything of the old `omp` (skip settings, omp.w, keys of newer versions) goes over; the history is rebuilt
        const oldOmp = plainObject(oldParsed.obj[JOURNAL_KEY]);
        const newOmp = plainObject(base.obj[JOURNAL_KEY]);
        const obj: { [k: string]: unknown } = { ...base.obj };
        if (oldOmp || newOmp) obj[JOURNAL_KEY] = { ...(newOmp || {}), ...(oldOmp || {}), v: JOURNAL_VERSION };
        const skip = oldParsed.skip || base.skip;
        const title = (keepTitle ? old.title : '') || listed.title || listed.name || x.info.title || old.title;
        const poster = old.poster || listed.poster || '';
        const category = old.category || listed.category || '';
        const data = serializeData(obj, journal, skip);
        const done: Torrent = { ...listed, title, poster, category, data };
        const carried = !!oldOmp || journal.length > 0 || !!skip;
        const differs = (!!old.poster && listed.poster !== old.poster) || (keepTitle && listed.title !== title) || (category !== (listed.category || ''));
        if (!carried && !differs) return Promise.resolve({ done });
        return c.setData({ hash: listed.hash, title, poster, category }, data).then(
          () => ({ done }),
          () => stop('Не удалось перенести историю в новую раздачу. Старая раздача осталась.'),
        );
      });

  const run = (): Promise<ReplaceResult> =>
    c
      .list()
      .then(
        (all) => all,
        () => stop('Сервер недоступен.'),
      )
      .then((all) => {
        const old = find(all, oldHash);
        if (!old) return stop('Раздача не найдена на сервере.');
        const oldParsed = parseData(old.data);
        if (!oldParsed) return stop('Данные раздачи не удалось прочитать, замена отменена.');
        return prepare(old, oldParsed, all).then((p) =>
          c.remove(old.hash).then(
            (): ReplaceResult => {
              added = null;
              swapInLibrary(old.hash, p.done);
              return { ok: true, hash: p.done.hash };
            },
            (): ReplaceResult => {
              // both exist now and the history is on the new one: keep both and say so
              added = null;
              swapInLibrary('', p.done);
              return { ok: false, error: 'Новая раздача добавлена, но старую удалить не удалось.' };
            },
          ),
        );
      });

  return run().then(
    (r) => r,
    (e) => undo().then((): ReplaceResult => ({ ok: false, error: e instanceof Step ? e.msg : 'Не удалось заменить раздачу.' })),
  );
}

/** The same for a search result (its link is resolved like «Добавить» does). */
export function replaceWithResult(
  c: ReplaceClient,
  oldHash: string,
  result: SourceResult,
  ctx: SourceContext,
  opts?: ReplaceOptions,
): Promise<ReplaceResult> {
  return resolveLink(result, ctx).then(
    (link) => replaceTorrent(c, oldHash, link, opts),
    (e): ReplaceResult => ({ ok: false, error: e && typeof e.message === 'string' && e.message ? e.message : 'Не удалось получить ссылку на раздачу' }),
  );
}

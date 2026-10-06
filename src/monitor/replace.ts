// «Заменить»: a newer release of a library series replaces the old torrent. The new one is added with the old one's
// category and poster, the watch journal (omp.h) is moved to it with the files matched by episode, together with the skip
// settings (omp.s), omp.w and every other key of `omp`; only then the old torrent is removed. Whatever fails before that,
// the old torrent stays and a torrent added by this call is taken back. Chromium 53 safe.
import { t as tr } from '../i18n';
import type { Torrent } from '../api/types';
import { parseTorrentData } from '../api/torrserver';
import { isApiError } from '../api/http';
import { isLoginRequired } from '../sources/types';
import { baseName, episodeLabel, fileKind, parseEpisode, type TorrentFile } from '../lib/episodes';
import { JOURNAL_KEY, JOURNAL_MAX, JOURNAL_VERSION, parseData, serializeData, type JournalEntry } from '../lib/journal';
import { baseOf, type JournalClient } from '../store/journal';
import { torrents } from '../store/library';
import { resolveLink } from '../sources/view';
import type { SourceContext, SourceResult } from '../sources/types';
import { isPlaceholderTitle } from '../lib/torrentName';

export interface ReplaceClient extends JournalClient {
  add(p: { link: string; title?: string; poster?: string; category?: string }): Promise<Torrent>;
  /** Activates the torrent and waits for its file list. */
  loadInfo(hash: string): Promise<Torrent>;
  remove(hash: string): Promise<void>;
}

/** Why a replace failed: no data from TorrServer in time, the site wants a login, the link could not be had, the user stopped it, the old one could not be removed (both are kept), anything else. */
export type ReplaceCause = 'timeout' | 'login' | 'link' | 'cancelled' | 'both' | 'other';

/** «Отмена» of a running replace: it stops waiting and takes back the new torrent if one was added. */
export interface ReplaceAbort {
  readonly aborted: boolean;
  abort(): void;
  onAbort(fn: () => void): void;
}

export function replaceAbort(): ReplaceAbort {
  const fns: (() => void)[] = [];
  const a = {
    aborted: false,
    abort() {
      if (a.aborted) return;
      a.aborted = true;
      fns.splice(0).forEach((fn) => fn());
    },
    onAbort(fn: () => void) {
      if (a.aborted) fn();
      else fns.push(fn);
    },
  };
  return a;
}

export interface ReplaceOptions {
  /** How long to wait for the file list of the new torrent, ms (default 60000). */
  timeoutMs?: number;
  /**
   * The whole wait before the old torrent is removed, ms (absent: none). When it runs out the replace stops as a
   * timeout and the new torrent is taken back.
   */
  deadlineMs?: number;
  abort?: ReplaceAbort;
  /**
   * Title of the new release (the search result's Title). The old title is not carried: it holds the old episode range.
   * Without it the old torrent's title is used; the title is never empty.
   */
  title?: string;
}

export type ReplaceResult = { ok: true; hash: string } | { ok: false; error: string; cause?: ReplaceCause };

const BTIH = /xt=urn:btih:([0-9a-f]{40})(?![0-9a-z])/i;

/** The infohash a magnet link names (lowercase), '' for anything else. */
function linkHash(link: string): string {
  const m = BTIH.exec(link || '');
  return m ? m[1].toLowerCase() : '';
}

const DEFAULT_TIMEOUT = 60000;

/** The stored title of a torrent unless it is a placeholder («infohash:…»): the new one must not inherit that. */
function keptTitle(t: Torrent): string {
  return isPlaceholderTitle(t.title, t.hash) ? '' : t.title;
}

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
      // a labelled episode never goes to an unlabelled file (an extra, a sample) by index
      if (same && fileKind(same.path) === kind && !label && !episodeLabel(same.path)) hit = same;
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
  readonly cause: ReplaceCause;
  constructor(msg: string, cause?: ReplaceCause) {
    this.msg = msg;
    this.cause = cause || 'other';
  }
}

function stop(msg: string, cause?: ReplaceCause): Promise<never> {
  return Promise.reject(new Step(msg, cause));
}

function isTimeout(e: unknown): boolean {
  return isApiError(e) && e.kind === 'timeout';
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
  const newTitle = ((opts && opts.title) || '').trim();
  const abort = opts && opts.abort;
  const deadlineMs = opts && opts.deadlineMs ? opts.deadlineMs : 0;
  let added: Torrent | null = null;
  let preexisting = false;
  // the wait was stopped («Отмена» or the deadline): nothing goes on, a torrent added late is taken back
  let halted = false;
  // the old torrent is being removed: past this point the replace is not stopped any more
  let committing = false;

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
      .add({ link, title: newTitle || keptTitle(old), poster: old.poster || '', category: old.category || '' })
      .then(
        (t) => t,
        (e) => {
          // the add can time out here while TorrServer goes on and adds the magnet: take that one back too
          const h = linkHash(link);
          if (h && !find(all, h) && !sameHash(h, old.hash)) {
            preexisting = false;
            added = { hash: h } as Torrent;
          }
          return stop(tr('monitor.replace.addFailed'), isTimeout(e) ? 'timeout' : 'other');
        },
      )
      .then((t) => {
        if (!t || !t.hash) return stop(tr('monitor.replace.notAccepted'));
        if (sameHash(t.hash, old.hash)) return stop(tr('monitor.replace.sameTorrent'));
        // a torrent that was there before this call is never taken back
        preexisting = !!find(all, t.hash);
        added = t;
        if (halted) return stop(tr('monitor.replace.cancelledByUser'), 'cancelled');
        return withTimeout(c.loadInfo(t.hash), timeoutMs).then(
          (info) => ({ t, info }),
          () => stop(tr('monitor.replace.noFileList'), 'timeout'),
        );
      })
      .then((x) => {
        const newFiles = filesOf(x.info);
        if (!newFiles.length) return stop(tr('monitor.replace.noFiles'), 'timeout');
        // the list holds the torrent as the server stores it (its own `data`), the same source the journal writes read
        return c.list().then(
          (all2) => ({ info: x.info, listed: find(all2, x.t.hash) || { ...x.t, ...x.info }, newFiles, oldNow: find(all2, old.hash) || old }),
          () => ({ info: x.info, listed: { ...x.t, ...x.info } as Torrent, newFiles, oldNow: old }),
        );
      })
      .then((x) => {
        // the old torrent as it is now: playback may have written the journal while the new one was loading
        const oldP = parseData(x.oldNow.data);
        if (!oldP) return stop(tr('monitor.replace.oldUnreadable'));
        const oldFiles = filesOf(x.oldNow).length ? filesOf(x.oldNow) : filesOf(old);
        const needFiles = oldP.journal.length > 0 && !oldFiles.length;
        // the file list of the old torrent is needed to map its history: ask the server, never drop the history silently
        const files: Promise<TorrentFile[]> = needFiles
          ? withTimeout(c.loadInfo(old.hash), timeoutMs).then(
              (i) => filesOf(i),
              () => [],
            )
          : Promise.resolve(oldFiles);
        return files.then((of) => {
          if (needFiles && !of.length) return stop(tr('monitor.replace.oldFilesFailed'));
          return { ...x, oldP, oldFiles: of };
        });
      })
      .then((x) => {
        const listed = x.listed;
        const oldParsed = x.oldP;
        const newParsed = parseData(listed.data || x.info.data);
        if (!newParsed) return stop(tr('monitor.replace.newUnreadable'));
        const base = baseOf({ ...listed, file_stats: listed.file_stats || x.newFiles } as Torrent, newParsed);
        const journal = mapJournal(oldParsed.journal, mapFiles(x.oldFiles, x.newFiles));
        // everything of the old `omp` (skip settings, omp.w, keys of newer versions) goes over; the history is rebuilt
        const oldOmp = plainObject(oldParsed.obj[JOURNAL_KEY]);
        const newOmp = plainObject(base.obj[JOURNAL_KEY]);
        const obj: { [k: string]: unknown } = { ...base.obj };
        if (oldOmp || newOmp) obj[JOURNAL_KEY] = { ...(newOmp || {}), ...(oldOmp || {}), v: JOURNAL_VERSION };
        const skip = oldParsed.skip || base.skip;
        const title = newTitle || keptTitle(old) || listed.title || listed.name || x.info.title || '';
        const poster = old.poster || listed.poster || '';
        const category = old.category || listed.category || '';
        const data = serializeData(obj, journal, skip);
        const done: Torrent = { ...listed, title, poster, category, data };
        const carried = !!oldOmp || journal.length > 0 || !!skip;
        const differs = (!!old.poster && listed.poster !== old.poster) || (listed.title !== title) || (category !== (listed.category || ''));
        if (!carried && !differs) return Promise.resolve({ done });
        const failed = (): Promise<never> => stop(tr('monitor.replace.historyFailed'));
        // TorrServerClient.setData writes nothing for an empty title: that would lose the history
        if (!title) return failed();
        return c
          .setData({ hash: listed.hash, title, poster, category }, data)
          .then(() => c.list())
          .then(
            (all3) => {
              // the write must have reached the server (the journal of the stored copy is the one built here)
              const stored = find(all3, listed.hash);
              const back = stored ? parseData(stored.data) : null;
              if (!back || JSON.stringify(back.journal) !== JSON.stringify(journal)) return failed();
              return { done };
            },
            () => failed(),
          );
      });

  const run = (): Promise<ReplaceResult> =>
    c
      .list()
      .then(
        (all) => all,
        () => stop(tr('monitor.replace.serverDown')),
      )
      .then((all) => {
        const old = find(all, oldHash);
        if (!old) return stop(tr('monitor.replace.notFound'));
        const oldParsed = parseData(old.data);
        if (!oldParsed) return stop(tr('monitor.replace.cancelled'));
        return prepare(old, oldParsed, all).then((p) => {
          if (halted) return stop(tr('monitor.replace.cancelledByUser'), 'cancelled');
          committing = true;
          return c.remove(old.hash).then(
            (): ReplaceResult => {
              added = null;
              swapInLibrary(old.hash, p.done);
              return { ok: true, hash: p.done.hash };
            },
            (): ReplaceResult => {
              // both exist now and the history is on the new one: keep both and say so
              added = null;
              swapInLibrary('', p.done);
              return { ok: false, error: tr('monitor.replace.removeOldFailed'), cause: 'both' };
            },
          );
        });
      });

  const inner = run().then(
    (r) => r,
    (e) =>
      undo().then(
        (): ReplaceResult => ({
          ok: false,
          error: e instanceof Step ? e.msg : tr('monitor.replace.failed'),
          cause: e instanceof Step ? e.cause : 'other',
        }),
      ),
  );
  if (!abort && !deadlineMs) return inner;

  // «Отмена» or the deadline: stop waiting now, take back what was added (a late add is taken back by `prepare`)
  let timer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;
  const halt = new Promise<ReplaceResult>((resolve) => {
    const finish = (cause: ReplaceCause, error: string) => {
      if (settled || halted || committing) return;
      halted = true;
      undo().then(() => resolve({ ok: false, error, cause }));
    };
    if (abort) abort.onAbort(() => finish('cancelled', tr('monitor.replace.cancelledByUser')));
    if (deadlineMs) timer = setTimeout(() => finish('timeout', tr('monitor.replace.noFileList')), deadlineMs);
  });
  const done = inner.then((r) => {
    settled = true;
    return r;
  });
  return Promise.race([done, halt]).then((r) => {
    if (timer) clearTimeout(timer);
    return r;
  });
}

/** The same for a search result (its link is resolved like «Добавить» does). */
export function replaceWithResult(
  c: ReplaceClient,
  oldHash: string,
  result: SourceResult,
  ctx: SourceContext,
  opts?: ReplaceOptions,
): Promise<ReplaceResult> {
  const ab = opts && opts.abort;
  const cancelled = (): ReplaceResult => ({ ok: false, error: tr('monitor.replace.cancelledByUser'), cause: 'cancelled' });
  // «Отмена» while the site is asked for the link: nothing was added yet
  const link: Promise<string | null> = ab
    ? Promise.race([resolveLink(result, ctx), new Promise<null>((resolve) => ab.onAbort(() => resolve(null)))])
    : resolveLink(result, ctx);
  return link.then(
    (l) =>
      l === null || (ab && ab.aborted)
        ? cancelled()
        : replaceTorrent(c, oldHash, l, { ...(opts || {}), title: (opts && opts.title) || result.Title }),
    (e): ReplaceResult => ({
      ok: false,
      error: e && typeof e.message === 'string' && e.message ? e.message : tr('monitor.replace.noLink'),
      cause: isLoginRequired(e) ? 'login' : 'link',
    }),
  );
}

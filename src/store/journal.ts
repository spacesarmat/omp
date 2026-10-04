// Writes the watch journal (src/lib/journal.ts) to TorrServer. Writes of one torrent are chained, each one reads
// the torrent list first (another device may have written meanwhile) and every failure is swallowed: the journal must
// never break playback.
import type { Torrent } from '../api/types';
import { addEntry, parseData, removeFile, serializeData, type JournalEntry, type ParsedData, sanitizeSkip, type SkipPrefs, watchesNewEpisodes, withWatch, supportOfList, withSupport, journalOf } from '../lib/journal';
import { torrents } from './library';
import { noteSupport } from './support';
import { SUPPORT_MAX_AHEAD_MS } from '../lib/donate';

export interface JournalClient {
  list(): Promise<Torrent[]>;
  setData(t: Pick<Torrent, 'hash' | 'title' | 'poster' | 'category'>, data: string): Promise<void>;
}

const chains: { [hash: string]: Promise<void> } = {};

/** Runs `job` after the pending writes of the same torrent; never rejects. */
function enqueue(hash: string, job: () => Promise<void>): Promise<void> {
  const prev = chains[hash] || Promise.resolve();
  const next = prev.then(job).then(
    () => undefined,
    () => undefined,
  );
  chains[hash] = next;
  next.then(() => {
    if (chains[hash] === next) delete chains[hash];
  });
  return next;
}

/** Keeps the library copy in step, so «История» shows the write without waiting for the next refresh. */
function patchLibrary(hash: string, data: string): void {
  const list = torrents.value;
  for (let i = 0; i < list.length; i++) {
    if (list[i].hash === hash) {
      const copy = list.slice();
      copy[i] = { ...list[i], data };
      torrents.value = copy;
      return;
    }
  }
}

/** Data with an empty `data` seeded by TorrServer's own file list, which it would otherwise add itself later. */
export function baseOf(t: Torrent, parsed: ParsedData): ParsedData {
  if (t.data && t.data.trim()) return parsed;
  if (!t.file_stats || !t.file_stats.length) return parsed;
  const files = t.file_stats.map((f) => ({ id: f.id, path: f.path, length: f.length }));
  return { obj: { TorrServer: { Files: files } }, journal: parsed.journal, skip: parsed.skip };
}

function update(c: JournalClient, hash: string, change: (j: JournalEntry[]) => JournalEntry[]): Promise<void> {
  return enqueue(hash, () =>
    c.list().then((all) => {
      // from the list (not `get`, which activates an idle torrent and may answer from a stale copy)
      const t = (all || []).filter((x) => !!x && String(x.hash).toLowerCase() === hash.toLowerCase())[0];
      if (!t) return undefined;
      const parsed = parseData(t.data);
      if (!parsed) return undefined; // not JSON: someone else's data, never touched
      const base = baseOf(t, parsed);
      const next = change(base.journal);
      if (JSON.stringify(next) === JSON.stringify(base.journal)) return undefined;
      const data = serializeData(base.obj, next, base.skip);
      return c.setData(t, data).then(() => patchLibrary(t.hash, data));
    }),
  );
}

/** Records «watched `entry.f` up to `entry.t`» now; resolves when written or failed (never rejects). */
export function recordWatch(c: JournalClient | null, hash: string, entry: Omit<JournalEntry, 'at'>, now?: number): Promise<void> {
  if (!c || !hash) return Promise.resolve();
  return update(c, hash, (j) => addEntry(j, entry, now === undefined ? Date.now() : now));
}

/** «Убрать из истории»: drops every entry of the file (shown right away, written in the background). */
export function forgetWatch(c: JournalClient | null, hash: string, f: number): Promise<void> {
  const t = torrents.value.filter((x) => x.hash === hash)[0];
  const local = t ? parseData(t.data) : null;
  if (local && local.journal.some((e) => e.f === f)) patchLibrary(hash, serializeData(local.obj, removeFile(local.journal, f), local.skip));
  if (!c || !hash) return Promise.resolve();
  return update(c, hash, (j) => removeFile(j, f));
}

function torrentOf(all: Torrent[] | null | undefined, hash: string): Torrent | undefined {
  return (all || []).filter((x) => !!x && String(x.hash).toLowerCase() === hash.toLowerCase())[0];
}

/** Skip settings of a torrent; defaults (everything off) when there are none or the torrent is unknown. */
export function loadSkip(c: Pick<JournalClient, 'list'>, hash: string): Promise<SkipPrefs> {
  return c.list().then((all) => {
    noteSupport(all); // the TV player hides the «Поддержать» card for a supporter
    const t = torrentOf(all, hash);
    const p = t ? parseData(t.data) : null;
    return (p && p.skip) || { i: false, c: false };
  });
}

export type SkipPatch = Partial<Omit<SkipPrefs, 'mi' | 'mc'>> & { mi?: [number, number] | null; mc?: number | null };

function applyPatch(cur: SkipPrefs, patch: SkipPatch): SkipPrefs {
  const out: SkipPrefs = { i: patch.i === undefined ? cur.i : patch.i, c: patch.c === undefined ? cur.c : patch.c };
  const mi = patch.mi === undefined ? cur.mi : patch.mi;
  const mc = patch.mc === undefined ? cur.mc : patch.mc;
  if (mi) out.mi = mi;
  if (mc) out.mc = mc;
  // the same checks as reading: a bad mark (end before start, zero, NaN) is dropped, never written
  return sanitizeSkip(out) || { i: out.i, c: out.c };
}

/**
 * Merges `patch` into the skip settings of a torrent (null removes a mark) and writes them, keeping the history and every
 * other key of `data`. Unlike the history writes it rejects on failure, so the UI can show the error.
 */
export function saveSkip(c: JournalClient, torrent: Pick<Torrent, 'hash'>, patch: SkipPatch): Promise<SkipPrefs> {
  const hash = torrent.hash;
  const prev = chains[hash] || Promise.resolve();
  const run = prev.then(() =>
    c.list().then((all) => {
      const t = torrentOf(all, hash);
      if (!t) throw new Error('Раздачи нет на сервере');
      const parsed = parseData(t.data);
      if (!parsed) throw new Error('Данные раздачи не в формате JSON — OMP их не меняет');
      const base = baseOf(t, parsed);
      const next = applyPatch(base.skip || { i: false, c: false }, patch);
      if (base.skip && JSON.stringify(next) === JSON.stringify(base.skip)) return next;
      const data = serializeData(base.obj, base.journal, next);
      return c.setData(t, data).then(() => {
        patchLibrary(t.hash, data);
        return next;
      });
    }),
  );
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  chains[hash] = tail;
  tail.then(() => {
    if (chains[hash] === tail) delete chains[hash];
  });
  return run;
}

/** «Следить за новыми сериями» of a torrent (omp.w); true when nothing is stored or the torrent is unknown. */
export function loadWatch(c: Pick<JournalClient, 'list'>, hash: string): Promise<boolean> {
  return c.list().then((all) => {
    const t = torrentOf(all, hash);
    return t ? watchesNewEpisodes(t.data) : true;
  });
}

/**
 * Switches watching new episodes of a torrent: false writes omp.w: false, true removes it; the history, the skip
 * settings and every other key of `data` are kept. Rejects on failure, like saveSkip.
 */
export function saveWatch(c: JournalClient, torrent: Pick<Torrent, 'hash'>, watch: boolean): Promise<boolean> {
  const hash = torrent.hash;
  const prev = chains[hash] || Promise.resolve();
  const run = prev.then(() =>
    c.list().then((all) => {
      const t = torrentOf(all, hash);
      if (!t) throw new Error('Раздачи нет на сервере');
      const parsed = parseData(t.data);
      if (!parsed) throw new Error('Данные раздачи не в формате JSON — OMP их не меняет');
      if (watchesNewEpisodes(t.data) === watch) return watch;
      const base = baseOf(t, parsed);
      const data = serializeData(withWatch(base.obj, watch), base.journal, base.skip);
      return c.setData(t, data).then(() => {
        patchLibrary(t.hash, data);
        return watch;
      });
    }),
  );
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  chains[hash] = tail;
  tail.then(() => {
    if (chains[hash] === tail) delete chains[hash];
  });
  return run;
}

/** Last watch-journal activity of a torrent (0: never played through OMP). */
function lastActivity(data: string | undefined): number {
  const j = journalOf(data);
  return j.length ? j[0].at : 0;
}

/**
 * Support code applied on a phone: makes sure the server carries `omp.d.until` ≥ `until` (the TVs read the latest
 * one among all torrents). Nothing is written when some torrent already has it (marks further ahead than a code can
 * reach do not count). Otherwise one torrent gets it, keeping the history, the skip settings and every other key of
 * `data`: the one played least recently (then the oldest), because TorrServer has no compare-and-swap and the torrent
 * being watched is the one a TV rewrites on pause and stop. The write is checked with a fresh list and retried once if
 * a concurrent write lost it. Resolves true when the server has the mark afterwards, false when there was nowhere to
 * write or the write failed (never rejects).
 */
export function saveSupport(c: JournalClient, until: number, now: number = Date.now()): Promise<boolean> {
  const ceiling = Math.max(now + SUPPORT_MAX_AHEAD_MS, until);
  const has = (all: Torrent[] | null | undefined) => supportOfList(all, ceiling) >= until;
  const attempt = (left: number): Promise<boolean> =>
    c.list().then((all) => {
      const list = (all || []).filter((x) => !!x && typeof x.hash === 'string');
      if (has(list)) return true;
      const target = list
        .filter((x) => parseData(x.data) !== null)
        .map((x) => ({ t: x, at: lastActivity(x.data) }))
        .sort((a, b) => a.at - b.at || (a.t.timestamp || 0) - (b.t.timestamp || 0))[0];
      if (!target) return false;
      const hash = target.t.hash;
      return enqueue(hash, () =>
        c.list().then((fresh) => {
          const cur = torrentOf(fresh, hash);
          const parsed = cur ? parseData(cur.data) : null;
          if (!cur || !parsed || has(fresh)) return undefined;
          const base = baseOf(cur, parsed);
          const data = serializeData(withSupport(base.obj, until), base.journal, base.skip);
          return c.setData(cur, data).then(() => patchLibrary(cur.hash, data));
        }),
      )
        // read back: another device may have rewritten the torrent at the same moment (or the write failed)
        .then(() => c.list().then(has, () => false))
        .then((ok) => ok || (left > 0 ? attempt(left - 1) : false));
    }, () => false);
  return attempt(1);
}

// Writes the watch journal (src/lib/journal.ts) to TorrServer. Writes of one torrent are chained, each one reads
// the torrent first (another device may have written meanwhile) and every failure is swallowed: the journal must
// never break playback.
import type { Torrent } from '../api/types';
import { addEntry, parseData, removeFile, serializeData, type JournalEntry, type ParsedData } from '../lib/journal';
import { torrents } from './library';

export interface JournalClient {
  get(hash: string): Promise<Torrent>;
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
function baseOf(t: Torrent, parsed: ParsedData): ParsedData {
  if (t.data && t.data.trim()) return parsed;
  if (!t.file_stats || !t.file_stats.length) return parsed;
  const files = t.file_stats.map((f) => ({ id: f.id, path: f.path, length: f.length }));
  return { obj: { TorrServer: { Files: files } }, journal: parsed.journal };
}

function update(c: JournalClient, hash: string, change: (j: JournalEntry[]) => JournalEntry[]): Promise<void> {
  return enqueue(hash, () =>
    c.get(hash).then((t) => {
      if (!t || t.hash !== hash) return undefined;
      const parsed = parseData(t.data);
      if (!parsed) return undefined; // not JSON: someone else's data, never touched
      const base = baseOf(t, parsed);
      const next = change(base.journal);
      if (JSON.stringify(next) === JSON.stringify(base.journal)) return undefined;
      const data = serializeData(base.obj, next);
      return c.setData(t, data).then(() => patchLibrary(hash, data));
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
  if (local && local.journal.some((e) => e.f === f)) patchLibrary(hash, serializeData(local.obj, removeFile(local.journal, f)));
  if (!c || !hash) return Promise.resolve();
  return update(c, hash, (j) => removeFile(j, f));
}

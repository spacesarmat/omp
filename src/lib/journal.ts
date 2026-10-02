// Watch journal kept on TorrServer in the torrent `data` JSON under the key `omp`:
// { "omp": { "v": 1, "h": [ { f, t, d, at, src, name? } ] } }, newest first, at most JOURNAL_MAX entries,
// one entry per file + source (+ device name). Every other key of `data` belongs to other clients
// (TorrServer's own file list, Lampa, …) and is kept as is; a `data` that is not a JSON object is never touched.

export type JournalSrc = 'tv' | 'phone';

export interface JournalEntry {
  /** File index. */
  f: number;
  /** Position, seconds. */
  t: number;
  /** Duration, seconds (0: unknown). */
  d: number;
  /** Unix ms. */
  at: number;
  src: JournalSrc;
  /** Device name (phones); absent for the TV. */
  name?: string;
}

export interface ParsedData {
  obj: { [k: string]: unknown };
  journal: JournalEntry[];
}

export const JOURNAL_KEY = 'omp';
export const JOURNAL_VERSION = 1;
export const JOURNAL_MAX = 20;
export const NAME_MAX = 60;

function isPlainObject(v: unknown): v is { [k: string]: unknown } {
  return !!v && typeof v === 'object' && !(v instanceof Array);
}

function finiteNum(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

/** A stored entry, or null when it is malformed. */
export function sanitizeEntry(v: unknown): JournalEntry | null {
  if (!isPlainObject(v)) return null;
  const f = finiteNum(v.f);
  const at = finiteNum(v.at);
  if (f === null || f < 0 || Math.floor(f) !== f || at === null || at <= 0) return null;
  if (v.src !== 'tv' && v.src !== 'phone') return null;
  const t = finiteNum(v.t);
  const d = finiteNum(v.d);
  const e: JournalEntry = { f, t: t !== null && t > 0 ? t : 0, d: d !== null && d > 0 ? d : 0, at, src: v.src };
  if (typeof v.name === 'string') {
    const name = v.name.trim().slice(0, NAME_MAX);
    if (name) e.name = name;
  }
  return e;
}

function readJournal(v: unknown): JournalEntry[] {
  if (!isPlainObject(v) || v.v !== JOURNAL_VERSION || !(v.h instanceof Array)) return [];
  const out: JournalEntry[] = [];
  for (let i = 0; i < v.h.length; i++) {
    const e = sanitizeEntry(v.h[i]);
    if (e) out.push(e);
  }
  out.sort((a, b) => b.at - a.at);
  return out.slice(0, JOURNAL_MAX);
}

/**
 * Splits a torrent `data`: the whole object and the OMP journal in it. Empty data gives an empty object;
 * null when the data is not a JSON object (the journal must then never be written).
 */
export function parseData(data: string | undefined | null): ParsedData | null {
  if (!data || !data.trim()) return { obj: {}, journal: [] };
  let v: unknown;
  try {
    v = JSON.parse(data);
  } catch (e) {
    return null;
  }
  if (!isPlainObject(v)) return null;
  return { obj: v, journal: readJournal(v[JOURNAL_KEY]) };
}

/** The journal of a torrent (empty when there is none or the data is not OMP-readable). */
export function journalOf(data: string | undefined | null): JournalEntry[] {
  const p = parseData(data);
  return p ? p.journal : [];
}

function sameSlot(a: JournalEntry, f: number, src: JournalSrc, name: string): boolean {
  return a.f === f && a.src === src && (a.name || '') === name;
}

/** Adds (or moves up and updates) the entry for its file + source + name; newest first, at most JOURNAL_MAX. */
export function addEntry(journal: JournalEntry[], entry: Omit<JournalEntry, 'at'>, now: number): JournalEntry[] {
  const fresh = sanitizeEntry({ f: entry.f, t: entry.t, d: entry.d, src: entry.src, name: entry.name, at: now });
  if (!fresh) return journal.slice(0, JOURNAL_MAX);
  const name = fresh.name || '';
  const rest = journal.filter((e) => !sameSlot(e, fresh.f, fresh.src, name));
  return [fresh].concat(rest).slice(0, JOURNAL_MAX);
}

/** Drops every entry of a file. */
export function removeFile(journal: JournalEntry[], f: number): JournalEntry[] {
  return journal.filter((e) => e.f !== f);
}

/** The data string with the journal put back under `omp`; every other key of `obj` is kept. */
export function serializeData(obj: { [k: string]: unknown }, journal: JournalEntry[]): string {
  const out: { [k: string]: unknown } = {};
  Object.keys(obj).forEach((k) => {
    if (k !== JOURNAL_KEY) out[k] = obj[k];
  });
  out[JOURNAL_KEY] = { v: JOURNAL_VERSION, h: journal.slice(0, JOURNAL_MAX) };
  return JSON.stringify(out);
}

// Watch journal kept on TorrServer in the torrent `data` JSON under the key `omp`:
// { "omp": { "v": 1, "h": [ { f, t, d, at, src, name? } ], "s"?: SkipPrefs } }, newest first, at most JOURNAL_MAX entries,
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

/** Skip settings of a torrent (key `s` of the journal object): auto-skip flags and manual marks. */
export interface SkipPrefs {
  /** Auto-skip the intro. */
  i: boolean;
  /** Auto-skip the credits. */
  c: boolean;
  /** Manual intro: [start, end] seconds. */
  mi?: [number, number];
  /** Manual credits: the last N seconds. */
  mc?: number;
  /** Watch for new episodes (monitoring): stored only as false («Не следить»); absent = watch. */
  w?: boolean;
}

/** New episodes of the torrent are watched: true unless «Следить за новыми сериями» was switched off (s.w false). */
export function watchesNewEpisodes(skip: SkipPrefs | null | undefined): boolean {
  return !skip || skip.w !== false;
}

export interface ParsedData {
  obj: { [k: string]: unknown };
  journal: JournalEntry[];
  skip: SkipPrefs | null;
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

/** Stored skip settings, or null when absent or not an object; malformed parts fall back to defaults. */
export function sanitizeSkip(v: unknown): SkipPrefs | null {
  if (!isPlainObject(v)) return null;
  const out: SkipPrefs = { i: v.i === true, c: v.c === true };
  const mi = v.mi;
  if (mi instanceof Array && mi.length === 2) {
    const a = finiteNum(mi[0]);
    const b = finiteNum(mi[1]);
    if (a !== null && b !== null && a >= 0 && b > a) out.mi = [a, b];
  }
  const mc = finiteNum(v.mc);
  if (mc !== null && mc > 0) out.mc = mc;
  if (v.w === false) out.w = false;
  return out;
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
  if (!data || !data.trim()) return { obj: {}, journal: [], skip: null };
  let v: unknown;
  try {
    v = JSON.parse(data);
  } catch (e) {
    return null;
  }
  if (!isPlainObject(v)) return null;
  const o = v[JOURNAL_KEY];
  return { obj: v, journal: readJournal(o), skip: isPlainObject(o) ? sanitizeSkip(o.s) : null };
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

/**
 * The data string with the journal put back under `omp`; every other key of `obj` is kept. `skip`: undefined keeps
 * the skip settings already in `obj`, null removes them, a value replaces them.
 */
export function serializeData(obj: { [k: string]: unknown }, journal: JournalEntry[], skip?: SkipPrefs | null): string {
  const out: { [k: string]: unknown } = {};
  Object.keys(obj).forEach((k) => {
    if (k !== JOURNAL_KEY) out[k] = obj[k];
  });
  const old = obj[JOURNAL_KEY];
  const keep = skip === undefined ? (isPlainObject(old) ? sanitizeSkip(old.s) : null) : skip;
  const omp: { [k: string]: unknown } = {};
  // keys a newer OMP may add to the journal object survive this version's writes
  if (isPlainObject(old)) Object.keys(old).forEach((k) => {
    if (k !== 'v' && k !== 'h' && k !== 's') omp[k] = old[k];
  });
  omp.v = JOURNAL_VERSION;
  omp.h = journal.slice(0, JOURNAL_MAX);
  if (keep) omp.s = keep;
  out[JOURNAL_KEY] = omp;
  return JSON.stringify(out);
}

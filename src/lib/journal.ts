// Watch journal kept on TorrServer in the torrent `data` JSON under the key `omp`:
// { "omp": { "v": 1, "h": [ { f, t, d, at, src, name? } ], "s"?: SkipPrefs, "w"?: false, "d"?: { until } } }, newest first, at most JOURNAL_MAX entries,
// one entry per file + source (+ device name). Every other key of `data` belongs to other clients
// (TorrServer's own file list, Lampa, …) and is kept as is; a `data` that is not a JSON object is never touched.
// `w: false` (v0.13) = don't watch for new episodes; a top-level `omp` key, so v0.12 clients keep it (they drop unknown
// fields inside `s`).
// `cm: true` (v0.17) = the category was picked by hand: the automatic category check never changes it.
// `ca` (v0.17) = the category the automatic check set itself: only that (or an empty one) may be corrected again.
// `q: false` (v0.17) = don't watch the film for a better release («Следить за качеством» off); a top-level `omp` key like `w`.
// `a: { at, l?, g?, s?, k? }` (v0.19) = the series' default dub («Озвучка») picked by hand in a player; the newest one
// among the torrents of a series wins (src/lib/seriesTracks.ts).
// `d: { until }` (v0.14.1) = a support code was applied on a phone: the TVs hide the «Поддержать» card until then
// (Unix ms). Only the end time is ever written, never the code; any torrent of the server may carry it, the latest wins.

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
}

/** Support mark of the journal (key `d`): prompts to donate are hidden until `until` (Unix ms). */
export interface SupportMark {
  until: number;
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
  return out;
}

/** The support mark (key `d`): { until } with a positive Unix ms time; null when absent or malformed. */
export function sanitizeSupport(v: unknown): SupportMark | null {
  if (!isPlainObject(v)) return null;
  const until = finiteNum(v.until);
  return until !== null && until > 0 ? { until: Math.floor(until) } : null;
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
  // the support mark as well (fields a newer OMP may add to it included); only `until` is normalised, and only when
  // valid — a mark this version cannot read is left as it is
  const support = isPlainObject(old) ? sanitizeSupport(old.d) : null;
  if (support) omp.d = { ...(old as { d: { [k: string]: unknown } }).d, until: support.until };
  omp.v = JOURNAL_VERSION;
  omp.h = journal.slice(0, JOURNAL_MAX);
  if (keep) omp.s = keep;
  out[JOURNAL_KEY] = omp;
  return JSON.stringify(out);
}

/** New episodes of the torrent are watched: true unless «Следить за новыми сериями» was switched off (omp.w false). */
export function watchesNewEpisodes(data: string | undefined | null): boolean {
  const p = parseData(data);
  if (!p) return true;
  const o = p.obj[JOURNAL_KEY];
  return !(isPlainObject(o) && o.w === false);
}

/** A copy of `obj` with omp.w set (false) or removed (true); write it with serializeData. */
export function withWatch(obj: { [k: string]: unknown }, watch: boolean): { [k: string]: unknown } {
  const out: { [k: string]: unknown } = { ...obj };
  const old = obj[JOURNAL_KEY];
  const omp: { [k: string]: unknown } = isPlainObject(old) ? { ...old } : { v: JOURNAL_VERSION, h: [] };
  if (watch) delete omp.w;
  else omp.w = false;
  out[JOURNAL_KEY] = omp;
  return out;
}

/** Better releases of the film are watched: true unless «Следить за качеством» was switched off (omp.q false). */
export function watchesBetterQuality(data: string | undefined | null): boolean {
  const p = parseData(data);
  if (!p) return true;
  const o = p.obj[JOURNAL_KEY];
  return !(isPlainObject(o) && o.q === false);
}

/** A copy of `obj` with omp.q set (false) or removed (true); write it with serializeData. */
export function withQualityWatch(obj: { [k: string]: unknown }, watch: boolean): { [k: string]: unknown } {
  const out: { [k: string]: unknown } = { ...obj };
  const old = obj[JOURNAL_KEY];
  const omp: { [k: string]: unknown } = isPlainObject(old) ? { ...old } : { v: JOURNAL_VERSION, h: [] };
  if (watch) delete omp.q;
  else omp.q = false;
  out[JOURNAL_KEY] = omp;
  return out;
}

/** The category was picked by hand (omp.cm true): the automatic category check leaves it. */
export function categoryPicked(data: string | undefined | null): boolean {
  const p = parseData(data);
  if (!p) return false;
  const o = p.obj[JOURNAL_KEY];
  return isPlainObject(o) && o.cm === true;
}

/** A copy of `obj` with omp.cm set (true) or removed (false); write it with serializeData. */
export function withCategoryPicked(obj: { [k: string]: unknown }, picked: boolean): { [k: string]: unknown } {
  const out: { [k: string]: unknown } = { ...obj };
  const old = obj[JOURNAL_KEY];
  const omp: { [k: string]: unknown } = isPlainObject(old) ? { ...old } : { v: JOURNAL_VERSION, h: [] };
  if (picked) omp.cm = true;
  else delete omp.cm;
  out[JOURNAL_KEY] = omp;
  return out;
}

/** The category OMP set itself (omp.ca), or null when it never did. */
export function categoryAuto(data: string | undefined | null): string | null {
  const p = parseData(data);
  if (!p) return null;
  const o = p.obj[JOURNAL_KEY];
  return isPlainObject(o) && typeof o.ca === 'string' ? o.ca : null;
}

/** A copy of `obj` with omp.ca (the category OMP set); write it with serializeData. */
export function withCategoryAuto(obj: { [k: string]: unknown }, category: string): { [k: string]: unknown } {
  const out: { [k: string]: unknown } = { ...obj };
  const old = obj[JOURNAL_KEY];
  const omp: { [k: string]: unknown } = isPlainObject(old) ? { ...old } : { v: JOURNAL_VERSION, h: [] };
  omp.ca = category;
  out[JOURNAL_KEY] = omp;
  return out;
}

/** `omp.d.until` of a torrent's data; 0 when there is none. */
export function supportOf(data: string | undefined | null): number {
  const p = parseData(data);
  const o = p ? p.obj[JOURNAL_KEY] : null;
  const d = isPlainObject(o) ? sanitizeSupport(o.d) : null;
  return d ? d.until : 0;
}

/**
 * The latest `omp.d.until` among the torrents of a server (0: none). Marks later than `ceiling` (a bogus far-future
 * value) are ignored before taking the latest, so that one cannot hide a valid mark.
 */
export function supportOfList(list: { data?: string }[] | null | undefined, ceiling: number = Infinity): number {
  let max = 0;
  (list || []).forEach((t) => {
    if (!t) return;
    const u = supportOf(t.data);
    if (u > max && u <= ceiling) max = u;
  });
  return max;
}

/** A copy of `obj` with omp.d set to { until }; write it with serializeData. */
export function withSupport(obj: { [k: string]: unknown }, until: number): { [k: string]: unknown } {
  const out: { [k: string]: unknown } = { ...obj };
  const old = obj[JOURNAL_KEY];
  const omp: { [k: string]: unknown } = isPlainObject(old) ? { ...old } : { v: JOURNAL_VERSION, h: [] };
  omp.d = { ...(isPlainObject(omp.d) ? omp.d : {}), until: Math.floor(until) };
  out[JOURNAL_KEY] = omp;
  return out;
}

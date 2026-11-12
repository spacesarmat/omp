// Manual pause and the check log of one subscription. The free-cap pause stays in limit.ts.
import { loadJson, saveJson } from '../../../src/store/storage';

const HOLD_KEY = 'tsp.subHold';
const LOG_KEY = 'tsp.subChecks';
const LOG_MAX = 8;

interface CheckRow {
  n: number;
  at: number[];
}

function ids(key: string): string[] {
  const raw = loadJson<unknown>(key, [], Array.isArray);
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => typeof x === 'string' && x.length > 0);
}

export function isSubHeld(id: string): boolean {
  return ids(HOLD_KEY).indexOf(id) >= 0;
}

export function setSubHeld(id: string, on: boolean): void {
  const cur = ids(HOLD_KEY).filter((x) => x !== id);
  saveJson(HOLD_KEY, on ? cur.concat([id]) : cur);
}

function rowOf(v: unknown): CheckRow {
  if (Array.isArray(v)) {
    const at = v.filter((n) => typeof n === 'number' && isFinite(n)).slice(0, LOG_MAX);
    return { n: at.length, at };
  }
  if (!v || typeof v !== 'object') return { n: 0, at: [] };
  const raw = v as { n?: unknown; at?: unknown };
  const at = Array.isArray(raw.at) ? raw.at.filter((n) => typeof n === 'number' && isFinite(n)).slice(0, LOG_MAX) : [];
  const n = typeof raw.n === 'number' && isFinite(raw.n) ? Math.max(0, Math.floor(raw.n)) : at.length;
  return { n: Math.max(n, at.length), at };
}

function logs(): { [id: string]: CheckRow } {
  const raw = loadJson<unknown>(LOG_KEY, {}, (v) => !!v && typeof v === 'object' && !Array.isArray(v));
  const out: { [id: string]: CheckRow } = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.keys(raw as object).forEach((id) => {
    out[id] = rowOf((raw as { [k: string]: unknown })[id]);
  });
  return out;
}

export function checkCount(id: string): number {
  return (logs()[id] || { n: 0, at: [] }).n;
}

/** Newest checks first, at most the stored eight. The total can be higher: see checkCount. */
export function checkTimes(id: string): number[] {
  return (logs()[id] || { n: 0, at: [] }).at.slice();
}

export function rememberCheck(id: string, at: number): void {
  const all = logs();
  const prev = all[id] || { n: 0, at: [] };
  all[id] = { n: prev.n + 1, at: [at].concat(prev.at).slice(0, LOG_MAX) };
  saveJson(LOG_KEY, all);
}

export function withoutHeld<T extends { id: string }>(list: T[]): T[] {
  return list.filter((s) => !isSubHeld(s.id));
}

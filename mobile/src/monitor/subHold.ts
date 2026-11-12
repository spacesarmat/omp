// Manual pause and the check log of one subscription. The free-cap pause stays in limit.ts.
import { loadJson, saveJson } from '../../../src/store/storage';

const HOLD_KEY = 'tsp.subHold';
const LOG_KEY = 'tsp.subChecks';
const LOG_MAX = 8;

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

function logs(): { [id: string]: number[] } {
  const raw = loadJson<unknown>(LOG_KEY, {}, (v) => !!v && typeof v === 'object' && !Array.isArray(v));
  const out: { [id: string]: number[] } = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.keys(raw as object).forEach((id) => {
    const list = (raw as { [k: string]: unknown })[id];
    if (!Array.isArray(list)) return;
    out[id] = list.filter((n) => typeof n === 'number' && isFinite(n)).slice(0, LOG_MAX);
  });
  return out;
}

export function checkLog(id: string): number[] {
  return logs()[id] || [];
}

export function rememberCheck(id: string, at: number): void {
  const all = logs();
  const prev = all[id] || [];
  all[id] = [at].concat(prev).slice(0, LOG_MAX);
  saveJson(LOG_KEY, all);
}

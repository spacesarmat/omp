// First launch of this install. The phone's donate card and the catalog ads share the key, so moving the
// clock here does not reset a phone that already stored it.
import { loadJson, saveJson } from '../store/storage';

export const FIRST_RUN_KEY = 'tsp.firstRun';

const isTime = (v: unknown): v is number => typeof v === 'number' && isFinite(v) && v > 0;

/** First-run time; an install from before this feature gets it now. */
export function ensureFirstRun(now: number = Date.now()): number {
  const stored = loadJson<unknown>(FIRST_RUN_KEY, null, isTime);
  if (isTime(stored)) return stored;
  saveJson(FIRST_RUN_KEY, now);
  return now;
}

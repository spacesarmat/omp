import { lunaCall } from './luna';
import { LG_DEVMODE_APP_ID, DEVMODE_HOURS, REMINDER_BEFORE_HOURS } from '../lib/installPlan';
import { loadJson, saveJson } from '../store/storage';

const HOUR = 3600 * 1000;
const EXTEND_AT_KEY = 'omp.devmode.extendAt';

/**
 * webOS does not expose the real Developer Mode expiry to apps, so the TV keeps a proxy:
 * the last time the 1000-hour window was (re)started from OMP, or the first launch.
 */
export function devmodeExtendAt(now: number): number {
  const saved = loadJson<number>(EXTEND_AT_KEY, 0, (v) => typeof v === 'number' && isFinite(v) && v > 0);
  if (saved) return saved;
  saveJson(EXTEND_AT_KEY, now);
  return now;
}

/** True once the proxy window has 3 days or less left - the same lead as the phone reminder. */
export function devmodeExpiring(now: number): boolean {
  return now >= devmodeExtendAt(now) + (DEVMODE_HOURS - REMINDER_BEFORE_HOURS) * HOUR;
}

export function openDevMode(): Promise<void> {
  return lunaCall('luna://com.webos.applicationManager/launch', { id: LG_DEVMODE_APP_ID }).then(() => undefined);
}

/** Opens Developer Mode and restarts the proxy window on success: the user is expected to press Extend there. */
export function extendDevMode(now: number): Promise<void> {
  return openDevMode().then(() => { saveJson(EXTEND_AT_KEY, now); });
}
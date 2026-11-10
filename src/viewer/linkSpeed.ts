// Last measured download speed, so the next search can weigh file size. Chromium 53 safe.
import { loadJson, saveJson } from '../store/storage';

const KEY = 'tsp.linkSpeed';

export function noteLinkSpeed(bps: number): void {
  if (!(bps >= 50 * 1024) || !isFinite(bps)) return;
  const prev = lastLinkSpeed();
  const next = prev > 0 ? Math.round(prev * 0.5 + bps * 0.5) : Math.round(bps);
  saveJson(KEY, { bps: next });
}

export function lastLinkSpeed(): number {
  const v = loadJson<{ bps?: number }>(KEY, {}, (x): x is { bps?: number } => !!x && typeof x === 'object');
  const n = v && typeof v.bps === 'number' ? v.bps : 0;
  return n > 0 && isFinite(n) ? n : 0;
}

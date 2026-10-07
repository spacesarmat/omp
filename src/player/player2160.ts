// Android TV: «Плеер для видео» = 2160 Player. The queue goes to the player (OmpNative.open2160, Task 6) with the
// resume position and the «Пропуск» marks; where the user stopped (maybe on another item of the playlist) is saved
// like the built-in players' progress (local + TorrServer /viewed).
import type { TorrServerClient } from '../api/torrserver';
import type { OmpNativeTvPlugin } from '../platform/androidNative';
import type { SkipPrefs } from '../lib/journal';
import { MIN_RESUME, markWatched } from '../store/progress';
import { saveItemProgress } from './progressSave';
import { itemHeading } from './heading';
import type { PlayItem } from './types';
import { t } from '../i18n';

export const P2160_RELEASES_URL = 'https://github.com/spacesarmat/2160player/releases/latest';

export interface P2160Result {
  /** false: the player handed nothing back. */
  returned: boolean;
  positionMs?: number;
  durationMs?: number;
  ended?: boolean;
  /** The item the user stopped at. */
  url?: string;
}

/** The installed 2160 Player package, null when it is missing or the plugin cannot tell. */
export function p2160Package(plugin: Pick<OmpNativeTvPlugin, 'player2160'> | null): Promise<string | null> {
  if (!plugin || typeof plugin.player2160 !== 'function') return Promise.resolve(null);
  return Promise.resolve().then(() => plugin.player2160!()).then(
    (r) => (r && typeof r.package === 'string' && r.package ? r.package : null),
    () => null,
  );
}

/** The Intent extra of the «Пропуск» marks: intro:<s>-<e>;credits:<s>- (ms); credits only when the duration is known. */
export function segmentsText(prefs: SkipPrefs | null, durationSec: number): string {
  const out: string[] = [];
  if (prefs && prefs.mi) out.push('intro:' + Math.round(prefs.mi[0] * 1000) + '-' + Math.round(prefs.mi[1] * 1000));
  if (prefs && prefs.mc && prefs.mc > 0 && durationSec > 0 && durationSec > prefs.mc) {
    out.push('credits:' + Math.round((durationSec - prefs.mc) * 1000) + '-');
  }
  return out.join(';');
}

function nonNegative(v: unknown): number | undefined {
  return typeof v === 'number' && isFinite(v) && v >= 0 ? v : undefined;
}

/** Only well-typed fields of the plugin's answer. */
export function sanitizeP2160(r: unknown): P2160Result {
  const o = (r && typeof r === 'object' ? r : {}) as { [k: string]: unknown };
  if (o.returned !== true) return { returned: false };
  const out: P2160Result = { returned: true, ended: o.ended === true };
  const pos = nonNegative(o.positionMs);
  const dur = nonNegative(o.durationMs);
  if (pos !== undefined) out.positionMs = pos;
  if (dur !== undefined) out.durationMs = dur;
  if (typeof o.url === 'string' && o.url) out.url = o.url;
  return out;
}

/** Saves what the player handed back: the end marks the item watched, a position of MIN_RESUME or more is kept. */
export function saveP2160Result(
  c: TorrServerClient | null,
  queue: PlayItem[],
  startIndex: number,
  r: P2160Result,
  knownDuration: number,
): void {
  if (!r.returned) return;
  let item = queue[startIndex];
  if (r.url) {
    const hit = queue.find((i) => i.url === r.url || (c ? c.videoSrc(i.url) === r.url : false));
    if (hit) item = hit;
  }
  if (!item || !item.hash || item.fileIndex === undefined) return;
  const hash = item.hash;
  const idx = item.fileIndex;
  const known = item === queue[startIndex] ? knownDuration : 0;
  const dur = r.durationMs !== undefined && r.durationMs > 0 ? r.durationMs / 1000 : known;
  if (r.ended) {
    if (dur > 0) saveItemProgress(c, item, dur, dur, true);
    else {
      markWatched(hash, idx);
      if (c) c.setViewed(hash, idx, 0).catch(() => undefined);
    }
    return;
  }
  const pos = r.positionMs !== undefined ? r.positionMs / 1000 : 0;
  if (pos < MIN_RESUME) return;
  if (dur > 0) saveItemProgress(c, item, pos, dur, true);
  // no duration anywhere: only the server's resume point can be kept
  else if (c) c.setViewed(hash, idx, Math.floor(pos)).catch(() => undefined);
}

let busy = false;

/**
 * Opens the queue in 2160 Player from `startAt` seconds (below MIN_RESUME: from the start) and saves the position it
 * hands back. A call while one is open does nothing; rejects with the plugin's (native, translated) error.
 */
export function play2160(
  plugin: Pick<OmpNativeTvPlugin, 'open2160'>,
  c: TorrServerClient | null,
  queue: PlayItem[],
  index: number,
  startAt: number,
  prefs: SkipPrefs | null,
  knownDuration: number,
): Promise<void> {
  if (busy) return Promise.resolve();
  const open = plugin.open2160;
  if (typeof open !== 'function') return Promise.reject(new Error(t('nativePlayer.unavailable')));
  busy = true;
  const fromStart = startAt < MIN_RESUME;
  const o = {
    items: queue.map((i) => ({ url: c ? c.videoSrc(i.url) : i.url, title: itemHeading(i) })),
    start: index,
    positionMs: fromStart ? 0 : Math.floor(startAt) * 1000,
    fromStart,
    segments: segmentsText(prefs, knownDuration),
  };
  return Promise.resolve().then(() => open.call(plugin, o)).then(
    (raw) => {
      busy = false;
      saveP2160Result(c, queue, index, sanitizeP2160(raw), knownDuration);
    },
    (e) => {
      busy = false;
      throw e;
    },
  );
}

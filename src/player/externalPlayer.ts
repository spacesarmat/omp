// Android TV: "in another player" (the torrent screen's button and the native player's menu row). The stream opens in
// the chooser of installed players (OmpNative.openPlayer, MX Player compatible) at the resume position; the position
// the player hands back is saved like the built-in players' (local + TorrServer /viewed).
import type { TorrServerClient } from '../api/torrserver';
import type { OmpNativeTvPlugin } from '../platform/androidNative';
import { MIN_RESUME, markWatched } from '../store/progress';
import { saveItemProgress } from './progressSave';
import { itemHeading } from './heading';
import type { PlayItem } from './types';
import { t } from '../i18n';

export interface ExternalPlayerResult {
  /** false: the player handed nothing back (VLC without its extras, a cancelled chooser). */
  returned: boolean;
  positionMs?: number;
  durationMs?: number;
  ended?: boolean;
}

function nonNegative(v: unknown): number | undefined {
  return typeof v === 'number' && isFinite(v) && v >= 0 ? v : undefined;
}

/** Only well-typed fields of the plugin's answer. */
export function sanitizeExternalResult(r: unknown): ExternalPlayerResult {
  const o = (r && typeof r === 'object' ? r : {}) as { [k: string]: unknown };
  if (o.returned !== true) return { returned: false };
  const out: ExternalPlayerResult = { returned: true, ended: o.ended === true };
  const pos = nonNegative(o.positionMs);
  const dur = nonNegative(o.durationMs);
  if (pos !== undefined) out.positionMs = pos;
  if (dur !== undefined) out.durationMs = dur;
  return out;
}

/** Saves what the player handed back: the end marks the item watched, a position of MIN_RESUME or more is kept. */
export function saveExternalResult(c: TorrServerClient | null, item: PlayItem, r: ExternalPlayerResult, knownDuration: number): void {
  if (!r.returned || !item.hash || item.fileIndex === undefined) return;
  const hash = item.hash;
  const idx = item.fileIndex;
  const dur = r.durationMs !== undefined && r.durationMs > 0 ? r.durationMs / 1000 : knownDuration;
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

/** True while a chooser / another player is open (a second press waits for it). */
export function externalPlayerBusy(): boolean {
  return busy;
}

/**
 * Opens `item` in another player from `at` seconds (below MIN_RESUME: from the start) and saves the position it
 * hands back. A press while one is open does nothing (resolves false); rejects with the plugin's (native,
 * translated) error when no player could be opened.
 */
export function openInOtherPlayer(
  plugin: OmpNativeTvPlugin,
  c: TorrServerClient | null,
  item: PlayItem,
  at: number,
  knownDuration = 0,
): Promise<boolean> {
  if (busy) return Promise.resolve(false);
  const open = plugin.openPlayer;
  if (typeof open !== 'function') return Promise.reject(new Error(t('nativePlayer.unavailable')));
  busy = true;
  const start = at >= MIN_RESUME ? Math.floor(at) : 0;
  const url = c ? c.videoSrc(item.url) : item.url;
  const o = { url, title: itemHeading(item), positionMs: start * 1000, mime: 'video/*' };
  return Promise.resolve().then(() => open.call(plugin, o)).then(
    (raw) => {
      busy = false;
      saveExternalResult(c, item, sanitizeExternalResult(raw), knownDuration);
      return true;
    },
    (e) => {
      busy = false;
      throw e;
    },
  );
}

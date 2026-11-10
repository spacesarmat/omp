// Android TV built-in player: the same 18 s rule as the web player, driven by native state events.
// 2160 Player reports nothing until it closes, so this does not apply there. Chromium 53 safe.
import type { SwarmLookup } from '../player/playbackFailure';
import { fallbackAction, fallbackDue } from './fallback';
import { startupReason } from './startup';

export function nativeFallbackDue(p: {
  auto: boolean;
  elapsedMs: number;
  time: number;
  buffering: boolean;
  bytes: number;
  speedBps: number;
  swarm: SwarmLookup;
}): boolean {
  if (!p.auto) return false;
  if (p.time >= 1) return false;
  if (!p.buffering) return false;
  const reason = startupReason({ elapsedMs: p.elapsedMs, fault: 'none', swarm: p.swarm, played: false });
  if (reason !== 'slow' && reason !== 'no-seeds') return false;
  return fallbackAction(fallbackDue(p.elapsedMs, false, p.bytes, p.speedBps), true) === 'switch';
}

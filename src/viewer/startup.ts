// Why playback did not start, and which buttons help. Chromium 53 safe.
import type { EngineFault, SwarmLookup } from '../player/playbackFailure';
import { classifyFailure } from '../player/playbackFailure';
import { FALLBACK_WAIT_MS, isPlayable } from './fallback';

export type StartupReason = 'none' | 'no-seeds' | 'slow' | 'server' | 'codec';

export type FailureAction = 'another' | 'lower' | 'retry';

export function startupReason(p: {
  elapsedMs: number;
  fault: EngineFault;
  swarm: SwarmLookup;
  played: boolean;
}): StartupReason {
  const kind = classifyFailure(p.fault, p.swarm, p.played);
  if (kind === 'codec') return 'codec';
  if (kind === 'server') return 'server';
  if (kind === 'no-seeders') return 'no-seeds';
  if (p.played) return 'none';
  // A cache miss on the first second is still "connecting". A media fault already returned above.
  if (p.swarm.kind === 'unreachable' && p.elapsedMs >= 3000) return 'server';
  if (!(p.elapsedMs >= FALLBACK_WAIT_MS)) return 'none';
  if (p.swarm.kind === 'pending') return 'server';
  if (p.swarm.kind !== 'ok') return 'none';
  const s = p.swarm.stats;
  const bytes = Math.max(s.preloadedBytes, s.loadedBytes);
  if (isPlayable(false, bytes, s.downloadSpeed)) return 'none';
  if (s.activePeers <= 0 && s.seeders <= 0) return 'no-seeds';
  return 'slow';
}

export function failureActions(reason: StartupReason): FailureAction[] {
  if (reason === 'no-seeds') return ['another', 'retry'];
  if (reason === 'codec') return ['lower', 'another', 'retry'];
  if (reason === 'slow') return ['lower', 'another', 'retry'];
  if (reason === 'server') return ['retry'];
  return [];
}

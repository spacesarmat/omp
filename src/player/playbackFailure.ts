// A media error from <video> (or the Android engine) is not a codec failure until TorrServer has actually
// delivered data. No connected peers and an empty buffer is a dead swarm; peers with nothing buffered yet
// means keep waiting. Chromium 53 safe.
import type { CacheState } from '../api/types';
import { t } from '../i18n';
import { mediaErrorText } from './useVideoState';

/** Below this, nothing playable has arrived (a few header bytes are not a stream). */
export const EMPTY_BYTES = 64 * 1024;

/** A download slower than this, with an empty buffer, is not "data flowing". */
export const QUIET_SPEED = 1024;

/** How long the player waits before reopening a stream that errored while peers are still connecting. */
export const SWARM_RETRY_MS = 3000;

export type EngineFault = 'none' | 'aborted' | 'network' | 'decode' | 'format' | 'other';

export interface SwarmStats {
  activePeers: number;
  totalPeers: number;
  seeders: number;
  preloadedBytes: number;
  /** Bytes already on the server (cache filled or the torrent's loaded size). */
  loadedBytes: number;
  downloadSpeed: number;
}

/** `absent`: the item is not a TorrServer stream, so the swarm cannot explain the error. */
export type SwarmLookup =
  | { kind: 'pending' }
  | { kind: 'unreachable' }
  | { kind: 'absent' }
  | { kind: 'ok'; stats: SwarmStats };

/** What the player shows. `other` keeps the engine's own text (aborted, unknown, a non-torrent file). */
export type FailureKind = 'buffering' | 'no-seeders' | 'server' | 'codec' | 'other';

export function faultFromMediaCode(code: number | null): EngineFault {
  if (code == null) return 'none';
  if (code === 1) return 'aborted';
  if (code === 2) return 'network';
  if (code === 3) return 'decode';
  if (code === 4) return 'format';
  return 'other';
}

function num(v: number | undefined): number {
  return typeof v === 'number' && isFinite(v) && v > 0 ? v : 0;
}

/** TorrServer /cache → the lookup the classifier reads. No hash: the file is not a torrent. */
export function swarmFromCache(status: string, cache: CacheState | null, hasTorrent: boolean): SwarmLookup {
  if (!hasTorrent) return { kind: 'absent' };
  if (status === 'down') return { kind: 'unreachable' };
  if (status !== 'ok' || !cache) return { kind: 'pending' };
  const tor = cache.Torrent;
  const preloaded = num(tor && tor.preloaded_bytes);
  const loaded = Math.max(preloaded, num(tor && tor.loaded_size), num(cache.Filled));
  return {
    kind: 'ok',
    stats: {
      activePeers: num(tor && tor.active_peers),
      totalPeers: num(tor && tor.total_peers),
      seeders: num(tor && tor.connected_seeders),
      preloadedBytes: preloaded,
      loadedBytes: loaded,
      downloadSpeed: num(tor && tor.download_speed),
    },
  };
}

function bytesOf(s: SwarmStats): number {
  return Math.max(s.preloadedBytes, s.loadedBytes);
}

function peersConnected(s: SwarmStats): boolean {
  return s.activePeers > 0 || s.seeders > 0;
}

/**
 * Classify a playback fault against the latest TorrServer stat.
 * `played` is true once a frame has actually started (data reached the decoder).
 * Total peers in the swarm do not count: only connected peers and seeders do.
 */
export function classifyFailure(fault: EngineFault, swarm: SwarmLookup, played: boolean): FailureKind {
  if (fault === 'none') return 'buffering';
  if (fault === 'aborted') return 'other';
  if (swarm.kind === 'pending') return 'buffering';
  if (swarm.kind === 'unreachable') return 'server';
  if (swarm.kind === 'absent') return fault === 'format' || fault === 'decode' ? 'codec' : 'other';
  const s = swarm.stats;
  const flowing = played || bytesOf(s) >= EMPTY_BYTES;
  const peers = peersConnected(s);
  const quiet = bytesOf(s) < EMPTY_BYTES && s.downloadSpeed < QUIET_SPEED;
  if (!flowing && quiet && !peers) return 'no-seeders';
  if (!flowing) return 'buffering';
  if (fault === 'format' || fault === 'decode') return 'codec';
  if (fault === 'network') return peers ? 'buffering' : 'server';
  return 'other';
}

/** The sentence for a classified failure. Codec keeps the decode vs container wording of the media element. */
export function failureText(kind: FailureKind, code: number | null): string {
  if (kind === 'no-seeders') return t('player.errNoSeeders');
  if (kind === 'server') return t('player.errServer');
  if (kind === 'codec') return code === 3 ? t('player.errDecode') : t('player.errFormat');
  return mediaErrorText(code == null ? null : ({ code: code } as MediaError));
}

import { describe, expect, it } from 'vitest';
import { FALLBACK_WAIT_MS, PLAYABLE_BYTES, PLAYABLE_SPEED, fallbackAction, fallbackDue, isPlayable } from '../../src/viewer/fallback';
import { failureActions, startupReason } from '../../src/viewer/startup';
import type { SwarmLookup } from '../../src/player/playbackFailure';

describe('fallback timing', () => {
  it('waits through the first 15 seconds', () => {
    expect(FALLBACK_WAIT_MS).toBeGreaterThanOrEqual(15000);
    expect(FALLBACK_WAIT_MS).toBeLessThanOrEqual(20000);
    expect(fallbackDue(14999, false, 0, 0)).toBe(false);
    expect(fallbackDue(FALLBACK_WAIT_MS - 1, false, 0, 0)).toBe(false);
  });

  it('is due at 18 s when nothing playable arrived', () => {
    expect(fallbackDue(FALLBACK_WAIT_MS, false, 0, 0)).toBe(true);
    expect(fallbackDue(20000, false, 1024, 100)).toBe(true);
  });

  it('is not due once playback, a full buffer, or a fast head is in', () => {
    expect(isPlayable(true, 0, 0)).toBe(true);
    expect(fallbackDue(FALLBACK_WAIT_MS, true, 0, 0)).toBe(false);
    expect(fallbackDue(FALLBACK_WAIT_MS, false, PLAYABLE_BYTES, 0)).toBe(false);
    expect(fallbackDue(FALLBACK_WAIT_MS, false, 32 * 1024, PLAYABLE_SPEED)).toBe(false);
  });

  it('offers by default and switches only when the setting says so', () => {
    expect(fallbackAction(false, true)).toBe('wait');
    expect(fallbackAction(true, false)).toBe('offer');
    expect(fallbackAction(true, true)).toBe('switch');
  });
});

const quiet: SwarmLookup = {
  kind: 'ok',
  stats: { activePeers: 0, totalPeers: 4, seeders: 0, preloadedBytes: 0, loadedBytes: 0, downloadSpeed: 0 },
};
const slowPeers: SwarmLookup = {
  kind: 'ok',
  stats: { activePeers: 2, totalPeers: 4, seeders: 1, preloadedBytes: 1000, loadedBytes: 1000, downloadSpeed: 500 },
};

describe('startup reasons', () => {
  it('names no seeds, a slow link, a missing server and a codec', () => {
    expect(startupReason({ elapsedMs: FALLBACK_WAIT_MS, fault: 'none', swarm: quiet, played: false })).toBe('no-seeds');
    expect(startupReason({ elapsedMs: FALLBACK_WAIT_MS, fault: 'none', swarm: slowPeers, played: false })).toBe('slow');
    expect(startupReason({ elapsedMs: 1000, fault: 'network', swarm: { kind: 'unreachable' }, played: false })).toBe('server');
    expect(startupReason({ elapsedMs: 1000, fault: 'none', swarm: { kind: 'unreachable' }, played: false })).toBe('none');
    expect(startupReason({ elapsedMs: 3000, fault: 'none', swarm: { kind: 'unreachable' }, played: false })).toBe('server');
    expect(startupReason({ elapsedMs: 1000, fault: 'decode', swarm: slowPeers, played: true })).toBe('codec');
    expect(startupReason({ elapsedMs: 1000, fault: 'none', swarm: slowPeers, played: false })).toBe('none');
  });

  it('offers the next step that matches the reason', () => {
    expect(failureActions('no-seeds')).toEqual(['another', 'retry']);
    expect(failureActions('slow')).toEqual(['lower', 'another', 'retry']);
    expect(failureActions('codec')).toEqual(['lower', 'another', 'retry']);
    expect(failureActions('server')).toEqual(['retry']);
    expect(failureActions('none')).toEqual([]);
  });
});

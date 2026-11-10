import { describe, expect, it } from 'vitest';
import { noteAlternatePool, nextAlternate } from '../../src/viewer/alternates';
import { FALLBACK_WAIT_MS } from '../../src/viewer/fallback';
import { nativeFallbackDue } from '../../src/viewer/nativeFallback';
import type { SwarmLookup } from '../../src/player/playbackFailure';

describe('lower quality alternate', () => {
  it('does not fall through to a higher release', () => {
    noteAlternatePool([
      { hash: 'aaa', title: 'Film 2160p' },
      { hash: 'bbb', title: 'Film 1080p' },
      { hash: 'ccc', title: 'Film 720p' },
    ]);
    const known = { aaa: true, bbb: true, ccc: true };
    expect(nextAlternate('bbb', 'lower', known)).toBe('ccc');
    expect(nextAlternate('ccc', 'lower', known)).toBe('');
    expect(nextAlternate('ccc', 'any', known)).toBe('aaa');
    expect(nextAlternate('ccc', 'sameOrLower', known)).toBe('');
    expect(nextAlternate('aaa', 'sameOrLower', known)).toBe('bbb');
    noteAlternatePool([{ hash: 'zzz', title: 'Other movie 1080p' }]);
    expect(nextAlternate('aaa', 'any', { aaa: true, zzz: true })).toBe('');
  });
});

const quiet: SwarmLookup = {
  kind: 'ok',
  stats: { activePeers: 0, totalPeers: 0, seeders: 0, preloadedBytes: 0, loadedBytes: 0, downloadSpeed: 0 },
};

describe('native fallback', () => {
  it('switches only after the wait, while still buffering at the start', () => {
    const base = { auto: true, time: 0, buffering: true, bytes: 0, speedBps: 0, swarm: quiet };
    expect(nativeFallbackDue({ ...base, elapsedMs: FALLBACK_WAIT_MS - 1 })).toBe(false);
    expect(nativeFallbackDue({ ...base, elapsedMs: FALLBACK_WAIT_MS })).toBe(true);
    expect(nativeFallbackDue({ ...base, elapsedMs: FALLBACK_WAIT_MS, time: 2 })).toBe(false);
    expect(nativeFallbackDue({ ...base, elapsedMs: FALLBACK_WAIT_MS, buffering: false })).toBe(false);
    expect(nativeFallbackDue({ ...base, elapsedMs: FALLBACK_WAIT_MS, auto: false })).toBe(false);
  });
});

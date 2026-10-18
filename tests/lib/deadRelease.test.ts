import { describe, it, expect, beforeEach } from 'vitest';
import { DEAD_RELEASE_MS, deadRelease } from '../../src/lib/deadRelease';
import { isDeadRelease, noteSwarm, resetSwarmWatch } from '../../src/lib/swarmWatch';

describe('deadRelease', () => {
  it('is dead only after a minute of an active torrent with 0 seeders and 0 bytes', () => {
    const t0 = 1_000;
    const quiet = { active: true, seeders: 0, bytes: 0 };
    const start = deadRelease(null, t0, quiet);
    expect(start).toEqual({ since: t0, dead: false });
    expect(deadRelease(start.since, t0 + DEAD_RELEASE_MS - 1, quiet).dead).toBe(false);
    expect(deadRelease(start.since, t0 + DEAD_RELEASE_MS, quiet)).toEqual({ since: t0, dead: true });
  });

  it('clears the streak when a seeder or a byte arrives, or the torrent is not active', () => {
    const since = 1_000;
    const now = since + DEAD_RELEASE_MS;
    expect(deadRelease(since, now, { active: true, seeders: 1, bytes: 0 })).toEqual({ since: null, dead: false });
    expect(deadRelease(since, now, { active: true, seeders: 0, bytes: 1 })).toEqual({ since: null, dead: false });
    expect(deadRelease(since, now, { active: false, seeders: 0, bytes: 0 })).toEqual({ since: null, dead: false });
  });
});

describe('noteSwarm', () => {
  beforeEach(() => resetSwarmWatch());

  it('flips the shared flag once the streak reaches a minute', () => {
    const hash = 'ab'.repeat(20);
    const sample = { active: true, seeders: 0, bytes: 0 };
    noteSwarm(hash, sample, 5_000);
    expect(isDeadRelease(hash)).toBe(false);
    noteSwarm(hash, sample, 5_000 + DEAD_RELEASE_MS);
    expect(isDeadRelease(hash)).toBe(true);
    noteSwarm(hash, { active: true, seeders: 2, bytes: 0 }, 9_000);
    expect(isDeadRelease(hash)).toBe(false);
  });
});

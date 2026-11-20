import { describe, expect, it } from 'vitest';
import { syncAgo } from '../../src/billing/syncAgo';

describe('syncAgo', () => {
  const now = 1_700_000_000_000;
  it('is never without a time', () => {
    expect(syncAgo(0, now).kind).toBe('never');
  });
  it('is just now inside a minute', () => {
    expect(syncAgo(now - 20_000, now).kind).toBe('just');
  });
  it('counts minutes, hours and days', () => {
    expect(syncAgo(now - 2 * 60_000, now)).toEqual({ kind: 'min', n: 2 });
    expect(syncAgo(now - 3 * 3600_000, now)).toEqual({ kind: 'hour', n: 3 });
    expect(syncAgo(now - 3 * 86400_000, now)).toEqual({ kind: 'day', n: 3 });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
});

afterEach(() => vi.restoreAllMocks());

describe('nextProgressWriteSeq', () => {
  it('increments within one millisecond', async () => {
    const { nextProgressWriteSeq } = await import('../../src/player/progressWriteSeq');
    const first = nextProgressWriteSeq();
    expect(nextProgressWriteSeq()).toBe(first + 1);
  });

  it('does not reuse the persisted sequence after a module reload', async () => {
    const first = await import('../../src/player/progressWriteSeq');
    const previous = first.nextProgressWriteSeq();
    vi.resetModules();
    const second = await import('../../src/player/progressWriteSeq');
    expect(second.nextProgressWriteSeq()).toBeGreaterThan(previous);
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { seekStep, SeekAccumulator } from '../../src/player/seek';

afterEach(() => vi.useRealTimers());

describe('seekStep', () => {
  it('accelerates every 4 repeats up to x6', () => {
    expect(seekStep(10, 0)).toBe(10);
    expect(seekStep(10, 3)).toBe(10);
    expect(seekStep(10, 4)).toBe(20);
    expect(seekStep(10, 100)).toBe(60);
  });
});

describe('SeekAccumulator', () => {
  it('accumulates presses and applies once after delay', () => {
    vi.useFakeTimers();
    let now = 0;
    const apply = vi.fn();
    const s = new SeekAccumulator(apply, 700, () => now);
    expect(s.press(1, 100, 1000, 10)).toBe(110);
    now = 100;
    expect(s.press(1, 100, 1000, 10)).toBe(120);
    expect(s.pending()).toBe(120);
    vi.advanceTimersByTime(699);
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(apply).toHaveBeenCalledWith(120);
    expect(s.pending()).toBeNull();
  });
  it('clamps to [0, duration-1]', () => {
    const s = new SeekAccumulator(() => undefined, 700, () => 0);
    expect(s.press(-1, 5, 1000, 10)).toBe(0);
    s.cancel();
    expect(s.press(1, 995, 1000, 10)).toBe(999);
    s.cancel();
  });
  it('commit applies immediately, cancel drops', () => {
    const apply = vi.fn();
    const s = new SeekAccumulator(apply, 700, () => 0);
    s.press(1, 0, 100, 10);
    s.commit();
    expect(apply).toHaveBeenCalledWith(10);
    s.press(1, 0, 100, 10);
    s.cancel();
    expect(apply).toHaveBeenCalledTimes(1);
  });
});

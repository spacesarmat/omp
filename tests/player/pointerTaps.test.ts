import { describe, it, expect, vi, afterEach } from 'vitest';
import { tapZone, edgeSeekStep, TapDetector, SeekStreak } from '../../src/player/pointerTaps';

afterEach(() => vi.useRealTimers());

describe('tapZone', () => {
  it('splits the width in thirds', () => {
    expect(tapZone(100, 900)).toBe('left');
    expect(tapZone(450, 900)).toBe('center');
    expect(tapZone(800, 900)).toBe('right');
    expect(tapZone(10, 0)).toBe('center');
  });
});

describe('edgeSeekStep', () => {
  it('escalates base, double (max 30), then 30', () => {
    expect([0, 1, 2, 3].map((n) => edgeSeekStep(5, n))).toEqual([5, 10, 30, 30]);
    expect(edgeSeekStep(15, 1)).toBe(30);
    expect(edgeSeekStep(10, 1)).toBe(20);
  });
});

describe('TapDetector', () => {
  it('fires single after the delay and double instead of single', () => {
    vi.useFakeTimers();
    const single = vi.fn();
    const double = vi.fn();
    const d = new TapDetector({ single, double }, 300);
    d.tap('center');
    vi.advanceTimersByTime(299);
    expect(single).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(single).toHaveBeenCalledTimes(1);
    d.tap('left');
    d.tap('right');
    expect(double).toHaveBeenCalledWith('right');
    vi.advanceTimersByTime(1000);
    expect(single).toHaveBeenCalledTimes(1);
  });
  it('cancel drops a pending single', () => {
    vi.useFakeTimers();
    const single = vi.fn();
    const d = new TapDetector({ single, double: () => undefined }, 300);
    d.tap('center');
    d.cancel();
    vi.advanceTimersByTime(500);
    expect(single).not.toHaveBeenCalled();
  });
});

describe('SeekStreak', () => {
  it('escalates within 2 s in one direction and resets otherwise', () => {
    let now = 0;
    const s = new SeekStreak(() => now, 2000);
    expect(s.next(1, 5)).toBe(5);
    now = 500; expect(s.next(1, 5)).toBe(10);
    now = 1000; expect(s.next(1, 5)).toBe(30);
    now = 1500; expect(s.next(1, 5)).toBe(30);
    now = 1600; expect(s.next(-1, 5)).toBe(5);
    now = 4000; expect(s.next(-1, 5)).toBe(5);
  });
});

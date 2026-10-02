import { describe, it, expect, vi, afterEach } from 'vitest';
import { HideTimer } from '../../src/player/hideTimer';

afterEach(() => vi.useRealTimers());

describe('HideTimer', () => {
  it('hides after 4 s when allowed', () => {
    vi.useFakeTimers();
    const hide = vi.fn();
    const t = new HideTimer(() => true, hide);
    t.arm();
    vi.advanceTimersByTime(3999);
    expect(hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('does not hide while paused, but hides after playback re-arms it', () => {
    vi.useFakeTimers();
    let playing = false;
    const hide = vi.fn();
    const t = new HideTimer(() => playing, hide);
    t.arm();
    vi.advanceTimersByTime(10000);
    expect(hide).not.toHaveBeenCalled();
    playing = true;
    t.arm();
    vi.advanceTimersByTime(4000);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('re-arming restarts the delay; cancel stops it', () => {
    vi.useFakeTimers();
    const hide = vi.fn();
    const t = new HideTimer(() => true, hide);
    t.arm();
    vi.advanceTimersByTime(3000);
    t.arm();
    vi.advanceTimersByTime(3000);
    expect(hide).not.toHaveBeenCalled();
    t.cancel();
    vi.advanceTimersByTime(5000);
    expect(hide).not.toHaveBeenCalled();
  });
});

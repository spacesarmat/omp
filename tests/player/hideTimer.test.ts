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

import { canHideControls, pointerMoveCounts } from '../../src/player/hideTimer';

describe('canHideControls', () => {
  const ok = { paused: false, buffering: false, seeking: false, error: false, dialogOpen: false };
  it('allows only when playing with nothing else open', () => {
    expect(canHideControls(ok)).toBe(true);
    expect(canHideControls({ ...ok, paused: true })).toBe(false);
    expect(canHideControls({ ...ok, buffering: true })).toBe(false);
    expect(canHideControls({ ...ok, seeking: true })).toBe(false);
    expect(canHideControls({ ...ok, error: true })).toBe(false);
    expect(canHideControls({ ...ok, dialogOpen: true })).toBe(false);
  });
});

describe('pointerMoveCounts', () => {
  it('ignores jitter while visible, counts real moves and any move when hidden', () => {
    expect(pointerMoveCounts(true, { x: 100, y: 100 }, 104, 103)).toBe(false);
    expect(pointerMoveCounts(true, { x: 100, y: 100 }, 120, 100)).toBe(true);
    expect(pointerMoveCounts(false, { x: 100, y: 100 }, 101, 100)).toBe(true);
    expect(pointerMoveCounts(true, null, 1, 1)).toBe(true);
  });
});

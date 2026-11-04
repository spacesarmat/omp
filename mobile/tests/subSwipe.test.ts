import { describe, it, expect } from 'vitest';
import {
  SUB_SWIPE_SLOP,
  SUB_SWIPE_THRESHOLD,
  beginSubSwipe,
  moveSubSwipe,
  subSwipeAction,
  subSwipeVisual,
} from '../src/ui/subSwipe';

describe('subscription swipe', () => {
  it('stays a tap under the slop and a scroll when the move is vertical', () => {
    const start = beginSubSwipe(100, 80);
    expect(moveSubSwipe(start, 100 + SUB_SWIPE_SLOP - 1, 80).phase).toBe('pending');
    const down = moveSubSwipe(start, 110, 80 + 80);
    expect(down.phase).toBe('vertical');
    expect(down.dx).toBe(0);
    expect(subSwipeAction(0)).toBeNull();
  });

  it('a right swipe past the threshold checks, a short one snaps back', () => {
    const start = beginSubSwipe(40, 50);
    const moved = moveSubSwipe(start, 40 + SUB_SWIPE_THRESHOLD + 8, 54);
    expect(moved.phase).toBe('horizontal');
    expect(subSwipeAction(moved.dx)).toBe('check');
    expect(subSwipeAction(SUB_SWIPE_THRESHOLD - 1)).toBeNull();
    expect(subSwipeAction(SUB_SWIPE_THRESHOLD)).toBe('check');
  });

  it('a left swipe past the threshold deletes, and the card does not follow forever', () => {
    const start = beginSubSwipe(200, 40);
    const moved = moveSubSwipe(start, 200 - SUB_SWIPE_THRESHOLD - 4, 42);
    expect(moved.phase).toBe('horizontal');
    expect(subSwipeAction(moved.dx)).toBe('delete');
    expect(subSwipeAction(-SUB_SWIPE_THRESHOLD)).toBe('delete');
    expect(subSwipeVisual(400)).toBeLessThan(400);
    expect(subSwipeVisual(-400)).toBeGreaterThan(-400);
  });
});

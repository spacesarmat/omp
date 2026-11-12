import { describe, it, expect } from 'vitest';
import { beginRowSwipe, endRowSwipe, moveRowSwipe, rowSwipeVisual, ROW_OPEN_AT, ROW_REVEAL } from '../src/ui/rowSwipe';

describe('catalog row swipe', () => {
  it('a left swipe past the threshold opens and a short one stays shut', () => {
    let g = beginRowSwipe(200, 40, false);
    g = moveRowSwipe(g, 200 - ROW_OPEN_AT - 8, 42);
    expect(g.phase).toBe('horizontal');
    expect(endRowSwipe(g)).toBe('open');
    expect(rowSwipeVisual(g)).toBe(-(ROW_OPEN_AT + 8));
    let short = beginRowSwipe(200, 40, false);
    short = moveRowSwipe(short, 170, 40);
    expect(endRowSwipe(short)).toBe('closed');
    expect(rowSwipeVisual(short)).toBe(-30);
  });

  it('a right swipe closes an open row and a vertical drag does not open it', () => {
    let open = beginRowSwipe(80, 40, true);
    open = moveRowSwipe(open, 140, 44);
    expect(endRowSwipe(open)).toBe('closed');
    expect(rowSwipeVisual(open)).toBe(-(ROW_REVEAL - 60));
    let down = beginRowSwipe(200, 40, false);
    down = moveRowSwipe(down, 190, 120);
    expect(down.phase).toBe('vertical');
    expect(endRowSwipe(down)).toBe('closed');
    expect(rowSwipeVisual(down)).toBe(0);
    down = moveRowSwipe(down, 40, 200);
    expect(down.phase).toBe('vertical');
    expect(rowSwipeVisual(down)).toBe(0);
  });
});

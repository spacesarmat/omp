import { describe, it, expect } from 'vitest';
import { keepBand, keepRows, rowOf, keepsImage, focusedRow } from '../../src/lib/gridWindow';

describe('grid image window', () => {
  it('keeps about 3 screens of rows on each side of the focus', () => {
    expect(keepRows(380)).toBe(9); // «Обзор»: 3 * 1080 / 380
    expect(keepRows(560)).toBe(6);
    expect(keepRows(1080, 1)).toBe(1);
    expect(keepRows(0)).toBeGreaterThan(0);
  });

  it('lets go of the images of rows further away and keeps the near ones', () => {
    const cols = 8;
    expect(rowOf(0, cols)).toBe(0);
    expect(rowOf(15, cols)).toBe(1);
    // focus on row 20: rows 11..29 keep their posters
    expect(keepsImage(20 * cols, 20, cols, 9)).toBe(true);
    expect(keepsImage(11 * cols, 20, cols, 9)).toBe(true);
    expect(keepsImage(11 * cols - 1, 20, cols, 9)).toBe(false);
    expect(keepsImage(29 * cols + 7, 20, cols, 9)).toBe(true);
    expect(keepsImage(30 * cols, 20, cols, 9)).toBe(false);
  });

  it('restores them when the focus comes back', () => {
    const cols = 8;
    const shown = (focus: number) => {
      let n = 0;
      for (let i = 0; i < 25 * cols; i++) if (keepsImage(i, focus, cols, 9)) n++;
      return n;
    };
    expect(shown(24)).toBe(10 * cols);
    expect(shown(0)).toBe(10 * cols);
    expect(keepsImage(0, 24, cols, 9)).toBe(false);
    expect(keepsImage(0, 0, cols, 9)).toBe(true);
  });

  it('moves the band every half a window, not every row, so most moves redraw nothing', () => {
    // the window of row 20 covers rows 11..29: a focus a few rows away keeps the stored row
    expect(keepBand(20, 21, 9)).toBe(20);
    expect(keepBand(20, 23, 9)).toBe(20);
    // at half the band the stored row jumps to the focus, once, not on every row
    expect(keepBand(20, 24, 9)).toBe(24);
    expect(keepBand(20, 16, 9)).toBe(16);
    // the same row changes nothing at all
    expect(keepBand(7, 7, 9)).toBe(7);
    // a window of one row still follows the focus
    expect(keepBand(3, 4, 1)).toBe(4);
  });

  it('keeps the rows ahead of and behind the focus loaded while the band holds', () => {
    const cols = 8;
    const keep = 9;
    let stored = 0;
    for (let focus = 0; focus <= 40; focus++) {
      stored = keepBand(stored, focus, keep);
      for (let ahead = 1; ahead <= 4; ahead++) {
        expect(keepsImage((focus + ahead) * cols, stored, cols, keep)).toBe(true);
      }
      for (let back = 1; back <= 4; back++) {
        expect(keepsImage((focus - back) * cols, stored, cols, keep)).toBe(true);
      }
    }
  });

  it('finds the focused row in a new list, the top when the focus is elsewhere', () => {
    const keys = ['a', 'b', 'c', 'd', 'e'];
    expect(focusedRow(keys, 'e', 2)).toBe(2);
    expect(focusedRow(keys, 'x', 2)).toBe(0);
    expect(focusedRow(keys, '', 2)).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { keepRows, rowOf, keepsImage, focusedRow } from '../../src/lib/gridWindow';

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

  it('finds the focused row in a new list, the top when the focus is elsewhere', () => {
    const keys = ['a', 'b', 'c', 'd', 'e'];
    expect(focusedRow(keys, 'e', 2)).toBe(2);
    expect(focusedRow(keys, 'x', 2)).toBe(0);
    expect(focusedRow(keys, '', 2)).toBe(0);
  });
});

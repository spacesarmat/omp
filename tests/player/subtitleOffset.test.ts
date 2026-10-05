import { describe, it, expect } from 'vitest';
import { formatOffset, subtitleOffsetOptions, subSizeOptions } from '../../src/player/subtitleOffset';

describe('subtitle offset', () => {
  it('formats values', () => {
    expect(formatOffset(0)).toBe('0 с');
    expect(formatOffset(0.5)).toBe('+0,5 с (позже)');
    expect(formatOffset(-2)).toBe('−2,0 с (раньше)');
  });
  it('lists -5..+5 with 0.5 step', () => {
    const o = subtitleOffsetOptions();
    expect(o).toHaveLength(21);
    expect(o[0].value).toBe(-5);
    expect(o[10]).toEqual({ value: 0, label: '0 с' });
    expect(o[20].value).toBe(5);
  });
  it('has three sizes', () => {
    expect(subSizeOptions().map((x) => x.value)).toEqual(['small', 'medium', 'large']);
  });
});

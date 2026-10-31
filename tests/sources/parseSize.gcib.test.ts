import { describe, it, expect } from 'vitest';
import { parseSize } from '../../src/sources/html';

describe('parseSize: a stray C in a binary unit (QA N1)', () => {
  it('reads «4.8 GCiB» as GiB', () => {
    expect(parseSize('4.8 GCiB')).toBe(Math.round(4.8 * 1024 * 1024 * 1024));
    expect(parseSize('700 MCiB')).toBe(700 * 1024 * 1024);
  });
  it('still rejects words that are not sizes', () => {
    expect(parseSize('4 серии')).toBeNull();
  });
});

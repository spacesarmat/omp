import { describe, it, expect } from 'vitest';
import { playWhere } from '../../src/lib/playWhere';

describe('playWhere', () => {
  it('starts on the TV when one is saved, and on the phone when none is', () => {
    expect(playWhere(true)).toBe('tv');
    expect(playWhere(false)).toBe('phone');
  });
});

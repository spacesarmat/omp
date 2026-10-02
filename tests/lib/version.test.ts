import { describe, it, expect } from 'vitest';
import { compareVersions } from '../../src/lib/version';

describe('compareVersions', () => {
  it('compares numerically part by part', () => {
    expect(compareVersions('0.6.0', '0.5.0')).toBe(1);
    expect(compareVersions('0.5.0', '0.6.0')).toBe(-1);
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('v0.6.1', '0.6.1')).toBe(0);
    expect(compareVersions(' 0.6.2 ', 'v0.6.1')).toBe(1);
  });
  it('treats junk parts as zero', () => {
    expect(compareVersions('0.x.1', '0.0.1')).toBe(0);
    expect(compareVersions('', '0.0.0')).toBe(0);
  });
});

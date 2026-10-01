import { describe, it, expect } from 'vitest';
import { formatBytes, formatSpeed, formatDuration } from '../../src/lib/format';

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(150 * 1024 * 1024)).toBe('150 MB');
    expect(formatBytes(2376597238)).toBe('2.2 GB');
    expect(formatBytes(21697042007)).toBe('20.2 GB');
  });
  it('handles invalid input', () => {
    expect(formatBytes(NaN)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
  });
});

describe('formatSpeed', () => {
  it('appends /s', () => expect(formatSpeed(1048576)).toBe('1.0 MB/s'));
});

describe('formatDuration', () => {
  it('formats m:ss and h:mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3644.33)).toBe('1:00:44');
  });
  it('clamps invalid', () => expect(formatDuration(NaN)).toBe('0:00'));
});

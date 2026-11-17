import { describe, expect, it } from 'vitest';
import { filterLogLines, healthReport } from '../admin/src/lib/logText.ts';

describe('admin log text', () => {
  it('keeps every line until a filter is typed', () => {
    const text = 'alpha\nBeta error\ngamma';
    expect(filterLogLines(text, '')).toBe(text);
    expect(filterLogLines(text, '  ')).toBe(text);
    expect(filterLogLines(text, 'ERR')).toBe('Beta error');
    expect(filterLogLines(text, 'нет')).toBe('');
  });

  it('puts a source check into lines and JSON', () => {
    const text = healthReport([{ name: 'jackett', ok: false, latencyMs: 12, lastError: 'timeout' }]);
    expect(text).toContain('jackett: нет, 12 мс · timeout');
    expect(text).toContain('"name": "jackett"');
  });
});

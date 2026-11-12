import { describe, it, expect } from 'vitest';
import { continueStatus, movieRowLine, seriesRowLine } from '../../src/lib/phoneRows';

describe('phone catalog rows', () => {
  it('formats a movie and a series without the duplicate episode range', () => {
    expect(movieRowLine('2011', 130)).toBe('Фильм · 2011 · 2 ч 10 мин');
    expect(seriesRowLine(1, 6, false)).toBe('1 сезон · 6 серий');
    expect(seriesRowLine(2, 0, false)).toBe('2 сезона');
    expect(seriesRowLine(2, 12, false)).toBe('2 сезона · 12 серий');
    expect(continueStatus('S01E04', 'осталось 22 мин')).toBe('S01E04, осталось 22 мин');
    expect(continueStatus('', 'смотрите')).toBe('смотрите');
    expect(seriesRowLine(5, 0, true)).toBe('5 сезонов · завершён');
  });
});

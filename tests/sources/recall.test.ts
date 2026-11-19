import { describe, expect, it } from 'vitest';
import { parseSearchQuery } from '../../src/sources/queryParse';
import { relaxedQueries, trackerQueries } from '../../src/sources/recall';
import { transliterate } from '../../src/sources/translit';

describe('transliterate', () => {
  it('turns Russian into Latin and back', () => {
    expect(transliterate('Локи')).toBe('loki');
    expect(transliterate('Ёлки')).toBe('yolki');
    expect(transliterate('loki')).toBe('локи');
    expect(transliterate('')).toBe('');
  });
});

describe('trackerQueries', () => {
  it('searches the cleaned title, TMDB names and a transliteration, once each', () => {
    const parsed = parseSearchQuery('Локи 2021');
    const qs = trackerQueries(parsed, ['Локи', 'Loki', 'loki']);
    expect(qs[0]).toBe('Локи');
    expect(qs).toContain('Loki');
    expect(qs.filter((q) => q.toLowerCase() === 'loki').length).toBe(1);
    expect(qs.length).toBeLessThanOrEqual(4);
  });

  it('keeps the first search to the cleaned title and transliterates only on the empty retry', () => {
    expect(trackerQueries(parseSearchQuery('Локи'), [])).toEqual(['Локи']);
    expect(relaxedQueries(parseSearchQuery('Локи'), ['Локи'])).toContain('loki');
  });

  it('retries without the subtitle and without the year', () => {
    const parsed = parseSearchQuery('Локи: Бог обмана 2021');
    const again = relaxedQueries(parsed, ['Локи: Бог обмана']);
    expect(again[0]).toBe('Локи');
    expect(relaxedQueries(parseSearchQuery('Локи: Бог обмана'), ['Локи: Бог обмана', 'Локи'])).not.toContain('Локи');
  });
});

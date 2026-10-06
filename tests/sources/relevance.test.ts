import { describe, it, expect } from 'vitest';
import { isRelevant, queryWords, relevantRows } from '../../src/sources/relevance';

describe('search relevance', () => {
  it('query words skip years, resolutions and 1-2 letter words', () => {
    expect(queryWords('Дюна 2021 720p')).toEqual(['дюна']);
    expect(queryWords('Star Wars: Episode IV 1977 2160p 4K HDR')).toEqual(['star', 'wars', 'episode']);
    expect(queryWords('Ёлки 2 3D')).toEqual(['елки']);
    expect(queryWords('2021 1080p')).toEqual([]);
  });

  it('a title must share a word, case-insensitively, with ё as е, Cyrillic or Latin', () => {
    const w = queryWords('Дюна 2021 720p');
    expect(isRelevant('Дюна / Dune (2021) 720p WEB-DL', w)).toBe(true);
    expect(isRelevant('ДЮНА: Часть вторая', w)).toBe(true);
    expect(isRelevant('Понедельник - день тяжелый / Getsuyoubi no Tawawa [12 из 12]', w)).toBe(false);
    expect(isRelevant('Виви: Песнь флюоритового глаза', w)).toBe(false);
    expect(isRelevant('Елки последние (2018)', queryWords('ёлки'))).toBe(true);
    expect(isRelevant('Dune: Part Two 2024 2160p', queryWords('DUNE 720p'))).toBe(true);
    // a 1080p in the title does not match a 1080p in the query
    expect(isRelevant('Виви 1080p', queryWords('Дюна 1080p'))).toBe(false);
  });

  it('long words match by stem (inflected titles), short ones only from a word start', () => {
    expect(isRelevant('Хроники Нарнии: Лев, колдунья и платяной шкаф', queryWords('Нарния'))).toBe(true);
    expect(isRelevant('Комедиант', queryWords('мед'))).toBe(false);
  });

  it('keeps every row for a query without meaningful words; drops all junk', () => {
    const rows = [{ Title: 'Понедельник - день тяжелый' }, { Title: 'Виви' }];
    expect(relevantRows(rows, '2021')).toHaveLength(2);
    expect(relevantRows(rows, 'Дюна 2021 720p')).toEqual([]);
  });
});

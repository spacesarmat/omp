import { describe, it, expect } from 'vitest';
import { isRelevant, isSimilar, queryWords, relevantRows, similarRows } from '../../src/sources/relevance';

describe('search relevance', () => {
  it('query words skip years, resolutions and 1-2 letter words', () => {
    expect(queryWords('Дюна 2021 720p')).toEqual(['дюна']);
    expect(queryWords('Star Wars: Episode IV 1977 2160p 4K HDR')).toEqual(['star', 'wars']);
    expect(queryWords('Американская история ужасов 11 сезон')).toEqual(['американская', 'история', 'ужасов']);
    expect(queryWords('American Horror Story S11E01')).toEqual(['american', 'horror', 'story']);
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

  it('two words must both match; one shared word of a longer query is only similar', () => {
    expect(isRelevant('Star Wars', queryWords('Star Wars'))).toBe(true);
    expect(isRelevant('Star Trek', queryWords('Star Wars'))).toBe(false);
    expect(isSimilar('Star Trek', queryWords('Star Wars'))).toBe(true);
  });

  it('«Американская история ужасов 11 сезон» drops unrelated Anidub rows and keeps the show', () => {
    const q = 'Американская история ужасов 11 сезон';
    const junk = [
      { Title: 'Бесконечный мир / Mugen no Sekai [Anidub]' },
      { Title: 'Ресторан Ужасов / Restaurant of Horrors [Anidub]' },
      { Title: 'Ресторан Ужасов 2 [Anidub]' },
      { Title: 'Ресторан Ужасов 3 [Anidub]' },
      { Title: 'Мрачный Санта / Grim Santa [Anidub]' },
    ];
    const hit = { Title: 'Американская история ужасов / American Horror Story (2011) S11 1080p' };
    expect(relevantRows(junk.concat([hit]), q)).toEqual([hit]);
    expect(similarRows(junk, q).map((r) => r.Title)).toEqual([
      'Ресторан Ужасов / Restaurant of Horrors [Anidub]',
      'Ресторан Ужасов 2 [Anidub]',
      'Ресторан Ужасов 3 [Anidub]',
    ]);
    expect(isRelevant('Американской истории ужасов S11E01', queryWords(q))).toBe(true);
  });

  it('keeps every row for a query without meaningful words; drops all junk', () => {
    const rows = [{ Title: 'Понедельник - день тяжелый' }, { Title: 'Виви' }];
    expect(relevantRows(rows, '2021')).toHaveLength(2);
    expect(relevantRows(rows, 'Дюна 2021 720p')).toEqual([]);
  });
});

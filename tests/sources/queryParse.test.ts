import { describe, expect, it } from 'vitest';
import { dropSubtitle, parseSearchQuery, yearInTitle } from '../../src/sources/queryParse';
import { normalizeTitle } from '../../src/sources/merge';

describe('parseSearchQuery', () => {
  it('reads a year and searches the title without it', () => {
    expect(parseSearchQuery('Локи 2023')).toEqual({ raw: 'Локи 2023', title: 'Локи', year: 2023, season: 0, episode: 0 });
    expect(parseSearchQuery('Локи (2021)')).toMatchObject({ title: 'Локи', year: 2021 });
    expect(parseSearchQuery('Blade Runner 2049')).toMatchObject({ title: 'Blade Runner', year: 2049 });
    expect(parseSearchQuery('1917')).toMatchObject({ title: '1917', year: 1917 });
    expect(parseSearchQuery('The Matrix')).toMatchObject({ title: 'The Matrix', year: 0, season: 0, episode: 0 });
  });

  it('ignores years outside 1900-2099 and resolutions', () => {
    expect(yearInTitle('Фильм 1899')).toBe(0);
    expect(yearInTitle('Фильм 2100')).toBe(0);
    expect(yearInTitle('Фильм 1080p')).toBe(0);
    expect(yearInTitle('Фильм 2160p')).toBe(0);
    expect(parseSearchQuery('Дом 1080p').year).toBe(0);
    expect(parseSearchQuery('Дом 1080p').title).toBe('Дом 1080p');
  });

  it('reads a season and an episode from Russian and English forms', () => {
    expect(parseSearchQuery('Локи 2 сезон')).toMatchObject({ title: 'Локи', season: 2, episode: 0, year: 0 });
    expect(parseSearchQuery('сезон 2 серия 3')).toMatchObject({ title: '', season: 2, episode: 3 });
    expect(parseSearchQuery('2 сезон 3 серия')).toMatchObject({ title: '', season: 2, episode: 3 });
    expect(parseSearchQuery('Доктор Хаус 8 сезон 1 серия')).toMatchObject({ title: 'Доктор Хаус', season: 8, episode: 1 });
    expect(parseSearchQuery('season 2 episode 3')).toMatchObject({ title: '', season: 2, episode: 3 });
    expect(parseSearchQuery('Loki season 2 episode 3')).toMatchObject({ title: 'Loki', season: 2, episode: 3 });
    expect(parseSearchQuery('3 серия')).toMatchObject({ episode: 3, season: 0 });
    expect(parseSearchQuery('эпизод 4')).toMatchObject({ episode: 4 });
  });

  it('reads s02e03, S2E3 and 2x03', () => {
    expect(parseSearchQuery('s02e03')).toMatchObject({ title: '', season: 2, episode: 3 });
    expect(parseSearchQuery('S2E3')).toMatchObject({ title: '', season: 2, episode: 3 });
    expect(parseSearchQuery('Loki S02E03')).toMatchObject({ title: 'Loki', season: 2, episode: 3 });
    expect(parseSearchQuery('Loki 2x03')).toMatchObject({ title: 'Loki', season: 2, episode: 3 });
    expect(parseSearchQuery('Show S02E01-08')).toMatchObject({ title: 'Show', season: 2, episode: 0 });
  });

  it('keeps a subtitle for the first search and can drop it later', () => {
    expect(parseSearchQuery('Локи: Бог обмана')).toMatchObject({ title: 'Локи: Бог обмана', year: 0 });
    expect(dropSubtitle('Локи: Бог обмана')).toBe('Локи');
    expect(dropSubtitle('Локи - Бог обмана')).toBe('Локи');
    expect(dropSubtitle('Spider-Man')).toBe('Spider-Man');
    expect(parseSearchQuery('Локи: Бог обмана 2021')).toMatchObject({ title: 'Локи: Бог обмана', year: 2021 });
  });
});

describe('normalizeTitle', () => {
  it('folds ё to е, case and punctuation', () => {
    expect(normalizeTitle('Ёлки!')).toBe('елки');
    expect(normalizeTitle('Ёлки')).toBe(normalizeTitle('Елки'));
    expect(normalizeTitle('Локи: Бог')).toBe('локи бог');
    expect(normalizeTitle('LOKI')).toBe('loki');
  });
});

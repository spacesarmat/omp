import { describe, it, expect } from 'vitest';
import { guessCategory, magnetName } from '../src/lib/categoryGuess';

describe('guessCategory', () => {
  it.each([
    ['Северный ветер / Сезон 1 / 1080p', 'tv'],
    ['Show S01E02 WEB-DL', 'tv'],
    ['Show S02', 'tv'],
    ['Show 1x02', 'tv'],
    ['Сериал Тест (Серии 1-8)', 'tv'],
    ['Show Season 3 complete', 'tv'],
    ['Band - Discography FLAC', 'music'],
    ['Артист - Дискография', 'music'],
    ['Movie OST mp3 320 kbps', 'music'],
    ['Альбом 2020 ALAC', 'music'],
    ['Some Movie 2020 1080p', 'movie'],
    ['', ''],
  ])('%s -> %s', (t, c) => expect(guessCategory(t)).toBe(c));
});

describe('magnetName', () => {
  it('decodes dn', () => {
    expect(magnetName('magnet:?xt=urn:btih:a&dn=Show%20S01+x&tr=y')).toBe('Show S01 x');
    expect(magnetName('magnet:?xt=urn:btih:a')).toBe('');
  });
});

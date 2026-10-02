import { describe, it, expect } from 'vitest';
import { posterQuery, tmdbSearchUrl, firstPoster } from '../../src/lib/posterSearch';

describe('posterQuery', () => {
  it('keeps the title before the year, translation and release details', () => {
    expect(posterQuery('Дюна: Часть вторая / Dune: Part Two (2024) WEB-DL 1080p')).toBe('Дюна: Часть вторая');
    expect(posterQuery('Интерстеллар [2014, BDRip]')).toBe('Интерстеллар');
  });

  it('turns release names with dots into words and drops the season and quality', () => {
    expect(posterQuery('The.Last.of.Us.S02.2160p.WEB-DL.x265')).toBe('The Last of Us');
    expect(posterQuery('Severance.S01E03.1080p')).toBe('Severance');
    expect(posterQuery('Oppenheimer.2023.1080p.BluRay')).toBe('Oppenheimer');
  });

  it('limits the query to four words', () => {
    expect(posterQuery('Один два три четыре пять шесть')).toBe('Один два три четыре');
  });

  it('is empty for an empty title', () => {
    expect(posterQuery('')).toBe('');
    expect(posterQuery('   ')).toBe('');
  });
});

describe('tmdbSearchUrl', () => {
  it('builds the multi-search URL in Russian with the key and query', () => {
    expect(tmdbSearchUrl({ APIKey: 'k1', APIURL: 'https://api.themoviedb.org' }, 'Дюна')).toBe(
      'https://api.themoviedb.org/3/search/multi?api_key=k1&language=ru&include_image_language=ru,null,en&query=' +
        encodeURIComponent('Дюна'),
    );
  });

  it('accepts a base with /3, without a scheme, or none at all', () => {
    expect(tmdbSearchUrl({ APIKey: 'k', APIURL: 'https://proxy.example/3/' }, 'x')).toMatch(/^https:\/\/proxy\.example\/3\/search\/multi\?/);
    expect(tmdbSearchUrl({ APIKey: 'k', APIURL: 'proxy.example' }, 'x')).toMatch(/^https:\/\/proxy\.example\/3\/search\/multi\?/);
    expect(tmdbSearchUrl({ APIKey: 'k' }, 'x')).toMatch(/^https:\/\/api\.themoviedb\.org\/3\/search\/multi\?/);
  });
});

describe('firstPoster', () => {
  it('takes the first result with a poster on the Russian image host', () => {
    const results = [{ poster_path: null }, { poster_path: '/a.jpg' }, { poster_path: '/b.jpg' }];
    expect(firstPoster({}, results)).toBe('https://imagetmdb.com/t/p/w300/a.jpg');
    expect(firstPoster({ ImageURLRu: 'img.example/' }, results)).toBe('https://img.example/t/p/w300/a.jpg');
  });

  it('is empty without results', () => {
    expect(firstPoster({}, [])).toBe('');
    expect(firstPoster({}, undefined)).toBe('');
    expect(firstPoster({}, [{ title: 'no poster' }])).toBe('');
  });
});

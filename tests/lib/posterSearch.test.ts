import { describe, it, expect } from 'vitest';
import { posterQuery, tmdbSearchUrl, tmdbSearchRequest, firstPoster } from '../../src/lib/posterSearch';
import { posterChoice, posterName, posterQueries, requestPoster, requestShow, setPosterLookup, setShowLookup, showChoice, type ShowHit } from '../../src/catalog/resultPosters';
import { posterImageSize } from '../../src/catalog/tmdb';

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

  it('a work named by a number keeps that number in the query', () => {
    expect(posterQuery('Бегущий по лезвию 2049 (2017) 2160p')).toBe('Бегущий по лезвию 2049');
    expect(posterQuery('Blade Runner 2049 2017 1080p')).toBe('Blade Runner 2049');
    expect(posterQuery('1917 (2019) 2160p UHD BDRemux')).toBe('1917');
    expect(posterQuery('1917.2019.1080p.BluRay')).toBe('1917');
    expect(posterQuery('2001: Космическая одиссея 1968 BDRip')).toBe('2001: Космическая одиссея');
    expect(posterQuery('1983 2018 WEB-DL 1080p')).toBe('1983');
    // a year-shaped number and a detail mark: the mark still ends the name
    expect(posterQuery('Теория всего 2014 S01 1080p')).toBe('Теория всего');
  });

  it('limits the query to four words', () => {
    expect(posterQuery('Один два три четыре пять шесть')).toBe('Один два три четыре');
  });

  it('is empty for an empty title', () => {
    expect(posterQuery('')).toBe('');
    expect(posterQuery('   ')).toBe('');
  });

  it('a grouped release asks for the show name, and an exact title supplies the poster', () => {
    expect(posterName('Рагнарек · 1 сезон · серии 1-6 из 6')).toBe('Рагнарек');
    const items = [
      { kind: 'movie' as const, id: 1, title: 'Другое', original: '', year: 2024, poster: 'https://img/other.jpg', rating: 1 },
      { kind: 'tv' as const, id: 2, title: 'Рагнарек', original: 'Ragnarok', year: 2024, poster: 'https://img/ragnarok.jpg', rating: 8 },
    ];
    expect(posterChoice(items, 'Рагнарек', 0)).toBe('https://img/ragnarok.jpg');
    expect(posterChoice([], 'Рагнарек', 0)).toBe('');
  });

  it('a series release asks for the Latin title when the local name has no TV poster', async () => {
    const raw = 'Ведьмак / The Witcher / Сезон: 4 / Серии: 1-8 из 8 [2025, фэнтези, WEBRip]';
    expect(posterQueries(raw)).toEqual(['Ведьмак', 'The Witcher']);
    const movie = { kind: 'movie' as const, id: 1, title: 'Ведьмак', original: 'The Hexer', year: 2001, poster: 'https://img/hexer.jpg', rating: 5 };
    const tv = { kind: 'tv' as const, id: 71912, title: 'Ведьмак', original: 'The Witcher', year: 2019, poster: '', rating: 8 };
    const tvEn = { kind: 'tv' as const, id: 71912, title: 'The Witcher', original: 'The Witcher', year: 2019, poster: 'https://img/witcher.jpg', rating: 8 };
    expect(showChoice([movie, tv], 'Ведьмак', 2025, true)).toEqual(tv);
    expect(showChoice([movie], 'Ведьмак', 2001, true)).toBeNull();
    expect(posterChoice([movie, tv], 'Ведьмак', 2025, true)).toBe('');
    expect(posterChoice([tvEn], 'The Witcher', 2025, true)).toBe('https://img/witcher.jpg');
    const asked: string[] = [];
    setPosterLookup((q) => {
      asked.push(q);
      return Promise.resolve(q === 'The Witcher' ? 'https://img/witcher.jpg' : '');
    });
    try {
      const url = await new Promise<string>((resolve) => {
        requestPoster(raw, resolve);
      });
      expect(asked).toEqual(['Ведьмак', 'The Witcher']);
      expect(url).toBe('https://img/witcher.jpg');
    } finally {
      setPosterLookup(null);
    }
  });

  it('a remake of another year does not reuse the first show, and a film is not a series', async () => {
    setShowLookup((_q, year) => {
      if (!year) return Promise.resolve([{ kind: 'movie', id: 9, title: 'Ведьмак', original: 'The Hexer', year: 2001, poster: 'https://img/hexer.jpg', rating: 5 }]);
      const id = year === 1963 ? 1 : 2;
      return Promise.resolve([{ kind: 'tv', id, title: 'Doctor Who', original: 'Doctor Who', year, poster: 'https://img/' + id + '.jpg', rating: 8 }]);
    });
    try {
      const ask = (title: string) => new Promise<ShowHit | null>((resolve) => { requestShow(title, resolve); });
      const oldShow = await ask('Doctor Who (1963) S01');
      const reboot = await ask('Doctor Who (2005) S01');
      const film = await ask('Ведьмак / Сезон: 1');
      expect(oldShow && oldShow.id).toBe(1);
      expect(reboot && reboot.id).toBe(2);
      expect(film).toBeNull();
    } finally {
      setShowLookup(null);
    }
  });
});

describe('tmdbSearchUrl', () => {
  it('builds the multi-search URL in Russian with the key and query', () => {
    expect(tmdbSearchUrl({ APIKey: 'k1', APIURL: 'https://api.themoviedb.org' }, 'Дюна')).toBe(
      'https://api.themoviedb.org/3/search/multi?api_key=k1&language=ru&include_image_language=ru,null,en&query=' +
        encodeURIComponent('Дюна'),
    );
  });

  it('sends a v4 token as a bearer and leaves it out of the URL', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig';
    const req = tmdbSearchRequest({ APIKey: token }, 'Дюна');
    expect(req.url).not.toContain('api_key');
    expect(req.url).toContain('query=' + encodeURIComponent('Дюна'));
    expect(req.headers).toEqual({ Authorization: 'Bearer ' + token });
    expect(tmdbSearchUrl({ APIKey: token }, 'Дюна')).toBe(req.url);
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
    expect(firstPoster({}, results)).toBe('https://imagetmdb.com/t/p/' + posterImageSize() + '/a.jpg');
    expect(firstPoster({ ImageURLRu: 'img.example/' }, results)).toBe('https://img.example/t/p/' + posterImageSize() + '/a.jpg');
  });

  it('is empty without results', () => {
    expect(firstPoster({}, [])).toBe('');
    expect(firstPoster({}, undefined)).toBe('');
    expect(firstPoster({}, [{ title: 'no poster' }])).toBe('');
  });
});

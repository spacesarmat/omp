import { describe, it, expect } from 'vitest';
import { endpointOf, noveltiesUrl, searchUrl, cardUrl, imageUrl, sanitizeList, sanitizeCard, torrentQuery } from '../../src/catalog/tmdb';
import { applyLanguageSetting } from '../../src/i18n';
import { MOVIE_LIST, TV_LIST, MULTI, MOVIE_CARD, TV_CARD } from './fixtures';

const E = endpointOf({ APIKey: 'k1', APIURL: 'api.tmdb.mirror.test', ImageURLRu: 'img.mirror.test' }, 'fallback')!;

describe('endpoint', () => {
  it('prefers the server config, falls back to the built-in key, none without a key', () => {
    expect(E).toEqual({ base: 'https://api.tmdb.mirror.test/3/', key: 'k1', images: 'https://img.mirror.test' });
    expect(endpointOf(null, 'fb')).toEqual({ base: 'https://api.themoviedb.org/3/', key: 'fb', images: 'https://imagetmdb.com' });
    expect(endpointOf({ APIKey: '' }, '')).toBeNull();
  });
});

describe('urls', () => {
  it('novelties: digital releases up to today for films, on the air for series', () => {
    const m = noveltiesUrl(E, 'movie', 2, '2026-10-05');
    expect(m).toContain('https://api.tmdb.mirror.test/3/discover/movie?');
    expect(m).toContain('with_release_type=4');
    expect(m).toContain('release_date.lte=2026-10-05');
    expect(m).toContain('sort_by=primary_release_date.desc');
    expect(m).toContain('vote_count.gte=20');
    expect(m).toContain('language=ru-RU');
    expect(m).toContain('page=2');
    expect(noveltiesUrl(E, 'tv', 1, '2026-10-05')).toContain('/3/tv/on_the_air?');
  });
  it('uses the TMDB language of the app language', () => {
    applyLanguageSetting('en');
    try {
      expect(noveltiesUrl(E, 'movie', 1, '2026-10-05')).toContain('language=en-US');
      expect(cardUrl(E, 'tv', 202)).toContain('include_image_language=en%2Cnull');
    } finally {
      applyLanguageSetting('ru');
    }
  });
  it('search and card', () => {
    expect(searchUrl(E, 'северный ветер', 1)).toContain('/3/search/multi?');
    expect(searchUrl(E, 'северный ветер', 1)).toContain('query=%D1%81%D0%B5%D0%B2%D0%B5%D1%80%D0%BD%D1%8B%D0%B9%20%D0%B2%D0%B5%D1%82%D0%B5%D1%80');
    expect(cardUrl(E, 'tv', 202)).toContain('/3/tv/202?');
    expect(cardUrl(E, 'tv', 202)).toContain('append_to_response=credits');
  });
  it('images through the mirror, empty for junk', () => {
    expect(imageUrl(E, '/p.jpg', 'w300')).toBe('https://img.mirror.test/t/p/w300/p.jpg');
    expect(imageUrl(E, null, 'w300')).toBe('');
    expect(imageUrl(E, 'javascript:x', 'w300')).toBe('');
  });
});

describe('sanitizers', () => {
  it('lists keep films and series, drop people and junk', () => {
    const l = sanitizeList(E, MULTI, null);
    expect(l.items.map((i) => i.kind + ':' + i.id)).toEqual(['movie:101', 'tv:202']);
    expect(l.items[0]).toEqual({ kind: 'movie', id: 101, title: 'Северный ветер', original: 'North Wind', year: 2026, poster: 'https://img.mirror.test/t/p/w300/nw.jpg', rating: 7.4 });
    expect(sanitizeList(E, MOVIE_LIST, 'movie').pages).toBe(3);
    expect(sanitizeList(E, 'junk', 'movie')).toEqual({ items: [], pages: 0 });
  });
  it('a series card has its seasons without specials and the airing state', () => {
    const c = sanitizeCard(E, TV_CARD, 'tv')!;
    expect(c.seasons).toEqual([{ number: 2, episodes: 10, year: 2026, aired: 6 }, { number: 1, episodes: 8, year: 2024, aired: 8 }]);
    expect(c.airing).toBe(true);
    expect(c.cast.length).toBeLessThanOrEqual(8);
    expect(c.runtime).toBeGreaterThan(0);
  });
  it('a film card', () => {
    const c = sanitizeCard(E, MOVIE_CARD, 'movie')!;
    expect(c.genres).toEqual(['драма']);
    expect(c.seasons).toEqual([]);
    expect(sanitizeCard(E, {}, 'movie')).toBeNull();
  });
});

describe('torrent query', () => {
  it('film: title and year; series: title; season: «N сезон»; original when no Russian title', () => {
    expect(torrentQuery({ title: 'Северный ветер', original: 'North Wind', year: 2026, kind: 'movie' })).toBe('Северный ветер 2026');
    expect(torrentQuery({ title: 'Орбитальная станция', original: 'Orbit Station', year: 2024, kind: 'tv' })).toBe('Орбитальная станция');
    expect(torrentQuery({ title: 'Орбитальная станция', original: 'Orbit Station', year: 2024, kind: 'tv' }, 2)).toBe('Орбитальная станция 2 сезон');
    expect(torrentQuery({ title: '', original: 'Orbit Station', year: 2024, kind: 'tv' })).toBe('Orbit Station');
  });
});

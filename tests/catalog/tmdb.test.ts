import { describe, it, expect } from 'vitest';
import { endpointOf, noveltiesUrl, searchUrl, cardUrl, seasonUrl, imageUrl, sanitizeList, sanitizeCard, sanitizeSeason, torrentQuery, statusOf, nextEpisodeOf, readableTitle, englishTitle } from '../../src/catalog/tmdb';
import { applyLanguageSetting } from '../../src/i18n';
import { MOVIE_LIST, TV_LIST, MULTI, MOVIE_CARD, TV_CARD, TV_SEASON } from './fixtures';

const E = endpointOf({ APIKey: 'k1', APIURL: 'api.tmdb.mirror.test', ImageURLRu: 'img.mirror.test' }, 'fallback')!;

describe('titles a Russian or English user can read', () => {
  it('Latin and Cyrillic read, Chinese, Korean and Japanese do not', () => {
    expect(readableTitle('Тёмная материя')).toBe(true);
    expect(readableTitle('Dark Matter')).toBe(true);
    expect(readableTitle('Amélie')).toBe(true);
    expect(readableTitle('仙逆剧场版：弑仙之战')).toBe(false);
    expect(readableTitle('오징어 게임')).toBe(false);
    expect(readableTitle('2046')).toBe(false);
  });

  it('a list title in another script falls back to a readable original; a card to its English translation', () => {
    const list = sanitizeList(E, { results: [{ id: 1, title: '寄生虫', original_title: 'Parasite', release_date: '2019-05-30' }, { id: 2, title: '仙逆剧场版', original_title: '仙逆剧场版', release_date: '2025-01-01' }] }, 'movie');
    expect(list.items.map((x) => x.title)).toEqual(['Parasite', '仙逆剧场版']);
    const raw = {
      id: 2, title: '仙逆剧场版：弑仙之战', original_title: '仙逆剧场版：弑仙之战', release_date: '2025-01-01',
      translations: { translations: [
        { iso_639_1: 'zh', iso_3166_1: 'CN', data: { title: '仙逆' } },
        { iso_639_1: 'en', iso_3166_1: 'GB', data: { title: 'Renegade Immortal (UK)' } },
        { iso_639_1: 'en', iso_3166_1: 'US', data: { title: 'Renegade Immortal: The Battle' } },
      ] },
    };
    expect(sanitizeCard(E, raw, 'movie')!.title).toBe('Renegade Immortal: The Battle');
    expect(englishTitle({ translations: { translations: [{ iso_639_1: 'en', data: { name: '' } }] } }, 'tv')).toBe('');
    // a readable title is kept as it is
    expect(sanitizeCard(E, { ...raw, title: 'Бессмертный' }, 'movie')!.title).toBe('Бессмертный');
  });
});

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
    expect(c.seasons).toEqual([
      { number: 2, episodes: 10, year: 2026, aired: 6, airDate: '2026-08-01' },
      { number: 1, episodes: 8, year: 2024, aired: 8, airDate: '2024-03-01' },
    ]);
    expect(c.airing).toBe(true);
    expect(c.cast.length).toBeLessThanOrEqual(8);
    expect(c.runtime).toBeGreaterThan(0);
  });
  it('a series card has its status, next episode and last air date', () => {
    const c = sanitizeCard(E, { ...TV_CARD, status: ' Returning Series ', last_air_date: '2026-10-05' }, 'tv')!;
    expect(c.status).toBe('returning');
    expect(c.nextEpisode).toEqual({ season: 2, episode: 7, airDate: '2026-10-12' });
    expect(c.lastAirDate).toBe('2026-10-05');
    // nothing known: unknown, never invented
    const bare = sanitizeCard(E, { ...TV_CARD, next_episode_to_air: null, seasons: [{ season_number: 1, episode_count: 3, air_date: null }] }, 'tv')!;
    expect(bare.status).toBe('');
    expect(bare.nextEpisode).toBeNull();
    expect(bare.lastAirDate).toBe('');
    expect(bare.seasons[0].airDate).toBe('');
  });
  it('maps the TMDB statuses to codes', () => {
    expect(statusOf('Returning Series')).toBe('returning');
    expect(statusOf('Ended')).toBe('ended');
    expect(statusOf('Canceled')).toBe('canceled');
    expect(statusOf('Cancelled')).toBe('canceled');
    expect(statusOf('In Production')).toBe('production');
    expect(statusOf('Planned')).toBe('planned');
    expect(statusOf('Pilot')).toBe('planned');
    expect(statusOf('Rumored')).toBe('');
    expect(statusOf(5)).toBe('');
    expect(statusOf(undefined)).toBe('');
  });
  it('validates the next episode and the dates', () => {
    expect(nextEpisodeOf({ season_number: 3, episode_number: 1, air_date: ' 2027-05-03 ' })).toEqual({ season: 3, episode: 1, airDate: '2027-05-03' });
    expect(nextEpisodeOf({ season_number: 3, episode_number: 1, air_date: 'soon' })).toEqual({ season: 3, episode: 1, airDate: '' });
    expect(nextEpisodeOf({ season_number: 0, episode_number: 1 })).toBeNull();
    expect(nextEpisodeOf({ season_number: 2, episode_number: -1 })).toBeNull();
    expect(nextEpisodeOf({ season_number: '2', episode_number: 1 })).toBeNull();
    expect(nextEpisodeOf([1, 2])).toBeNull();
    expect(nextEpisodeOf('x')).toBeNull();
    const c = sanitizeCard(E, { ...TV_CARD, last_air_date: '2026/10/05', seasons: [{ season_number: 1, episode_count: 3, air_date: '<b>' }] }, 'tv')!;
    expect(c.lastAirDate).toBe('');
    expect(c.seasons[0].airDate).toBe('');
  });
  it('a film card has no series fields to speak of', () => {
    const c = sanitizeCard(E, { ...MOVIE_CARD, status: 'Released', next_episode_to_air: { season_number: 1, episode_number: 1 } }, 'movie')!;
    expect(c.status).toBe('');
    expect(c.nextEpisode).toBeNull();
  });
  it('a film card', () => {
    const c = sanitizeCard(E, MOVIE_CARD, 'movie')!;
    expect(c.genres).toEqual(['драма']);
    expect(c.seasons).toEqual([]);
    expect(sanitizeCard(E, {}, 'movie')).toBeNull();
  });
});

describe('season', () => {
  it('the season url keeps the language and the key rules', () => {
    const u = seasonUrl(E, 202, 3);
    expect(u.indexOf('https://api.tmdb.mirror.test/3/tv/202/season/3?')).toBe(0);
    expect(u).toContain('api_key=k1');
    expect(u).toContain('language=ru-RU');
    applyLanguageSetting('en');
    try {
      expect(seasonUrl(E, 202, 3)).toContain('language=en-US');
    } finally {
      applyLanguageSetting('ru');
    }
  });

  it('keeps the season fields and the episodes in order, trimmed, nothing else', () => {
    const s = sanitizeSeason(TV_SEASON, 2)!;
    expect(s).toEqual({
      number: 2, name: 'Сезон 2', airDate: '2026-08-01', overview: 'Экспедиция возвращается.',
      episodes: [
        { n: 1, title: 'Первый лёд', airDate: '2026-08-01', runtime: 48, overview: 'Станция открывается.' },
        { n: 2, title: 'Вторая смена', airDate: '2026-08-08', runtime: 51, overview: 'Связь пропадает.' },
        { n: 3, title: 'Третий день', airDate: '', runtime: 0, overview: '' },
      ],
    });
  });

  it('missing fields get defaults; junk episodes are dropped; the asked number fills a missing one', () => {
    const s = sanitizeSeason({ episodes: [null, 5, { name: 'без номера' }, { episode_number: -1 }, { episode_number: 4, air_date: '2026-13', runtime: 99999, name: 7 }] }, 5)!;
    expect(s).toEqual({ number: 5, name: '', airDate: '', overview: '', episodes: [{ n: 4, title: '', airDate: '', runtime: 0, overview: '' }] });
    expect(sanitizeSeason({ season_number: 1 }, 1)!.episodes).toEqual([]);
    expect(sanitizeSeason({ season_number: 0, episodes: 'x' }, 3)!.number).toBe(0);
    expect(sanitizeSeason(null, 1)).toBeNull();
    expect(sanitizeSeason('x', 1)).toBeNull();
    expect(sanitizeSeason([], 1)).toBeNull();
    expect(sanitizeSeason({ success: false, status_message: 'not found' }, 1)).toBeNull();
  });

  it('caps huge lists at 200 episodes and long strings', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ episode_number: i + 1, name: 'Серия ' + (i + 1), overview: 'о'.repeat(5000) }));
    const s = sanitizeSeason({ season_number: 1, name: 'н'.repeat(500), episodes: many }, 1)!;
    expect(s.episodes).toHaveLength(200);
    expect(s.episodes[199].n).toBe(200);
    expect(s.episodes[0].overview.length).toBe(1500);
    expect(s.name.length).toBe(100);
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

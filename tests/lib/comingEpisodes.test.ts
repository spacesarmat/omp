import { describe, it, expect, afterEach } from 'vitest';
import { lang } from '../../src/i18n';
import {
  comingEpisodeDate,
  comingEpisodeName,
  comingEpisodes,
  comingEpisodeText,
  comingEpisodeTitle,
  type EpisodeMap,
} from '../../src/lib/episodeNames';

const NOW = new Date(2026, 9, 8, 12).getTime();
const TODAY = '2026-10-08';
const ep = (n: number, title: string, airDate: string) => ({ n, title, airDate, runtime: 50, overview: '' });

const eps: EpisodeMap = {
  2: {
    1: ep(1, 'Landfall', '2026-09-10'),
    2: ep(2, 'Dark Orbit', '2026-09-17'),
    3: ep(3, 'Drift', '2026-09-24'),
    4: ep(4, 'Пирамида', TODAY),
    5: ep(5, 'Эпизод 5', '2026-10-15'),
    6: ep(6, 'Undated', ''),
  },
};

afterEach(() => {
  lang.value = 'ru';
});

describe('comingEpisodes (phone torrent screen and TV series screen)', () => {
  it('takes the dated episodes after the last one here, today included, in order', () => {
    expect(comingEpisodes({ 2: 2 }, eps, TODAY)).toEqual([
      { season: 2, episode: 4, name: 'Пирамида', airDate: TODAY },
      { season: 2, episode: 5, name: '', airDate: '2026-10-15' },
    ]);
  });

  it('an episode that is out in the release is no placeholder any more (no duplicate)', () => {
    expect(comingEpisodes({ 2: 4 }, eps, TODAY).map((e) => e.episode)).toEqual([5]);
    expect(comingEpisodes({ 2: 5 }, eps, TODAY)).toEqual([]);
  });

  it('nothing without TMDB data or dates, or for a season the release does not hold', () => {
    expect(comingEpisodes({ 2: 2 }, {}, TODAY)).toEqual([]);
    expect(comingEpisodes({ 2: 2 }, { 2: {} }, TODAY)).toEqual([]);
    expect(comingEpisodes({ 2: 2 }, { 2: { 3: ep(3, 'X', '') } }, TODAY)).toEqual([]);
    expect(comingEpisodes({ 3: 0 }, eps, TODAY)).toEqual([]);
  });

  it('a released episode missing from the release is not announced', () => {
    expect(comingEpisodes({ 2: 1 }, eps, TODAY).map((e) => e.episode)).toEqual([4, 5]);
  });
});

describe('the text of an announced episode', () => {
  const named = { season: 2, episode: 7, name: 'Пирамида', airDate: TODAY };
  const plain = { season: 2, episode: 8, name: '', airDate: '2026-10-15' };

  it('reads «7. Пирамида · выйдет 8 окт.», «Серия 8 · выйдет 15 окт.»', () => {
    expect(comingEpisodeText(named, NOW)).toBe('7. Пирамида · выйдет 8 окт.');
    expect(comingEpisodeText(plain, NOW)).toBe('Серия 8 · выйдет 15 окт.');
    expect(comingEpisodeName(named)).toBe('7. Пирамида');
    expect(comingEpisodeTitle(named)).toBe('Пирамида');
    expect(comingEpisodeTitle(plain)).toBe('Серия 8');
    expect(comingEpisodeDate(plain, NOW)).toBe('выйдет 15 окт.');
  });

  it('in English', () => {
    lang.value = 'en';
    expect(comingEpisodeTitle(plain)).toBe('Episode 8');
    expect(comingEpisodeDate(plain, NOW)).toMatch(/^out /);
  });
});

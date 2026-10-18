import { describe, it, expect, afterEach } from 'vitest';
import { lang } from '../../src/i18n';
import {
  episodesOutOf,
  rememberedSeasonTotal,
  rememberSeasonTotals,
  resetSeasonTotals,
  seasonEpisodeTotal,
} from '../../src/lib/episodesOutOf';

afterEach(() => {
  lang.value = 'ru';
  resetSeasonTotals();
});

describe('episodesOutOf', () => {
  it('Russian: the noun after «из» is genitive and follows the season total', () => {
    expect(episodesOutOf(5, 8)).toBe('5 из 8 серий');
    expect(episodesOutOf(1, 1)).toBe('1 из 1 серии');
    expect(episodesOutOf(2, 21)).toBe('2 из 21 серии');
    expect(episodesOutOf(2, 4)).toBe('2 из 4 серий');
    expect(episodesOutOf(3, 22)).toBe('3 из 22 серий');
    expect(episodesOutOf(5, 11)).toBe('5 из 11 серий');
    // 21 would be «серии» if the word followed the torrent's count
    expect(episodesOutOf(21, 8)).toBe('21 из 8 серий');
    expect(episodesOutOf(1, 8)).toBe('1 из 8 серий');
  });

  it('an unknown total keeps «N серий»', () => {
    expect(episodesOutOf(5, 0)).toBe('5 серий');
    expect(episodesOutOf(1, 0)).toBe('1 серия');
    expect(episodesOutOf(2, 0)).toBe('2 серии');
    expect(episodesOutOf(5, -1)).toBe('5 серий');
  });

  it('English: «5 of 8 episodes», singular only for a total of 1', () => {
    lang.value = 'en';
    expect(episodesOutOf(5, 8)).toBe('5 of 8 episodes');
    expect(episodesOutOf(1, 1)).toBe('1 of 1 episode');
    expect(episodesOutOf(2, 21)).toBe('2 of 21 episodes');
    expect(episodesOutOf(5, 0)).toBe('5 episodes');
    expect(episodesOutOf(1, 0)).toBe('1 episode');
  });
});

describe('seasonEpisodeTotal', () => {
  const ep = (n: number) => ({ [n]: { n: n } });

  it('uses the card episode_count, or the loaded season when it lists more', () => {
    expect(seasonEpisodeTotal(null, null, null)).toBe(0);
    expect(seasonEpisodeTotal({ episodeCounts: { 2: 8 } }, {}, 2)).toBe(8);
    expect(seasonEpisodeTotal({ episodeCounts: { 2: 8 } }, { 2: { ...ep(1), ...ep(2) } }, 2)).toBe(8);
    const eight: { [n: number]: { n: number } } = {};
    for (let i = 1; i <= 10; i++) eight[i] = { n: i };
    expect(seasonEpisodeTotal({ episodeCounts: { 2: 8 } }, { 2: eight }, 2)).toBe(10);
    expect(seasonEpisodeTotal(null, { 2: eight }, 2)).toBe(10);
    expect(seasonEpisodeTotal({ episodeCounts: {} }, {}, 2)).toBe(0);
  });
});

describe('remembered season totals', () => {
  it('keeps the larger count for the next season chip', () => {
    rememberSeasonTotals('show', { 1: 10, 2: 6 });
    expect(rememberedSeasonTotal('show', 1)).toBe(10);
    expect(rememberedSeasonTotal('show', 2)).toBe(6);
    expect(rememberedSeasonTotal('show', 3)).toBe(0);
    rememberSeasonTotals('show', { 2: 8 });
    expect(rememberedSeasonTotal('show', 2)).toBe(8);
    rememberSeasonTotals('show', { 2: 4 });
    expect(rememberedSeasonTotal('show', 2)).toBe(8);
    expect(rememberedSeasonTotal('other', 1)).toBe(0);
    resetSeasonTotals();
    expect(rememberedSeasonTotal('show', 1)).toBe(0);
  });
});

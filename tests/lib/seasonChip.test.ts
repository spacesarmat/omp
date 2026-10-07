import { describe, it, expect, afterEach } from 'vitest';
import { lang } from '../../src/i18n';
import { seasonChipSub } from '../../src/lib/seasonChip';
import { lastEpisodes } from '../../src/lib/episodeNames';

const line = (have: number, total: number, done: number) => {
  const s = seasonChipSub(have, total, done);
  return s.watched ? s.episodes + ' · ' + (s.all ? '✓ ' : '') + s.watched : s.episodes;
};

describe('season chip sub-line: what is there, then what is watched', () => {
  afterEach(() => {
    lang.value = 'ru';
  });

  it('Russian, with the plural of «серия»', () => {
    lang.value = 'ru';
    expect(line(10, 10, 1)).toBe('10 серий · смотрели 1');
    expect(line(10, 0, 0)).toBe('10 серий');
    expect(line(10, 10, 10)).toBe('10 серий · ✓ просмотрено');
    expect(line(6, 10, 1)).toBe('6 из 10 серий · смотрели 1');
    expect(line(1, 0, 0)).toBe('1 серия');
    expect(line(3, 0, 0)).toBe('3 серии');
    expect(line(1, 21, 0)).toBe('1 из 21 серии');
    expect(line(2, 3, 0)).toBe('2 из 3 серий');
    // TMDB listing fewer than the release (a double episode, a stale count) changes nothing
    expect(line(10, 8, 0)).toBe('10 серий');
    expect(seasonChipSub(10, 10, 10).all).toBe(true);
    expect(seasonChipSub(0, 10, 0)).toEqual({ episodes: '0 из 10 серий', watched: '', all: false });
  });

  it('English', () => {
    lang.value = 'en';
    expect(line(10, 10, 1)).toBe('10 episodes · watched 1');
    expect(line(6, 10, 1)).toBe('6 of 10 episodes · watched 1');
    expect(line(10, 0, 10)).toBe('10 episodes · ✓ watched');
    expect(line(1, 0, 0)).toBe('1 episode');
  });
});

describe('lastEpisodes', () => {
  it('the last episode number of each season among the files', () => {
    const f = (id: number, path: string) => ({ id, path, length: 1 });
    expect(lastEpisodes([f(1, 'Show.S01E02.mkv'), f(2, 'Show.S01E06.mkv'), f(3, 'Show.S02E01.mkv'), f(4, 'Extras.mkv')])).toEqual({ 1: 6, 2: 1 });
  });
});

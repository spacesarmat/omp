import { describe, it, expect } from 'vitest';
import {
  viewOptions, nextView, viewLabel, libraryTabs, POSTER_COLORS, posterColor, shortTitle,
  episodeLine, positionLabel, remainingLabel,
} from '../../src/lib/libraryView';

describe('views and tabs', () => {
  it('cycles views', () => {
    expect(viewOptions().map((o) => o.value)).toEqual(['large', 'small', 'list', 'compact']);
    expect(nextView('large')).toBe('small');
    expect(nextView('compact')).toBe('large');
    expect(viewLabel('list')).toBe('Список');
  });
  it('puts history first', () => {
    expect(libraryTabs().map((t) => t.id)).toEqual(['history', 'all', 'movie', 'tv', 'music', 'other']);
    expect(libraryTabs()[0].label).toBe('История');
  });
});

describe('posterColor', () => {
  it('is stable and from the palette', () => {
    expect(POSTER_COLORS).toHaveLength(6);
    const c = posterColor('abcdef0123');
    expect(POSTER_COLORS).toContain(c);
    expect(posterColor('abcdef0123')).toBe(c);
    expect(POSTER_COLORS).toContain(posterColor(''));
  });
});

describe('shortTitle', () => {
  it('keeps the name before year, season and quality', () => {
    expect(shortTitle('Star.Trek.Strange.New.Worlds.S04.1080p.Ru.Ultradox')).toBe('Star Trek Strange New Worlds');
    expect(shortTitle('Signal.One.2026.x265.WEB-DL.2160p.SDR.mkv')).toBe('Signal One');
    expect(shortTitle('Внешняя угроза / The Outer Threat [2026, Канада]')).toBe('Внешняя угроза');
    expect(shortTitle('Futurama.S14E09.1080p.ColdFilm.mkv')).toBe('Futurama');
    expect(shortTitle('Clevatess II [WEB-DL 1080p]')).toBe('Clevatess II');
    expect(shortTitle('1917')).toBe('1917');
    expect(shortTitle('')).toBe('?');
  });
});

describe('history labels', () => {
  it('describes the episode', () => {
    expect(episodeLine('Star.Trek.SNW.S04E03.1080p.mkv', false)).toBe('Сезон 4 · Серия 3');
    expect(episodeLine('Signal.One.2026.mkv', true)).toBe('Фильм');
    expect(episodeLine('Folder/Some File.mkv', false)).toBe('Some File');
  });
  it('formats position and time left', () => {
    expect(positionLabel(1394, 3651)).toBe('23:14 / 1:00:51');
    expect(positionLabel(65, 0)).toBe('1:05');
    expect(remainingLabel(1394, 3651)).toBe('осталось 38 мин');
    expect(remainingLabel(1683, 10620)).toBe('осталось 2 ч 29 мин');
    expect(remainingLabel(0, 7200)).toBe('осталось 2 ч');
    expect(remainingLabel(100, 120)).toBe('осталось меньше минуты');
    expect(remainingLabel(5, 0)).toBe('');
  });
});

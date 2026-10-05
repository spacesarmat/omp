import { describe, it, expect, afterEach } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import {
  viewOptions, nextView, viewLabel, libraryTabs, POSTER_COLORS, posterColor, shortTitle,
  episodeLine, positionLabel, remainingLabel, libraryTitle,
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

describe('libraryTitle', () => {
  afterEach(() => applyLanguageSetting('ru'));
  const tor = (title: string) => ({ hash: 'a'.repeat(40), title });
  it('a film: the first title variant and the year', () => {
    expect(libraryTitle(tor('Человек-паук: Новый день / Spider-Man: Brand New Day (2026) WEB-DL 1080p'))).toEqual({ title: 'Человек-паук: Новый день', meta: '2026' });
    expect(libraryTitle(tor('Аватар: Пламя и Пепел / Avatar: Fire and Ash (Джеймс Кэмерон) [2025, США, фантастика, WEB-DL 2160p]'))).toEqual({ title: 'Аватар: Пламя и Пепел', meta: '2025' });
  });
  it('a plain name with the year in brackets: the year moves to the meta', () => {
    expect(libraryTitle(tor('Последний богатырь (2026)'))).toEqual({ title: 'Последний богатырь', meta: '2026' });
    expect(libraryTitle(tor('Последний богатырь'))).toEqual({ title: 'Последний богатырь', meta: '' });
  });
  it('a series: season and episodes', () => {
    expect(libraryTitle(tor('Темная материя / Dark Matter / Сезон: 2 / Серии: 1-6 из 10 (Алик Сахаров) [2026, США, WEB-DL 1080p]'))).toEqual({ title: 'Темная материя', meta: '2 сезон · серии 1–6 из 10' });
    expect(libraryTitle(tor('Starbound Frontier S02 1080p WEB-DL'))).toEqual({ title: 'Starbound Frontier', meta: '2 сезон' });
    expect(libraryTitle(tor('Дом дракона 2 сезон 1-8 серии из 8 [2024, WEB-DL]'))).toEqual({ title: 'Дом дракона', meta: '2 сезон · серии 1–8 из 8' });
    expect(libraryTitle(tor('Starbound.Frontier.S01-S03.1080p'))).toEqual({ title: 'Starbound Frontier', meta: 'сезоны 1–3' });
    expect(libraryTitle(tor('Starbound.Frontier.S02E05.1080p'))).toEqual({ title: 'Starbound Frontier', meta: '2 сезон · серия 5' });
  });
  it('a raw release name without separators', () => {
    expect(libraryTitle(tor('Signal.One.2026.x265.WEB-DL.2160p.SDR'))).toEqual({ title: 'Signal One', meta: '2026' });
    expect(libraryTitle(tor('Тихий сигнал 2160p'))).toEqual({ title: 'Тихий сигнал', meta: '' });
  });
  it('a name typed by the user (renamed) stays as is', () => {
    expect(libraryTitle(tor('Neon Rivers'))).toEqual({ title: 'Neon Rivers', meta: '' });
    expect(libraryTitle(tor('Дюна (2021)'))).toEqual({ title: 'Дюна (2021)', meta: '' });
    expect(libraryTitle(tor('Дом дракона — 2 сезон'))).toEqual({ title: 'Дом дракона — 2 сезон', meta: '' });
  });
  it('a placeholder title: the name derived from the files', () => {
    const files = JSON.stringify({ TorrServer: { Files: [{ id: 1, path: 'Show.S01E01.mkv', length: 1 }, { id: 2, path: 'Show.S01E02.mkv', length: 1 }] } });
    expect(libraryTitle({ hash: 'a'.repeat(40), title: 'a'.repeat(40), data: files })).toEqual({ title: 'Show · Сезон 1', meta: '' });
  });
  it('English meta', () => {
    applyLanguageSetting('en');
    expect(libraryTitle(tor('Темная материя / Dark Matter / Сезон: 2 / Серии: 1-6 из 10 [2026]')).meta).toBe('season 2 · episodes 1–6 of 10');
    expect(libraryTitle(tor('Starbound.Frontier.S01-S03.1080p')).meta).toBe('seasons 1–3');
    expect(libraryTitle(tor('Show.S02E05.1080p')).meta).toBe('season 2 · episode 5');
    expect(libraryTitle(tor('Show / Шоу / Серии: 1-6 [2026]')).meta).toBe('episodes 1–6');
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

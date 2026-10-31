import { describe, it, expect } from 'vitest';
import { episodesNote } from '../../src/monitor/upgradeText';
import type { LibraryTorrent } from '../../src/monitor/newEpisodes';

const files = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, path: 'Show.S01E0' + (i + 1) + '.mkv', length: 1 }));
const SERIES: LibraryTorrent = { hash: 'h', title: 'Квест Вижна / VisionQuest [S01] (2026) 1080p', category: 'tv', data: '', file_stats: files(8) };
const FILM: LibraryTorrent = { hash: 'f', title: 'Quiet Signal (2025) 1080p', category: 'movie', data: '', file_stats: [] };

describe('episodesNote («Найти в лучшем качестве» rows of a series)', () => {
  it('the season and the episode count from the title', () => {
    expect(episodesNote(SERIES, { Title: 'Квест Вижна / VisionQuest (2026) WEB-DL 1080p | Сезон 1, Серии 1-8 из 8' })).toBe('S01 · 8 серий');
    expect(episodesNote(SERIES, { Title: 'VisionQuest.S01E01-08.2160p' })).toBe('S01 · 8 серий');
  });

  it('a season not complete yet: the range and the total', () => {
    expect(episodesNote(SERIES, { Title: 'Квест Вижна [S01] Серии 1-6 из 8' })).toBe('S01 · серии 1-6 из 8');
  });

  it('only the season when the title names no episodes', () => {
    expect(episodesNote(SERIES, { Title: 'Квест Вижна [S01] 1080p WEB-DL' })).toBe('S01');
  });

  it('nothing for a pack of seasons, a title without a season, or a film', () => {
    expect(episodesNote(SERIES, { Title: 'Квест Вижна Сезоны 1-3 1080p' })).toBe('');
    expect(episodesNote(SERIES, { Title: 'Квест Вижна 1080p' })).toBe('');
    expect(episodesNote(FILM, { Title: 'Quiet Signal S01 1080p' })).toBe('');
  });
});

import { describe, it, expect } from 'vitest';
import { episodePageLabel, seasonEpisodeModels, watchedCount } from '../../src/lib/seasonEpisodes';

const files = [
  { id: 1, path: 'Show/S01E01-E02.mkv', length: 10 },
  { id: 3, path: 'Show/S01E03.mkv', length: 5 },
  { id: 5, path: 'Show/S01E05.mkv', length: 5 },
];

const tmdb = [
  { episode: 1, title: 'Пилот', runtime: 45 },
  { episode: 2, title: 'Вторая', runtime: 46 },
  { episode: 3, title: 'Третья', runtime: 44 },
  { episode: 4, title: 'Пропала', runtime: 40 },
  { episode: 5, title: 'Пятая', runtime: 42 },
];

describe('seasonEpisodeModels', () => {
  it('shows a combined file once and a missing episode as its own row', () => {
    const rows = seasonEpisodeModels(files, 1, tmdb);
    expect(rows.map((r) => r.title)).toEqual([
      '1-2. Пилот',
      '3. Третья',
      '4. Пропала - нет в раздаче',
      '5. Пятая',
    ]);
    expect(rows[0].missing).toBe(false);
    expect(rows[0].numbers).toEqual([1, 2]);
    expect(rows[2].missing).toBe(true);
    expect(rows[2].fileId).toBeNull();
  });

  it('keeps every episode of an underscore range in one row', () => {
    const rows = seasonEpisodeModels([
      { id: 1, path: 'Show_-_001-002_1080p.mkv', length: 1 },
    ], 0, [{ episode: 2, title: 'Вторая', runtime: 20 }]);
    expect(rows[0].numbers).toEqual([1, 2]);
    expect(rows.filter((r) => r.missing)).toEqual([]);
  });

  it('numbers an underscore release name instead of keeping the file name', () => {
    const rows = seasonEpisodeModels([
      { id: 6, path: 'Black_Clover_-_006_RUS_JP_ENG_Judas.mkv', length: 1 },
    ], 0, []);
    expect(rows[0].numbers).toEqual([6]);
    expect(rows[0].title).toBe('6.');
  });

  it('keeps a seasonless episode and a file the parser cannot number', () => {
    const rows = seasonEpisodeModels([
      { id: 1, path: 'Show.E01.mkv', length: 1 },
      { id: 2, path: 'extras/interview.mkv', length: 1 },
    ], 2, []);
    expect(rows.map((r) => r.fileId)).toEqual([1, 2]);
    expect(rows[0].numbers).toEqual([1]);
    expect(rows[1].title).toBe('interview');
  });

  it('labels a page by its episode numbers, not by the row count', () => {
    const rows = [];
    for (let n = 101; n <= 160; n++) rows.push({ numbers: [n] });
    expect(episodePageLabel(rows, 0)).toBe('101-150');
    expect(episodePageLabel(rows, 50)).toBe('151-160');
    expect(episodePageLabel([{ numbers: [7, 8] }], 0)).toBe('7-8');
  });

  it('counts a watched combined file as every episode it holds', () => {
    const rows = seasonEpisodeModels(files, 1, tmdb);
    const ratio = (id: number) => (id === 1 ? 1 : 0);
    expect(watchedCount(rows, ratio)).toEqual({ have: 2, total: 5 });
    const plain = seasonEpisodeModels([{ id: 9, path: 'extras/interview.mkv', length: 1 }], 0, []);
    expect(watchedCount(plain, () => 1)).toEqual({ have: 1, total: 1 });
  });
});

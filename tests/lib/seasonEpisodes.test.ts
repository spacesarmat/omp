import { describe, it, expect } from 'vitest';
import { seasonEpisodeModels, watchedCount } from '../../src/lib/seasonEpisodes';

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

  it('counts a watched combined file as every episode it holds', () => {
    const rows = seasonEpisodeModels(files, 1, tmdb);
    const ratio = (id: number) => (id === 1 ? 1 : 0);
    expect(watchedCount(rows, ratio)).toEqual({ have: 2, total: 5 });
  });
});

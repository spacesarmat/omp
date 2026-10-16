import { describe, it, expect, beforeEach } from 'vitest';
import type { Torrent } from '../../src/api/types';
import type { CatalogCard } from '../../src/catalog/tmdb';
import { episodeRatio, episodeSizes, seriesWatchSpot } from '../src/screens/catalog/seriesWatch';
import { torrents } from '../../src/store/library';
import { reloadProgress, saveProgress } from '../../src/store/progress';

const card = {
  title: 'Ледяной перевал',
  original: 'Frost Pass',
  seasons: [{ number: 1 }],
} as CatalogCard;

function tor(hash: string, title: string, id: number, path: string, length: number): Torrent {
  return { hash, title, file_stats: [{ id, path, length }] } as Torrent;
}

beforeEach(() => {
  localStorage.clear();
  reloadProgress();
  torrents.value = [];
});

describe('series watch spot', () => {
  const first = tor('ha', 'Ледяной перевал / Сезон: 1 WEB-DL', 1, 'Show.S01E01.mkv', 2_000_000_000);
  const second = tor('hb', 'Ледяной перевал S01 2160p', 2, 'Show.S01E02.mkv', 800_000_000);

  it('resumes the episode saved most recently, and sees every torrent of the season', () => {
    const list = [first, second];
    torrents.value = list;
    saveProgress('ha', 1, 1200, 3600);
    saveProgress('hb', 2, 300, 3600);
    const spot = seriesWatchSpot(list, card, 1);
    expect(spot?.hash).toBe('hb');
    expect(spot?.file.id).toBe(2);
    expect(spot?.at).toBe(300);
    expect(episodeSizes(list, card, 1)).toEqual({ 1: 2_000_000_000, 2: 800_000_000 });
  });

  it('shows each episode its own progress, including a finished one', () => {
    const list = [first, second];
    torrents.value = list;
    saveProgress('ha', 1, 3500, 3600);
    saveProgress('hb', 2, 300, 3600);
    expect(episodeRatio(list, card, 1, 1)).toBe(1);
    expect(episodeRatio(list, card, 1, 2)).toBeCloseTo(300 / 3600);
    expect(episodeRatio(list, card, 1, 3)).toBe(0);
  });
});

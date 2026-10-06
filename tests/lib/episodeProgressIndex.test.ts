// The series grouping is computed once per torrent list: titles are parsed O(n) per list, not per file asked.
import { describe, it, expect, vi } from 'vitest';
import type { Torrent } from '../../src/api/types';

const counted = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../src/monitor/newEpisodes', async (orig) => {
  const m = await orig<typeof import('../../src/monitor/newEpisodes')>();
  return {
    ...m,
    seriesNames: (title: string) => {
      counted.calls++;
      return m.seriesNames(title);
    },
  };
});

import { episodeProgress } from '../../src/lib/episodeProgress';

const reader = { local: () => null, server: () => null };

function library(n: number): Torrent[] {
  const out: Torrent[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      hash: 'h' + i,
      title: 'Series Number ' + i + ' S01 1080p',
      category: 'tv',
      stat: 3,
      file_stats: Array.from({ length: 10 }, (_, e) => ({ id: e + 1, path: 'S01E' + (e + 1 < 10 ? '0' : '') + (e + 1) + '.mkv', length: 1 })),
    });
  }
  return out;
}

describe('episodeProgress index', () => {
  it('parses each title once per list, however many files are asked', () => {
    const list = library(200);
    counted.calls = 0;
    for (let t = 0; t < 20; t++) for (let f = 1; f <= 10; f++) episodeProgress(list, 'h' + t, f, reader);
    expect(counted.calls).toBe(200);
    // a new list (the store replaces the array on a change) is indexed again, once
    const next = list.slice();
    counted.calls = 0;
    episodeProgress(next, 'h1', 1, reader);
    episodeProgress(next, 'h2', 1, reader);
    expect(counted.calls).toBe(200);
  });
});

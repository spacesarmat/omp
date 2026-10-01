import { describe, it, expect, beforeEach } from 'vitest';
import { torrents, refreshTorrents } from '../../src/store/library';

beforeEach(() => {
  localStorage.clear();
  torrents.value = [];
});

describe('library store', () => {
  it('refreshes, sorts newest first and caches slim copy', async () => {
    await refreshTorrents({
      list: () => Promise.resolve([
        { hash: '1', title: 'Old', stat: 5, timestamp: 1, download_speed: 5 },
        { hash: '2', title: 'New', stat: 5, timestamp: 2 },
      ]),
    });
    expect(torrents.value.map((t) => t.hash)).toEqual(['2', '1']);
    const cached = JSON.parse(localStorage.getItem('tsp.torrents')!);
    expect(cached[1].download_speed).toBeUndefined();
    expect(cached[1].title).toBe('Old');
  });
});

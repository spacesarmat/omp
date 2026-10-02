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
  it('does not start a second request while one is in flight', async () => {
    let resolve!: (v: any) => void;
    let calls = 0;
    const c = { list: () => { calls++; return new Promise<any>((r) => { resolve = r; }); } };
    const p1 = refreshTorrents(c);
    const p2 = refreshTorrents(c);
    expect(p2).toBe(p1);
    expect(calls).toBe(1);
    resolve([]);
    await p1;
    await refreshTorrents({ list: () => { calls++; return Promise.resolve([]); } });
    expect(calls).toBe(2);
  });
  it('allows a new request after a failure', async () => {
    await expect(refreshTorrents({ list: () => Promise.reject(new Error('x')) })).rejects.toThrow('x');
    await refreshTorrents({ list: () => Promise.resolve([]) });
  });
});

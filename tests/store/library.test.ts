import { describe, it, expect, beforeEach } from 'vitest';
import { torrents, refreshTorrents, resetLibrary, addedTorrents, addedMessage } from '../../src/store/library';

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
  it('ignores a stale response from a previous server after reset', async () => {
    let resolveA!: (v: any) => void;
    const a = { list: () => new Promise<any>((r) => { resolveA = r; }) };
    const pA = refreshTorrents(a);
    resetLibrary();
    resolveA([{ hash: 'a', title: 'A', stat: 5 }]);
    await pA;
    expect(torrents.value).toEqual([]);
    expect(JSON.parse(localStorage.getItem('tsp.torrents')!)).toEqual([]);
    let calls = 0;
    const b = { list: () => { calls++; return Promise.resolve([{ hash: 'b', title: 'B', stat: 5 }]); } };
    await refreshTorrents(b);
    expect(calls).toBe(1);
    expect(torrents.value.map((t) => t.hash)).toEqual(['b']);
  });
});

describe('added torrents', () => {
  const t = (hash: string, title = hash) => ({ hash, title, stat: 5 });
  it('detects new hashes only when there was a previous list', () => {
    expect(addedTorrents([], [t('a')])).toEqual([]);
    expect(addedTorrents([t('a')], [t('a'), t('b')]).map((x) => x.hash)).toEqual(['b']);
    expect(addedTorrents([t('a'), t('b')], [t('a')])).toEqual([]);
  });
  it('formats the message', () => {
    expect(addedMessage([])).toBeNull();
    expect(addedMessage([t('a', 'Фильм'), t('b', 'Сериал')])).toBe('Добавлено: Фильм, Сериал');
    expect(addedMessage([t('a'), t('b'), t('c'), t('d')])).toBe('Добавлено торрентов: 4');
  });
});

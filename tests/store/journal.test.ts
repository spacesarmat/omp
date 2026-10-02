import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordWatch, forgetWatch, type JournalClient } from '../../src/store/journal';
import { torrents } from '../../src/store/library';
import { journalOf } from '../../src/lib/journal';
import type { Torrent } from '../../src/api/types';

const T0 = 1_759_400_000_000;

function fakeServer(initial: Partial<Torrent>) {
  const t: Torrent = { hash: 'h', title: 'Title', poster: 'http://p.jpg', category: 'tv', stat: 5, ...initial };
  const sets: any[] = [];
  const c = {
    get: vi.fn((_hash: string) => Promise.resolve({ ...t })),
    setData: vi.fn((x: Pick<Torrent, 'hash' | 'title' | 'poster' | 'category'>, data: string) => {
      sets.push({ hash: x.hash, title: x.title, poster: x.poster, category: x.category, data });
      t.data = data;
      return Promise.resolve();
    }),
  };
  return { c: c as JournalClient & typeof c, t, sets };
}

beforeEach(() => {
  torrents.value = [];
});

describe('recordWatch', () => {
  it('reads the torrent, writes data with the current title/poster/category, keeps other keys', async () => {
    const s = fakeServer({ data: JSON.stringify({ TorrServer: { Files: [{ id: 1, path: 'a.mkv', length: 1 }] }, lampa: 1 }) });
    await recordWatch(s.c, 'h', { f: 1, t: 30, d: 100, src: 'tv' }, T0);
    expect(s.sets).toHaveLength(1);
    expect(s.sets[0]).toMatchObject({ hash: 'h', title: 'Title', poster: 'http://p.jpg', category: 'tv' });
    const out = JSON.parse(s.sets[0].data);
    expect(out.lampa).toBe(1);
    expect(out.TorrServer.Files).toHaveLength(1);
    expect(out.omp).toEqual({ v: 1, h: [{ f: 1, t: 30, d: 100, at: T0, src: 'tv' }] });
  });

  it('never touches non-JSON data', async () => {
    const s = fakeServer({ data: 'someone else' });
    await recordWatch(s.c, 'h', { f: 1, t: 30, d: 100, src: 'tv' }, T0);
    expect(s.c.setData).not.toHaveBeenCalled();
  });

  it('empty data is seeded with the file list TorrServer would add', async () => {
    const s = fakeServer({ data: '', file_stats: [{ id: 1, path: 'a.mkv', length: 9 }] });
    await recordWatch(s.c, 'h', { f: 1, t: 30, d: 100, src: 'tv' }, T0);
    expect(JSON.parse(s.sets[0].data).TorrServer).toEqual({ Files: [{ id: 1, path: 'a.mkv', length: 9 }] });
  });

  it('chains writes of one torrent: each reads the previous result', async () => {
    const s = fakeServer({ data: '{}' });
    const p1 = recordWatch(s.c, 'h', { f: 1, t: 1, d: 9, src: 'tv' }, T0);
    const p2 = recordWatch(s.c, 'h', { f: 2, t: 2, d: 9, src: 'phone', name: 'Pixel' }, T0 + 1);
    await Promise.all([p1, p2]);
    expect(journalOf(s.t.data).map((e) => e.f)).toEqual([2, 1]);
  });

  it('swallows read and write errors', async () => {
    const c = { get: vi.fn(() => Promise.reject(new Error('down'))), setData: vi.fn() };
    await expect(recordWatch(c, 'h', { f: 1, t: 1, d: 1, src: 'tv' })).resolves.toBeUndefined();
    const s = fakeServer({ data: '{}' });
    s.c.setData.mockImplementationOnce(() => Promise.reject(new Error('403')));
    await expect(recordWatch(s.c, 'h', { f: 1, t: 1, d: 1, src: 'tv' })).resolves.toBeUndefined();
    // the chain goes on after a failure
    await recordWatch(s.c, 'h', { f: 1, t: 2, d: 1, src: 'tv' }, T0);
    expect(journalOf(s.t.data)[0].t).toBe(2);
  });

  it('without a client does nothing', async () => {
    await expect(recordWatch(null, 'h', { f: 1, t: 1, d: 1, src: 'tv' })).resolves.toBeUndefined();
  });

  it('updates the library copy of the torrent', async () => {
    torrents.value = [{ hash: 'h', title: 'Title', stat: 5, data: '{}' }];
    const s = fakeServer({ data: '{}' });
    await recordWatch(s.c, 'h', { f: 1, t: 1, d: 1, src: 'tv' }, T0);
    expect(journalOf(torrents.value[0].data)).toHaveLength(1);
  });
});

describe('forgetWatch', () => {
  it('drops the file from the library copy at once and from the server', async () => {
    const data = JSON.stringify({ lampa: 1, omp: { v: 1, h: [{ f: 1, t: 1, d: 2, at: T0, src: 'tv' }, { f: 2, t: 1, d: 2, at: T0, src: 'tv' }] } });
    torrents.value = [{ hash: 'h', title: 'Title', stat: 5, data }];
    const s = fakeServer({ data });
    const p = forgetWatch(s.c, 'h', 1);
    expect(journalOf(torrents.value[0].data).map((e) => e.f)).toEqual([2]);
    await p;
    expect(journalOf(s.t.data).map((e) => e.f)).toEqual([2]);
    expect(JSON.parse(s.t.data!).lampa).toBe(1);
  });

  it('no write when the file has no entries', async () => {
    const s = fakeServer({ data: JSON.stringify({ omp: { v: 1, h: [{ f: 2, t: 1, d: 2, at: T0, src: 'tv' }] } }) });
    await forgetWatch(s.c, 'h', 1);
    expect(s.c.setData).not.toHaveBeenCalled();
  });
});

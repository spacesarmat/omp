import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordWatch, forgetWatch, loadSkip, saveSkip, loadWatch, saveWatch, type JournalClient } from '../../src/store/journal';
import { torrents } from '../../src/store/library';
import { journalOf } from '../../src/lib/journal';
import type { Torrent } from '../../src/api/types';

const T0 = 1_759_400_000_000;

function fakeServer(initial: Partial<Torrent>) {
  const t: Torrent = { hash: 'h', title: 'Title', poster: 'http://p.jpg', category: 'tv', stat: 5, ...initial };
  const sets: any[] = [];
  const c = {
    list: vi.fn(() => Promise.resolve([{ ...t }])),
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

  it('reads the torrent from the list, matching the hash case-insensitively', async () => {
    const s = fakeServer({ hash: 'ABCDEF', data: '{}' });
    await recordWatch(s.c, 'abcdef', { f: 1, t: 30, d: 100, src: 'tv' }, T0);
    expect(s.c.list).toHaveBeenCalled();
    expect(s.sets).toHaveLength(1);
    expect(s.sets[0].hash).toBe('ABCDEF');
  });

  it('does nothing when the torrent is not in the list', async () => {
    const s = fakeServer({ hash: 'other', data: '{}' });
    await recordWatch(s.c, 'h', { f: 1, t: 30, d: 100, src: 'tv' }, T0);
    expect(s.c.setData).not.toHaveBeenCalled();
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
    const c = { list: vi.fn(() => Promise.reject(new Error('down'))), setData: vi.fn() };
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

describe('loadSkip / saveSkip', () => {
  it('loadSkip: defaults when nothing is stored or the torrent is unknown', async () => {
    const s = fakeServer({ data: '{}' });
    expect(await loadSkip(s.c, 'h')).toEqual({ i: false, c: false });
    expect(await loadSkip(s.c, 'nope')).toEqual({ i: false, c: false });
    const s2 = fakeServer({ data: JSON.stringify({ omp: { v: 1, h: [], s: { i: true, c: false, mi: [1, 9] } } }) });
    expect(await loadSkip(s2.c, 'H')).toEqual({ i: true, c: false, mi: [1, 9] });
  });

  it('saveSkip writes s, keeps history, other keys, title/poster/category', async () => {
    const entry = { f: 1, t: 30, d: 100, at: T0, src: 'tv' };
    const s = fakeServer({ data: JSON.stringify({ lampa: 1, omp: { v: 1, h: [entry] } }) });
    const r = await saveSkip(s.c, { hash: 'h' }, { i: true, mi: [45, 135] });
    expect(r).toEqual({ i: true, c: false, mi: [45, 135] });
    expect(s.sets[0]).toMatchObject({ title: 'Title', poster: 'http://p.jpg', category: 'tv' });
    const out = JSON.parse(s.sets[0].data);
    expect(out.lampa).toBe(1);
    expect(out.omp).toEqual({ v: 1, h: [entry], s: { i: true, c: false, mi: [45, 135] } });
  });

  it('saveSkip merges into the stored value and null removes a mark', async () => {
    const s = fakeServer({ data: JSON.stringify({ omp: { v: 1, h: [], s: { i: true, c: true, mi: [1, 9], mc: 60 } } }) });
    const r = await saveSkip(s.c, { hash: 'h' }, { c: false, mi: null });
    expect(r).toEqual({ i: true, c: false, mc: 60 });
    expect(JSON.parse(s.t.data!).omp.s).toEqual({ i: true, c: false, mc: 60 });
  });

  it('saveSkip drops bad marks instead of writing them', async () => {
    const s = fakeServer({ data: '{}' });
    const r = await saveSkip(s.c, { hash: 'h' }, { i: true, mi: [90, 30], mc: NaN });
    expect(r).toEqual({ i: true, c: false });
    expect(JSON.parse(s.t.data!).omp.s).toEqual({ i: true, c: false });
  });

  it('loadWatch / saveWatch switch omp.w, keeping the history, the marks and other keys', async () => {
    const entry = { f: 1, t: 30, d: 100, at: T0, src: 'tv' };
    const s = fakeServer({ data: JSON.stringify({ lampa: 1, omp: { v: 1, h: [entry], s: { i: true, c: false, mc: 60 } } }) });
    expect(await loadWatch(s.c, 'h')).toBe(true);
    expect(await loadWatch(s.c, 'nope')).toBe(true);
    expect(await saveWatch(s.c, { hash: 'h' }, false)).toBe(false);
    expect(JSON.parse(s.t.data!)).toEqual({ lampa: 1, omp: { v: 1, h: [entry], s: { i: true, c: false, mc: 60 }, w: false } });
    expect(await loadWatch(s.c, 'h')).toBe(false);
    // the skip settings and the history writes keep it
    await saveSkip(s.c, { hash: 'h' }, { c: true });
    await recordWatch(s.c, 'h', { f: 2, t: 5, d: 50, src: 'tv' }, T0 + 1);
    expect(JSON.parse(s.t.data!).omp.w).toBe(false);
    const writes = s.sets.length;
    expect(await saveWatch(s.c, { hash: 'h' }, false)).toBe(false);
    expect(s.sets.length).toBe(writes);
    expect(await saveWatch(s.c, { hash: 'h' }, true)).toBe(true);
    expect(JSON.parse(s.t.data!).omp.w).toBeUndefined();
    expect(JSON.parse(s.t.data!).omp.s).toEqual({ i: true, c: true, mc: 60 });
    await expect(saveWatch(s.c, { hash: 'nope' }, false)).rejects.toThrow('Раздачи нет на сервере');
    await expect(saveWatch(fakeServer({ data: 'plain' }).c, { hash: 'h' }, false)).rejects.toThrow('Данные раздачи не в формате JSON');
  });

  it('writing history afterwards keeps s', async () => {
    const s = fakeServer({ data: '{}' });
    await saveSkip(s.c, { hash: 'h' }, { c: true });
    await recordWatch(s.c, 'h', { f: 1, t: 5, d: 50, src: 'tv' }, T0);
    const omp = JSON.parse(s.t.data!).omp;
    expect(omp.s).toEqual({ i: false, c: true });
    expect(omp.h).toHaveLength(1);
  });

  it('forgetWatch keeps s too', async () => {
    const data = JSON.stringify({ omp: { v: 1, h: [{ f: 1, t: 1, d: 2, at: T0, src: 'tv' }], s: { i: true, c: false } } });
    torrents.value = [{ hash: 'h', title: 'Title', stat: 5, data }];
    const s = fakeServer({ data });
    await forgetWatch(s.c, 'h', 1);
    expect(JSON.parse(torrents.value[0].data!).omp.s).toEqual({ i: true, c: false });
    expect(JSON.parse(s.t.data!).omp.s).toEqual({ i: true, c: false });
  });

  it('saveSkip rejects on non-JSON data, an unknown torrent and a failed write; later saves still work', async () => {
    const bad = fakeServer({ data: 'not json' });
    await expect(saveSkip(bad.c, { hash: 'h' }, { i: true })).rejects.toBeTruthy();
    expect(bad.c.setData).not.toHaveBeenCalled();
    await expect(saveSkip(bad.c, { hash: 'zzz' }, { i: true })).rejects.toBeTruthy();
    const s = fakeServer({ data: '{}' });
    s.c.setData.mockImplementationOnce(() => Promise.reject(new Error('net')));
    await expect(saveSkip(s.c, { hash: 'h' }, { i: true })).rejects.toBeTruthy();
    await expect(saveSkip(s.c, { hash: 'h' }, { i: true })).resolves.toEqual({ i: true, c: false });
  });

  it('no write when nothing changes', async () => {
    const s = fakeServer({ data: JSON.stringify({ omp: { v: 1, h: [], s: { i: true, c: false } } }) });
    await saveSkip(s.c, { hash: 'h' }, { i: true });
    expect(s.c.setData).not.toHaveBeenCalled();
  });
});

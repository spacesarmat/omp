import { describe, it, expect, vi, beforeEach } from 'vitest';
import { carryMap, carryWatch, mergeJournals, pickKeeper, seasonFiles, forgetRemoved, type CarryClient } from '../../src/store/releaseCarry';
import { getLocalProgress, reloadProgress, resetViewed, saveProgress, serverViewed } from '../../src/store/progress';
import { parseData, type JournalEntry } from '../../src/lib/journal';
import { NO_SEASON } from '../../src/lib/seriesGroups';
import type { Torrent } from '../../src/api/types';

const T0 = 1_759_400_000_000;

function files(names: string[]) {
  return names.map((p, i) => ({ id: i + 1, path: p, length: 1000 + i }));
}

function dataOf(f: { id: number; path: string; length: number }[], omp?: { [k: string]: unknown }) {
  return JSON.stringify(omp ? { TorrServer: { Files: f }, omp: { v: 1, ...omp } } : { TorrServer: { Files: f } });
}

function tor(hash: string, names: string[], omp?: { [k: string]: unknown }, extra?: Partial<Torrent>): Torrent {
  const f = files(names);
  return { hash, title: hash + ' title', stat: 5, file_stats: f, data: dataOf(f, omp), ...(extra || {}) };
}

function fakeClient(list: Torrent[], opts: { failSet?: boolean; dropWrite?: boolean; failViewed?: boolean } = {}) {
  const server: { [h: string]: Torrent } = {};
  list.forEach((t) => (server[t.hash] = { ...t }));
  const sets: { hash: string; data: string }[] = [];
  const viewed: [string, number, number][] = [];
  const c: CarryClient = {
    list: vi.fn(() => Promise.resolve(Object.keys(server).map((h) => ({ ...server[h] })))),
    setData: vi.fn((t, data) => {
      if (opts.failSet) return Promise.reject(new Error('boom'));
      sets.push({ hash: t.hash, data });
      if (!opts.dropWrite) server[t.hash] = { ...server[t.hash], data };
      return Promise.resolve();
    }),
    loadInfo: vi.fn((h) => Promise.resolve({ ...server[h] })),
    setViewed: vi.fn((h, f, tc) => {
      if (opts.failViewed) return Promise.reject(new Error('boom'));
      viewed.push([h, f, tc || 0]);
      return Promise.resolve();
    }),
  };
  return { c, server, sets, viewed };
}

const S1 = ['Show.S01E01.720p.mkv', 'Show.S01E02.720p.mkv', 'Show.S01E03.720p.mkv'];
const S1_1080 = ['Show.S01E01.1080p.mkv', 'Show.S01E02.1080p.mkv', 'Show.S01E03.1080p.mkv', 'Show.S01E04.1080p.mkv'];

beforeEach(() => {
  localStorage.clear();
  reloadProgress();
  serverViewed.value = [];
});

describe('carryMap', () => {
  it('matches the episodes by SxxEyy', () => {
    expect(carryMap(files(S1), files(S1_1080), 1)).toEqual({ 1: 1, 2: 2, 3: 3 });
  });

  it('a pack of several seasons that stays: only its files of the season are candidates', () => {
    const pack = files(['S02/E03.mkv', 'S01/Show.S01E03.mkv', 'S02/Show.S02E01.mkv', 'S01/Show.S01E01.mkv']);
    // «03.mkv» of season 1 would be ambiguous in the whole pack (S02 «E03» too): within season 1 it is unique
    const own = files(['Show.S01E01.mkv', 'E03.mkv']);
    expect(seasonFiles(pack, 1).map((f) => f.id)).toEqual([2, 4]);
    expect(carryMap(own, pack, 1)).toEqual({ 1: 4, 2: 2 });
  });

  it('a film in two releases: the one video each, named differently', () => {
    const a = files(['Dune.2021.1080p.mkv', 'sample.txt']);
    const b = files(['Дюна.2021.2160p.HDR.mkv']);
    expect(carryMap(a, b, NO_SEASON)[1]).toBe(1);
  });
});

describe('mergeJournals', () => {
  it('one entry per slot, the newest wins, newest first', () => {
    const own: JournalEntry[] = [{ f: 1, t: 10, d: 100, at: T0, src: 'tv' }];
    const carried: JournalEntry[] = [
      { f: 1, t: 90, d: 100, at: T0 + 10, src: 'tv' },
      { f: 2, t: 5, d: 100, at: T0 - 10, src: 'phone', name: 'Pixel' },
    ];
    const m = mergeJournals(own, carried);
    expect(m.map((e) => [e.f, e.t])).toEqual([
      [1, 90],
      [2, 5],
    ]);
  });

  it('keeps at most 20 entries', () => {
    const many: JournalEntry[] = [];
    for (let i = 0; i < 30; i++) many.push({ f: i, t: 1, d: 2, at: T0 + i, src: 'tv' });
    const m = mergeJournals([], many);
    expect(m.length).toBe(20);
    expect(m[0].f).toBe(29);
  });
});

describe('pickKeeper', () => {
  it('the release watched last, else the newest', () => {
    const a = tor('a', S1, undefined, { timestamp: 1 });
    const b = tor('b', S1_1080, undefined, { timestamp: 3 });
    const x = tor('x', S1, undefined, { timestamp: 2 });
    expect(pickKeeper([a, b, x], x)!.hash).toBe('b');
    saveProgress('a', 1, 30, 100);
    expect(pickKeeper([a, b, x], x)!.hash).toBe('a');
    expect(pickKeeper([x], x)).toBeNull();
  });
});

describe('carryWatch', () => {
  it('moves the journal, the skip settings, local progress and server marks to the one that stays', async () => {
    const gone = tor('gone', S1, {
      h: [
        { f: 2, t: 600, d: 1400, at: T0 + 50, src: 'phone', name: 'Pixel' },
        { f: 1, t: 1400, d: 1400, at: T0, src: 'tv' },
      ],
      s: { i: true, c: false, mi: [10, 70] },
    });
    const keep = tor('keep', S1_1080, { h: [{ f: 4, t: 100, d: 1400, at: T0 + 100, src: 'tv' }], w: true });
    const { c, server, viewed } = fakeClient([gone, keep]);
    saveProgress('gone', 2, 600, 1400);
    serverViewed.value = [{ hash: 'gone', file_index: 1 }];

    const r = await carryWatch(c, gone, keep, 1);
    expect(r.ok).toBe(true);
    const p = parseData(server.keep.data)!;
    expect(p.journal.map((e) => [e.f, e.t, e.src])).toEqual([
      [4, 100, 'tv'],
      [2, 600, 'phone'],
      [1, 1400, 'tv'],
    ]);
    expect(p.skip).toEqual({ i: true, c: false, mi: [10, 70] });
    // the other keys of the one that stays survive
    expect((p.obj.omp as { w: boolean }).w).toBe(true);
    expect(getLocalProgress('keep', 2)!.time).toBe(600);
    expect(viewed).toEqual([['keep', 1, 0]]);
    // the release itself is not removed here; its local progress goes after the remove
    expect(server.gone).toBeDefined();
    forgetRemoved('gone');
    expect(getLocalProgress('gone', 2)).toBeNull();
  });

  it('never overwrites newer progress or the skip settings of the one that stays', async () => {
    const gone = tor('gone', S1, { h: [], s: { i: true, c: true } });
    const keep = tor('keep', S1_1080, { h: [], s: { i: false, c: true } });
    const { c, server } = fakeClient([gone, keep]);
    saveProgress('gone', 1, 100, 1000);
    saveProgress('keep', 1, 500, 1000);
    const r = await carryWatch(c, gone, keep, 1);
    expect(r.ok).toBe(true);
    expect(getLocalProgress('keep', 1)!.time).toBe(500);
    expect(parseData(server.keep.data)!.skip).toEqual({ i: false, c: true });
  });

  it('nothing watched: nothing is written', async () => {
    const { c, sets } = fakeClient([tor('gone', S1), tor('keep', S1_1080)]);
    const r = await carryWatch(c, tor('gone', S1), tor('keep', S1_1080), 1);
    expect(r).toEqual({ ok: true, moved: 0 });
    expect(sets.length).toBe(0);
  });

  it('a history that can not be written (or does not read back) fails: the release must stay', async () => {
    const gone = tor('gone', S1, { h: [{ f: 1, t: 10, d: 100, at: T0, src: 'tv' }] });
    const keep = tor('keep', S1_1080);
    expect((await carryWatch(fakeClient([gone, keep], { failSet: true }).c, gone, keep, 1)).ok).toBe(false);
    expect((await carryWatch(fakeClient([gone, keep], { dropWrite: true }).c, gone, keep, 1)).ok).toBe(false);
  });

  it('no file lists to match the history: fails instead of dropping it', async () => {
    const gone: Torrent = { hash: 'gone', title: 'g', stat: 5, data: JSON.stringify({ omp: { v: 1, h: [{ f: 1, t: 10, d: 100, at: T0, src: 'tv' }] } }) };
    const keep = tor('keep', S1_1080);
    const { c, sets } = fakeClient([gone, keep]);
    expect((await carryWatch(c, gone, keep, 1)).ok).toBe(false);
    expect(sets.length).toBe(0);
  });

  it('the one that stays is gone from the server: fails', async () => {
    const gone = tor('gone', S1, { h: [{ f: 1, t: 10, d: 100, at: T0, src: 'tv' }] });
    const { c } = fakeClient([gone]);
    expect((await carryWatch(c, gone, tor('keep', S1_1080), 1)).ok).toBe(false);
  });

  it('the server marks moved are known here at once: a next delete moves them on', async () => {
    const a = tor('a', S1);
    const b = tor('b', S1_1080);
    const c3 = tor('c', S1_1080);
    serverViewed.value = [{ hash: 'a', file_index: 2 }];
    const { c } = fakeClient([a, b, c3]);
    expect((await carryWatch(c, a, b, 1)).ok).toBe(true);
    expect(serverViewed.value.some((e) => e.hash === 'b' && e.file_index === 2)).toBe(true);
    const r2 = fakeClient([b, c3]);
    expect((await carryWatch(r2.c, b, c3, 1)).ok).toBe(true);
    expect(r2.viewed).toEqual([['c', 2, 0]]);
  });

  it('the server marks are read again: a mark missing from the cache still moves', async () => {
    serverViewed.value = [];
    const { c, viewed } = fakeClient([tor('gone', S1), tor('keep', S1_1080)]);
    c.viewedList = vi.fn(() => Promise.resolve([{ hash: 'gone', file_index: 3 }]));
    expect((await carryWatch(c, tor('gone', S1), tor('keep', S1_1080), 1)).ok).toBe(true);
    expect(viewed).toEqual([['keep', 3, 0]]);
  });

  it('the server marks can not be read: fails, the release must stay', async () => {
    const { c, viewed } = fakeClient([tor('gone', S1), tor('keep', S1_1080)]);
    c.viewedList = vi.fn(() => Promise.reject(new Error('boom')));
    expect((await carryWatch(c, tor('gone', S1), tor('keep', S1_1080), 1)).ok).toBe(false);
    expect(viewed).toEqual([]);
  });

  it('a watched mark replaces a resume position of the one that stays, never the other way round', async () => {
    serverViewed.value = [
      { hash: 'gone', file_index: 1 },
      { hash: 'keep', file_index: 1, timecode: 300 },
      { hash: 'gone', file_index: 2, timecode: 200 },
      { hash: 'keep', file_index: 2 },
    ];
    const { c, viewed } = fakeClient([tor('gone', S1), tor('keep', S1_1080)]);
    expect((await carryWatch(c, tor('gone', S1), tor('keep', S1_1080), 1)).ok).toBe(true);
    expect(viewed).toEqual([['keep', 1, 0]]);
    const k1 = serverViewed.value.filter((e) => e.hash === 'keep' && e.file_index === 1);
    expect(k1.length).toBe(1);
    expect(k1[0].timecode || 0).toBe(0);
  });

  it('a server mark that can not be written fails: the release must stay', async () => {
    serverViewed.value = [{ hash: 'gone', file_index: 1 }];
    const { c } = fakeClient([tor('gone', S1), tor('keep', S1_1080)], { failViewed: true });
    expect((await carryWatch(c, tor('gone', S1), tor('keep', S1_1080), 1)).ok).toBe(false);
  });

  it('watch marks on an episode the one that stays lacks: says how many, writes only with allowLoss', async () => {
    const gone = tor('gone', S1, { h: [{ f: 3, t: 10, d: 100, at: T0, src: 'tv' }, { f: 1, t: 50, d: 100, at: T0, src: 'tv' }] });
    const keep = tor('keep', ['Show.S01E01.1080p.mkv', 'Show.S01E02.1080p.mkv']);
    const first = fakeClient([gone, keep]);
    expect(await carryWatch(first.c, gone, keep, 1)).toEqual({ ok: false, lost: 1 });
    expect(first.sets.length).toBe(0);
    const second = fakeClient([gone, keep]);
    const r = await carryWatch(second.c, gone, keep, 1, { allowLoss: true });
    expect(r.ok).toBe(true);
    expect(parseData(second.server.keep.data)!.journal.map((e) => e.f)).toEqual([1]);
  });

  it('skip settings only: a write that does not read back fails', async () => {
    const gone = tor('gone', S1, { h: [], s: { i: true, c: false } });
    const keep = tor('keep', S1_1080);
    const { c } = fakeClient([gone, keep], { dropWrite: true });
    expect((await carryWatch(c, gone, keep, 1)).ok).toBe(false);
  });

  it('another server chosen while the marks are written: the cache is not refilled with the old server marks', async () => {
    serverViewed.value = [{ hash: 'gone', file_index: 1 }];
    const { c } = fakeClient([tor('gone', S1), tor('keep', S1_1080)]);
    const orig = c.setViewed!;
    c.setViewed = vi.fn((h: string, f: number, tc?: number) => {
      resetViewed();
      return orig(h, f, tc);
    });
    expect((await carryWatch(c, tor('gone', S1), tor('keep', S1_1080), 1)).ok).toBe(true);
    expect(serverViewed.value).toEqual([]);
  });
});

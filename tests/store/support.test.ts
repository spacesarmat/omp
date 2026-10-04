import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadSkip, saveSupport } from '../../src/store/journal';
import { torrents } from '../../src/store/library';
import { journalSupportUntil, journalSupportActive, resetSupportSeen, supportUntilOf } from '../../src/store/support';
import type { Torrent } from '../../src/api/types';

const U = 1_800_000_000_000;
const NOW = U - 10 * 86400000;
const T0 = 1_759_400_000_000;
const mark = (until: number) => JSON.stringify({ omp: { v: 1, h: [], d: { until } } });

function server(list: Partial<Torrent>[]) {
  const all: Torrent[] = list.map((x, i) => ({ hash: 'h' + i, title: 'T' + i, stat: 5, ...x }) as Torrent);
  const c = {
    list: vi.fn(() => Promise.resolve(all.map((t) => ({ ...t })))),
    setData: vi.fn((x: Pick<Torrent, 'hash'>, data: string) => {
      all.filter((t) => t.hash === x.hash)[0].data = data;
      return Promise.resolve();
    }),
  };
  return { c, all };
}

beforeEach(() => {
  torrents.value = [];
  resetSupportSeen();
});

describe('saveSupport (support code → omp.d.until for the TVs)', () => {
  it('writes the torrent played least recently, once, keeping its history, skip settings and other keys', async () => {
    const s = server([
      { timestamp: 9, data: JSON.stringify({ omp: { v: 1, h: [{ f: 1, t: 2, d: 3, at: T0 + 5000, src: 'tv' }] } }) }, // watched now
      { timestamp: 5, data: 'someone else' },
      { timestamp: 3, data: JSON.stringify({ lampa: { x: 1 }, omp: { v: 1, h: [{ f: 1, t: 2, d: 3, at: T0, src: 'tv' }], s: { i: true, c: false }, zz: 1 } }) },
    ]);
    expect(await saveSupport(s.c, U, NOW)).toBe(true);
    expect(s.c.setData).toHaveBeenCalledTimes(1);
    const out = JSON.parse(s.all[2].data!);
    expect(out.lampa).toEqual({ x: 1 });
    expect(out.omp.h).toHaveLength(1);
    expect(out.omp.s).toEqual({ i: true, c: false });
    expect(out.omp.zz).toBe(1);
    expect(out.omp.d).toEqual({ until: U });
    expect(s.all[1].data).toBe('someone else');
    expect(JSON.parse(s.all[0].data!).omp.d).toBeUndefined();
    // already there (or a later one): nothing more to write
    expect(await saveSupport(s.c, U, NOW)).toBe(true);
    expect(await saveSupport(s.c, U - 1000, NOW)).toBe(true);
    expect(s.c.setData).toHaveBeenCalledTimes(1);
  });

  it('a torrent never played through OMP goes first; among equals the oldest', async () => {
    const s = server([
      { timestamp: 7, data: '{}' },
      { timestamp: 2, data: JSON.stringify({ TorrServer: { Files: [] } }) },
      { timestamp: 1, data: JSON.stringify({ omp: { v: 1, h: [{ f: 1, t: 2, d: 3, at: T0, src: 'tv' }] } }) },
    ]);
    expect(await saveSupport(s.c, U, NOW)).toBe(true);
    expect(JSON.parse(s.all[1].data!).omp.d).toEqual({ until: U });
  });

  it('a concurrent write that lost the mark is noticed by the read-back and written again', async () => {
    const s = server([{ data: '{}' }]);
    let first = true;
    s.c.setData.mockImplementation((x: Pick<Torrent, 'hash'>, data: string) => {
      // a TV rewrites the torrent from its older copy right after the first write
      s.all[0].data = first ? JSON.stringify({ omp: { v: 1, h: [{ f: 1, t: 9, d: 9, at: T0, src: 'tv' }] } }) : data;
      first = false;
      return Promise.resolve();
    });
    expect(await saveSupport(s.c, U, NOW)).toBe(true);
    expect(s.c.setData).toHaveBeenCalledTimes(2);
    const out = JSON.parse(s.all[0].data!);
    expect(out.omp.d).toEqual({ until: U });
    expect(out.omp.h).toHaveLength(1);
  });

  it('a bogus far-future mark does not count as «already there»', async () => {
    const s = server([{ data: mark(9e15) }]);
    expect(await saveSupport(s.c, U, NOW)).toBe(true);
    expect(JSON.parse(s.all[0].data!).omp.d).toEqual({ until: U });
  });

  it('false without a writable torrent or when the server fails; never rejects', async () => {
    expect(await saveSupport(server([{ data: 'junk' }]).c, U, NOW)).toBe(false);
    expect(await saveSupport(server([]).c, U, NOW)).toBe(false);
    const s = server([{ data: '{}' }]);
    s.c.setData.mockImplementation(() => Promise.reject(new Error('403')));
    expect(await saveSupport(s.c, U, NOW)).toBe(false);
    const down = { list: vi.fn(() => Promise.reject(new Error('down'))), setData: vi.fn() };
    expect(await saveSupport(down, U, NOW)).toBe(false);
  });
});

describe('TV side: support mark from the journal', () => {
  it('the latest mark of the library list hides prompts until it passes', () => {
    const t = Date.now();
    const u = t + 20 * 86400000;
    expect(journalSupportActive(t)).toBe(false);
    torrents.value = [{ hash: 'a', title: 'A', stat: 5, data: mark(u) } as Torrent, { hash: 'b', title: 'B', stat: 5, data: mark(u - 5000) } as Torrent];
    expect(journalSupportUntil.value).toBe(u);
    expect(journalSupportActive(t)).toBe(true);
    expect(journalSupportActive(u + 1)).toBe(false);
    torrents.value = [];
    expect(journalSupportActive(t)).toBe(false);
  });

  it('a bogus far-future mark is ignored, a valid one next to it still counts', () => {
    const t = Date.now();
    const valid = t + 20 * 86400000;
    expect(supportUntilOf([{ hash: 'a', data: mark(t + 400 * 86400000) }, { hash: 'b', data: mark(valid) }], t)).toBe(valid);
    expect(supportUntilOf([{ hash: 'a', data: mark(t + 400 * 86400000) }], t)).toBe(0);
  });

  it('re-parses a torrent only when its data changed', () => {
    const t = Date.now();
    const a = { hash: 'a', data: mark(t + 86400000) };
    expect(supportUntilOf([a], t)).toBe(t + 86400000);
    expect(supportUntilOf([{ hash: 'a', data: mark(t + 2 * 86400000) }], t)).toBe(t + 2 * 86400000);
    expect(supportUntilOf([{ hash: 'a', data: 'junk "d"' }], t)).toBe(0);
  });

  it('the list the player reads for the skip settings counts too', async () => {
    const t = Date.now();
    const s = server([{ hash: 'h', data: mark(t + 86400000) }]);
    await loadSkip(s.c, 'h');
    expect(journalSupportActive(t)).toBe(true);
  });
});

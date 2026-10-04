import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadSkip, saveSupport } from '../../src/store/journal';
import { torrents } from '../../src/store/library';
import { journalSupportUntil, journalSupportActive, resetSupportSeen } from '../../src/store/support';
import type { Torrent } from '../../src/api/types';

const U = 1_800_000_000_000;
const T0 = 1_759_400_000_000;

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
  it('writes the newest JSON torrent once, keeping its history, skip settings and other keys', async () => {
    const s = server([
      { timestamp: 1, data: JSON.stringify({ omp: { v: 1, h: [] } }) },
      { timestamp: 5, data: 'someone else' },
      { timestamp: 3, data: JSON.stringify({ lampa: { x: 1 }, omp: { v: 1, h: [{ f: 1, t: 2, d: 3, at: T0, src: 'tv' }], s: { i: true, c: false }, zz: 1 } }) },
    ]);
    expect(await saveSupport(s.c, U)).toBe(true);
    expect(s.c.setData).toHaveBeenCalledTimes(1);
    const out = JSON.parse(s.all[2].data!);
    expect(out.lampa).toEqual({ x: 1 });
    expect(out.omp.h).toHaveLength(1);
    expect(out.omp.s).toEqual({ i: true, c: false });
    expect(out.omp.zz).toBe(1);
    expect(out.omp.d).toEqual({ until: U });
    expect(s.all[1].data).toBe('someone else');
    // already there (or a later one): nothing more to write
    expect(await saveSupport(s.c, U)).toBe(true);
    expect(await saveSupport(s.c, U - 1000)).toBe(true);
    expect(s.c.setData).toHaveBeenCalledTimes(1);
  });

  it('false without a writable torrent or when the server fails; never rejects', async () => {
    expect(await saveSupport(server([{ data: 'junk' }]).c, U)).toBe(false);
    expect(await saveSupport(server([]).c, U)).toBe(false);
    const s = server([{ data: '{}' }]);
    s.c.setData.mockImplementationOnce(() => Promise.reject(new Error('403')));
    expect(await saveSupport(s.c, U)).toBe(false);
    const down = { list: vi.fn(() => Promise.reject(new Error('down'))), setData: vi.fn() };
    expect(await saveSupport(down, U)).toBe(false);
  });
});

describe('TV side: support mark from the journal', () => {
  it('the latest mark of the library list hides prompts until it passes', () => {
    const now = U - 10 * 86400000;
    expect(journalSupportActive(now)).toBe(false);
    torrents.value = [{ hash: 'a', title: 'A', stat: 5, data: JSON.stringify({ omp: { v: 1, h: [], d: { until: U } } }) } as Torrent];
    expect(journalSupportUntil.value).toBe(U);
    expect(journalSupportActive(now)).toBe(true);
    expect(journalSupportActive(U + 1)).toBe(false);
    torrents.value = [];
    expect(journalSupportActive(now)).toBe(false);
  });

  it('the list the player reads for the skip settings counts too', async () => {
    const now = U - 10 * 86400000;
    const s = server([{ hash: 'h', data: JSON.stringify({ omp: { v: 1, h: [], d: { until: U } } }) }]);
    await loadSkip(s.c, 'h');
    expect(journalSupportActive(now)).toBe(true);
  });
});

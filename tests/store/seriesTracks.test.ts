import { describe, it, expect, vi, beforeEach } from 'vitest';
import { seriesMembersOf, seriesTracksFor, rememberSeriesTracks } from '../../src/store/seriesTracks';
import { saveSeriesTracks, type JournalClient } from '../../src/store/journal';
import { torrents } from '../../src/store/library';
import { seriesTracksOf, newestSeriesTracks } from '../../src/lib/seriesTracks';
import type { Torrent } from '../../src/api/types';

const season = (n: number, data?: string): Torrent => ({
  hash: 's' + n,
  title: 'Тёмная материя / Dark Matter / Сезон: ' + n + ' / Серии: 1-9 из 9 (2024) WEB-DL 1080p',
  category: 'tv',
  stat: 5,
  ...(data !== undefined ? { data } : {}),
});
const film: Torrent = { hash: 'f1', title: 'Quiet Signal (2024) 2160p', category: 'movie', stat: 5 };
const rec = (a: object) => JSON.stringify({ omp: { v: 1, h: [], a } });

function fakeServer(list: Torrent[]) {
  const all = list.map((x) => ({ ...x }));
  const sets: { hash: string; data: string }[] = [];
  const c = {
    list: vi.fn(() => Promise.resolve(all.map((x) => ({ ...x })))),
    setData: vi.fn((x: Pick<Torrent, 'hash'>, data: string) => {
      sets.push({ hash: x.hash, data });
      all.forEach((y) => { if (y.hash === x.hash) y.data = data; });
      return Promise.resolve();
    }),
  };
  return { c: c as JournalClient & typeof c, all, sets };
}

beforeEach(() => {
  torrents.value = [];
});

describe('series of a torrent', () => {
  it('every season of the series, the torrent alone for a single season, nothing for a film', () => {
    const list = [season(1), season(2), film];
    expect(seriesMembersOf('s2', list).map((m) => m.hash).sort()).toEqual(['s1', 's2']);
    expect(seriesMembersOf('s1', [season(1)]).map((m) => m.hash)).toEqual(['s1']);
    expect(seriesMembersOf('f1', list)).toEqual([]);
    expect(seriesMembersOf('nope', list)).toEqual([]);
    expect(seriesMembersOf(undefined, list)).toEqual([]);
  });

  it('the record chosen on one season counts for the others', () => {
    torrents.value = [season(1, rec({ at: 5, l: 'LostFilm', g: 'ru' })), season(2), film];
    expect(seriesTracksFor('s2')!.l).toBe('LostFilm');
    expect(seriesTracksFor('f1')).toBeNull();
  });
});

describe('saveSeriesTracks', () => {
  it('writes omp.a on the torrent, merged with the newest record of the series, keeping the rest of data', async () => {
    const s = fakeServer([
      season(1, JSON.stringify({ lampa: 1, omp: { v: 1, h: [{ f: 1, t: 2, d: 3, at: 4, src: 'tv' }], s: { i: true, c: false }, a: { at: 5, s: 'off', k: [{ l: 'LostFilm', g: 'ru' }] } } })),
      season(2, ''),
    ]);
    const out = await saveSeriesTracks(s.c, 's2', ['s1', 's2'], { l: 'HDrezka Studio', g: 'ru' }, 100);
    expect(out).toEqual({ at: 100, l: 'HDrezka Studio', g: 'ru', s: 'off', k: [{ l: 'HDrezka Studio', g: 'ru' }, { l: 'LostFilm', g: 'ru' }] });
    expect(s.sets.map((x) => x.hash)).toEqual(['s2']);
    expect(seriesTracksOf(s.sets[0].data)).toEqual(out);
    // the series now reads the new one
    expect(newestSeriesTracks(s.all)!.l).toBe('HDrezka Studio');
    // the other torrent's history and skip settings are untouched; a write to it keeps them
    await saveSeriesTracks(s.c, 's1', ['s1', 's2'], 'reset', 200);
    const s1 = JSON.parse(s.all[0].data!);
    expect(s1.lampa).toBe(1);
    expect(s1.omp.h).toHaveLength(1);
    expect(s1.omp.s).toEqual({ i: true, c: false });
    expect(s1.omp.a).toEqual({ at: 200, k: out.k });
  });

  it('rejects when the torrent is gone or its data is not JSON', async () => {
    const s = fakeServer([season(1, 'not json')]);
    await expect(saveSeriesTracks(s.c, 's1', ['s1'], 'reset')).rejects.toThrow();
    await expect(saveSeriesTracks(s.c, 'zz', ['s1'], 'reset')).rejects.toThrow();
    expect(s.c.setData).not.toHaveBeenCalled();
  });

  it('rememberSeriesTracks never rejects and writes nothing for a film', async () => {
    const s = fakeServer([season(1, 'not json'), film]);
    torrents.value = s.all;
    await expect(rememberSeriesTracks(s.c, 's1', { l: 'LostFilm', g: 'ru' })).resolves.toBeUndefined();
    await rememberSeriesTracks(s.c, 'f1', { l: 'LostFilm', g: 'ru' });
    await rememberSeriesTracks(null, 's1', { l: 'LostFilm', g: 'ru' });
    expect(s.c.setData).not.toHaveBeenCalled();
  });
});

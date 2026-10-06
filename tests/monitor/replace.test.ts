import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import { replaceAbort, replaceTorrent, replaceWithResult, mapFiles, mapJournal, type ReplaceClient } from '../../src/monitor/replace';
import { torrents } from '../../src/store/library';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { loginRequired } from '../../src/sources/types';
import { parseData } from '../../src/lib/journal';
import type { Torrent } from '../../src/api/types';

const T0 = 1_759_400_000_000;

function files(names: string[]) {
  return names.map((p, i) => ({ id: i + 1, path: p, length: 1000 + i }));
}

function dataOf(f: { id: number; path: string; length: number }[], extra?: { [k: string]: unknown }) {
  return JSON.stringify({ TorrServer: { Files: f }, ...(extra || {}) });
}

const OLD_FILES = files(['Show.S01E01.mkv', 'Show.S01E02.mkv', 'Show.S01E03.mkv']);
const NEW_FILES = files(['Show.S01E01.1080p.mkv', 'Show.S01E02.1080p.mkv', 'Show.S01E03.1080p.mkv', 'Show.S01E04.1080p.mkv']);

interface SetupOpts {
  old?: Partial<Torrent>;
  fresh?: Partial<Torrent>;
  failAdd?: boolean;
  failInfo?: boolean | 'hang';
  failSet?: boolean;
  failRemoveOld?: boolean;
  existing?: boolean;
}

function setup(opts: SetupOpts = {}) {
  const old: Torrent = {
    hash: 'oldhash',
    title: 'Show S01 720p',
    poster: 'http://p/old.jpg',
    category: 'tv',
    stat: 5,
    file_stats: OLD_FILES,
    data: dataOf(OLD_FILES, {
      omp: {
        v: 1,
        h: [
          { f: 2, t: 100, d: 1400, at: T0, src: 'phone', name: 'Pixel' },
          { f: 1, t: 1400, d: 1400, at: T0 - 5000, src: 'tv' },
        ],
        s: { i: true, c: false, mi: [10, 70] },
        w: false,
        fut: { a: 1 },
      },
      lampa: 1,
    }),
    ...(opts.old || {}),
  };
  const fresh: Torrent = {
    hash: 'newhash',
    title: 'Show S01 1080p',
    poster: '',
    category: '',
    stat: 5,
    file_stats: NEW_FILES,
    data: dataOf(NEW_FILES),
    ...(opts.fresh || {}),
  };
  const server: { [h: string]: Torrent } = { [old.hash]: { ...old } };
  if (opts.existing) server[fresh.hash] = { ...fresh };
  const calls: string[] = [];
  const sets: any[] = [];
  const c: ReplaceClient = {
    list: vi.fn(() => Promise.resolve(Object.keys(server).map((h) => ({ ...server[h] })))),
    add: vi.fn((p) => {
      calls.push('add');
      if (opts.failAdd) return Promise.reject(new Error('boom'));
      server[fresh.hash] = { ...fresh, title: p.title || fresh.title, poster: '', category: p.category || '' };
      return Promise.resolve({ ...server[fresh.hash], file_stats: undefined, data: '' } as Torrent);
    }),
    loadInfo: vi.fn((h) => {
      calls.push('info');
      if (opts.failInfo === 'hang') return new Promise<Torrent>(() => undefined);
      if (opts.failInfo) return Promise.reject(new Error('x'));
      return Promise.resolve({ ...server[h] });
    }),
    setData: vi.fn((t, data) => {
      calls.push('set');
      if (opts.failSet) return Promise.reject(new Error('x'));
      sets.push({ ...t, data });
      server[t.hash] = { ...server[t.hash], ...t, data };
      return Promise.resolve();
    }),
    remove: vi.fn((h) => {
      calls.push('rem:' + h);
      if (opts.failRemoveOld && h === old.hash) return Promise.reject(new Error('x'));
      delete server[h];
      return Promise.resolve();
    }),
  };
  return { c, old, fresh, server, calls, sets };
}

beforeEach(() => {
  torrents.value = [];
});

describe('mapFiles', () => {
  it('matches by SxxEyy even when the order and names differ', () => {
    const o = files(['a/Show.S01E01.mkv', 'a/Show.S01E02.mkv']);
    const n = [
      { id: 7, path: 'b/Серия E02 S01.mkv', length: 1 },
      { id: 4, path: 'b/Show.s01e02.mkv', length: 1 },
      { id: 5, path: 'b/Show.s01e01.mkv', length: 1 },
    ];
    expect(mapFiles(o, n)).toEqual({ 1: 5, 2: 4 });
  });

  it('falls back to the episode number when the new names have no season', () => {
    const o = files(['Show.S01E01.mkv', 'Show.S01E02.mkv']);
    const n = [
      { id: 3, path: 'Season 1/E01 Show.mkv', length: 1 },
      { id: 9, path: 'Season 1/E02 Show.mkv', length: 1 },
    ];
    expect(mapFiles(o, n)).toEqual({ 1: 3, 2: 9 });
  });

  it('then the same file name, then the same index only when the counts match', () => {
    const o = files(['Movie A.mkv', 'Movie B.mkv']);
    expect(mapFiles(o, [{ id: 5, path: 'x/movie b.mkv', length: 1 }, { id: 6, path: 'x/Other.mkv', length: 1 }, { id: 7, path: 'x/Third.mkv', length: 1 }])).toEqual({ 1: null, 2: 5 });
    expect(mapFiles(o, files(['One.mkv', 'Two.mkv']))).toEqual({ 1: 1, 2: 2 });
    expect(mapFiles(o, files(['One.mkv', 'Two.mkv', 'Three.mkv']))).toEqual({ 1: null, 2: null });
  });

  it('never maps a video to a subtitle, nor an episode to another episode by index', () => {
    const o = files(['Show.S01E01.mkv', 'Show.S01E02.mkv']);
    expect(mapFiles(o, files(['Show.S01E01.srt', 'Show.S01E02.srt']))).toEqual({ 1: null, 2: null });
    expect(mapFiles(o, files(['Show.S01E05.mkv', 'Show.S01E06.mkv']))).toEqual({ 1: null, 2: null });
  });

  it('does not map a labelled episode to an unlabelled file by index', () => {
    const o = files(['Show.S01E01.mkv', 'Show.S01E02.mkv']);
    expect(mapFiles(o, files(['Extras.mkv', 'Sample.mkv']))).toEqual({ 1: null, 2: null });
  });

  it('skips ambiguous matches', () => {
    const o = files(['Show.S01E01.mkv']);
    const n = files(['Show.S01E01.rus.mkv', 'Show.S01E01.eng.mkv', 'Show.S01E02.mkv']);
    expect(mapFiles(o, n)).toEqual({ 1: null });
  });
});

describe('mapJournal', () => {
  it('drops unmapped entries and keeps one entry per slot, newest first', () => {
    const j = [
      { f: 1, t: 1, d: 2, at: 10, src: 'tv' as const },
      { f: 2, t: 5, d: 9, at: 30, src: 'tv' as const },
      { f: 3, t: 7, d: 9, at: 20, src: 'tv' as const },
      { f: 9, t: 7, d: 9, at: 40, src: 'tv' as const },
    ];
    expect(mapJournal(j, { 1: 4, 2: 4, 3: null })).toEqual([{ f: 4, t: 5, d: 9, at: 30, src: 'tv' }]);
  });
});

describe('replaceTorrent', () => {
  it('adds the new one with the old category and poster, writes the carried data, then removes the old', async () => {
    const s = setup();
    torrents.value = [{ ...s.old }];
    const r = await replaceTorrent(s.c, 'oldhash', 'magnet:?xt=urn:btih:newhash');
    expect(r).toEqual({ ok: true, hash: 'newhash' });
    expect(s.calls).toEqual(['add', 'info', 'set', 'rem:oldhash']);
    expect((s.c.add as any).mock.calls[0][0]).toMatchObject({ link: 'magnet:?xt=urn:btih:newhash', title: 'Show S01 720p', poster: 'http://p/old.jpg', category: 'tv' });
    expect(s.sets[0]).toMatchObject({ hash: 'newhash', title: 'Show S01 720p', poster: 'http://p/old.jpg', category: 'tv' });
    const out = JSON.parse(s.sets[0].data);
    expect(out.TorrServer.Files).toHaveLength(4); // the new torrent own keys
    expect(out.lampa).toBeUndefined(); // another client key of the OLD torrent is not copied
    expect(out.omp.h).toEqual([
      { f: 2, t: 100, d: 1400, at: T0, src: 'phone', name: 'Pixel' },
      { f: 1, t: 1400, d: 1400, at: T0 - 5000, src: 'tv' },
    ]);
    expect(out.omp.s).toEqual({ i: true, c: false, mi: [10, 70] });
    expect(out.omp.w).toBe(false);
    expect(out.omp.fut).toEqual({ a: 1 });
    expect(Object.keys(s.server)).toEqual(['newhash']);
  });

  it('maps the history by episode when the file order differs', async () => {
    const s = setup({
      fresh: { file_stats: files(['Show.S01E04.mkv', 'Show.S01E03.mkv', 'Show.S01E02.mkv', 'Show.S01E01.mkv']), data: undefined },
    });
    const r = await replaceTorrent(s.c, 'oldhash', 'magnet:x');
    expect(r.ok).toBe(true);
    const h = parseData(s.sets[0].data)!.journal;
    expect(h.map((e) => e.f).sort()).toEqual([3, 4]); // E02 -> 3, E01 -> 4
    expect(h.filter((e) => e.src === 'phone')[0].f).toBe(3);
  });

  it('drops entries that cannot be mapped but still replaces', async () => {
    const s = setup({ fresh: { file_stats: files(['Show.S01E02.mkv', 'Show.S01E09.mkv']), data: undefined } });
    const r = await replaceTorrent(s.c, 'oldhash', 'magnet:x');
    expect(r.ok).toBe(true);
    expect(parseData(s.sets[0].data)!.journal.map((e) => e.f)).toEqual([1]);
    expect(parseData(s.sets[0].data)!.skip).toEqual({ i: true, c: false, mi: [10, 70] });
  });

  it('puts the new torrent in the library list where the old one was', async () => {
    const s = setup();
    const other: Torrent = { hash: 'other', title: 'O', stat: 0 };
    torrents.value = [other, { ...s.old }, { hash: 'z', title: 'Z', stat: 0 }];
    await replaceTorrent(s.c, 'oldhash', 'magnet:x');
    expect(torrents.value.map((t) => t.hash)).toEqual(['other', 'newhash', 'z']);
    expect(torrents.value[1].title).toBe('Show S01 720p');
    expect(parseData(torrents.value[1].data)!.journal).toHaveLength(2);
    expect(torrents.value[1].category).toBe('tv');
  });

  it('uses the title of the new release when given, never the old one with its episode range', async () => {
    const s = setup();
    await replaceTorrent(s.c, 'oldhash', 'magnet:x', { title: 'Show S01 Серии 1-10 из 10' });
    expect((s.c.add as any).mock.calls[0][0].title).toBe('Show S01 Серии 1-10 из 10');
    expect(s.sets[0].title).toBe('Show S01 Серии 1-10 из 10');
  });

  it('replaceWithResult takes the magnet and the title of the result', async () => {
    const s = setup();
    const r = await replaceWithResult(s.c, 'oldhash', { Title: 'Show S01 Серии 1-10', Magnet: 'magnet:?xt=urn:btih:newhash', source: 'rutor' } as any, {} as any);
    expect(r.ok).toBe(true);
    expect((s.c.add as any).mock.calls[0][0]).toMatchObject({ link: 'magnet:?xt=urn:btih:newhash', title: 'Show S01 Серии 1-10' });
  });

  it('fails and keeps the old one when there is no title to write (the real setData would skip the write)', async () => {
    const s = setup({ old: { title: '' }, fresh: { title: '' } });
    const r = await replaceTorrent(s.c, 'oldhash', 'magnet:x');
    expect(r.ok).toBe(false);
    expect(s.calls).toEqual(['add', 'info', 'rem:newhash']);
    expect(Object.keys(s.server)).toEqual(['oldhash']);
  });

  it('fails when setData resolves but the journal did not reach the server', async () => {
    const s = setup();
    (s.c.setData as any).mockImplementation(() => {
      s.calls.push('set');
      return Promise.resolve();
    });
    const r = await replaceTorrent(s.c, 'oldhash', 'magnet:x');
    expect(r.ok).toBe(false);
    expect(s.calls).toEqual(['add', 'info', 'set', 'rem:newhash']);
    expect(Object.keys(s.server)).toEqual(['oldhash']);
  });

  it('uses the journal of the old torrent as it is right before the write', async () => {
    const s = setup();
    const origInfo = s.c.loadInfo as any;
    (s.c.loadInfo as any) = vi.fn((h: string) => {
      // playback writes meanwhile
      const d = JSON.parse(s.server.oldhash.data!);
      d.omp.h.unshift({ f: 3, t: 50, d: 1400, at: T0 + 9000, src: 'tv' });
      s.server.oldhash.data = JSON.stringify(d);
      return origInfo(h);
    });
    await replaceTorrent(s.c, 'oldhash', 'magnet:x');
    expect(parseData(s.sets[0].data)!.journal.map((e) => e.f)).toEqual([3, 2, 1]);
  });

  it('loads the file list of the old torrent when it is unknown, and fails when it stays unknown', async () => {
    const foreign = JSON.stringify({ omp: { v: 1, h: [{ f: 2, t: 9, d: 99, at: T0, src: 'tv' }] } });
    const s = setup({ old: { file_stats: undefined, data: foreign } });
    const origInfo = s.c.loadInfo as any;
    (s.c.loadInfo as any) = vi.fn((h: string) => (h === 'oldhash' ? Promise.resolve({ ...s.old, file_stats: OLD_FILES }) : origInfo(h)));
    const r = await replaceTorrent(s.c, 'oldhash', 'magnet:x');
    expect(r.ok).toBe(true);
    expect(parseData(s.sets[0].data)!.journal.map((e) => e.f)).toEqual([2]);

    const s2 = setup({ old: { file_stats: undefined, data: foreign } });
    const r2 = await replaceTorrent(s2.c, 'oldhash', 'magnet:x');
    expect(r2.ok).toBe(false);
    expect(Object.keys(s2.server)).toEqual(['oldhash']);
  });

  it('does not write when there is nothing to carry', async () => {
    const s = setup({ old: { data: dataOf(OLD_FILES), poster: '', category: '', title: 'Show S01 1080p' } });
    const r = await replaceTorrent(s.c, 'oldhash', 'magnet:x');
    expect(r.ok).toBe(true);
    expect(s.sets).toHaveLength(0);
    expect(s.calls).toEqual(['add', 'info', 'rem:oldhash']);
  });

  it('a failed add leaves the old one and removes nothing', async () => {
    const s = setup({ failAdd: true });
    torrents.value = [{ ...s.old }];
    const r = await replaceTorrent(s.c, 'oldhash', 'magnet:x');
    expect(r).toEqual({ ok: false, error: 'Не удалось добавить новую раздачу.', cause: 'other' });
    expect(s.calls).toEqual(['add']);
    expect(torrents.value.map((t) => t.hash)).toEqual(['oldhash']);
  });

  it('a failed file list removes the new one and keeps the old', async () => {
    const s = setup({ failInfo: true });
    const r = await replaceTorrent(s.c, 'oldhash', 'magnet:x');
    expect(r.ok).toBe(false);
    expect(s.calls).toEqual(['add', 'info', 'rem:newhash']);
    expect(Object.keys(s.server)).toEqual(['oldhash']);
  });

  it('times out waiting for the file list', async () => {
    const s = setup({ failInfo: 'hang' });
    const r = await replaceTorrent(s.c, 'oldhash', 'magnet:x', { timeoutMs: 20 });
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/список файлов/);
    expect(Object.keys(s.server)).toEqual(['oldhash']);
  });

  it('a failed write of the data removes the new one and keeps the old', async () => {
    const s = setup({ failSet: true });
    torrents.value = [{ ...s.old }];
    const r = await replaceTorrent(s.c, 'oldhash', 'magnet:x');
    expect(r.ok).toBe(false);
    expect(s.calls).toEqual(['add', 'info', 'set', 'rem:newhash']);
    expect(Object.keys(s.server)).toEqual(['oldhash']);
    expect(torrents.value.map((t) => t.hash)).toEqual(['oldhash']);
  });

  it('a new torrent that was already on the server is never removed', async () => {
    const s = setup({ existing: true, failSet: true });
    const r = await replaceTorrent(s.c, 'oldhash', 'magnet:x');
    expect(r.ok).toBe(false);
    expect(s.calls).toEqual(['add', 'info', 'set']);
    expect(Object.keys(s.server).sort()).toEqual(['newhash', 'oldhash']);
  });

  it('keepOwn (a duplicate already in the library): the history moves, the kept one keeps its title, poster and category', async () => {
    const s = setup({ existing: true, old: { category: 'movie' }, fresh: { title: 'Show S01 1080p WEB-DL', poster: 'http://p/new.jpg', category: 'tv' } });
    const adds: unknown[] = [];
    const c = {
      ...s.c,
      add: vi.fn((p: unknown) => {
        adds.push(p);
        return Promise.resolve({ ...s.server.newhash });
      }),
    } as ReplaceClient;
    const r = await replaceTorrent(c, 'oldhash', 'magnet:?xt=urn:btih:newhash', { title: 'Show S01 1080p WEB-DL', keepOwn: true });
    expect(r).toEqual({ ok: true, hash: 'newhash' });
    expect(adds).toEqual([{ link: 'magnet:?xt=urn:btih:newhash', title: 'Show S01 1080p WEB-DL' }]);
    expect(Object.keys(s.server)).toEqual(['newhash']);
    const kept = s.server.newhash;
    expect(kept.category).toBe('tv');
    expect(kept.poster).toBe('http://p/new.jpg');
    expect(kept.title).toBe('Show S01 1080p WEB-DL');
    // the watch positions are on the kept release, matched by episode
    const j = parseData(kept.data)!.journal;
    expect(j.map((e) => [e.f, e.t])).toEqual([[2, 100], [1, 1400]]);
  });

  it('keepOwn: the kept release keeps its own history and settings, merged with the old one (newest per file and device)', async () => {
    const own = dataOf(NEW_FILES, {
      omp: {
        v: 1,
        h: [
          { f: 1, t: 500, d: 1400, at: T0 + 10000, src: 'tv' },
          { f: 3, t: 200, d: 1400, at: T0 - 100, src: 'phone', name: 'Pixel' },
        ],
        s: { i: false, c: true },
        q: false,
      },
    });
    const s = setup({ existing: true, fresh: { title: 'Show S01 1080p', category: 'tv', data: own } });
    const c = { ...s.c, add: vi.fn(() => Promise.resolve({ ...s.server.newhash })) } as ReplaceClient;
    const r = await replaceTorrent(c, 'oldhash', 'magnet:?xt=urn:btih:newhash', { keepOwn: true });
    expect(r).toEqual({ ok: true, hash: 'newhash' });
    const p = parseData(s.server.newhash.data)!;
    expect(p.journal.map((e) => [e.f, e.t, e.src])).toEqual([[1, 500, 'tv'], [2, 100, 'phone'], [3, 200, 'phone']]);
    const omp = p.obj.omp as { [k: string]: unknown };
    // the kept release's own skip settings and flags win; the old one's other keys come along
    expect(p.skip).toEqual({ i: false, c: true });
    expect(omp.q).toBe(false);
    expect(omp.w).toBe(false);
    expect(omp.fut).toEqual({ a: 1 });
  });

  it("keepOwn: the old release's category marks (cm, ca) stay with it", async () => {
    const oldData = dataOf(OLD_FILES, { omp: { v: 1, h: [{ f: 1, t: 10, d: 1400, at: T0, src: 'tv' }], cm: true, ca: 'movie' } });
    const s = setup({ existing: true, old: { data: oldData }, fresh: { category: 'tv' } });
    const c = { ...s.c, add: vi.fn(() => Promise.resolve({ ...s.server.newhash })) } as ReplaceClient;
    const r = await replaceTorrent(c, 'oldhash', 'magnet:?xt=urn:btih:newhash', { keepOwn: true });
    expect(r.ok).toBe(true);
    const omp = parseData(s.server.newhash.data)!.obj.omp as { [k: string]: unknown };
    expect(omp.cm).toBeUndefined();
    expect(omp.ca).toBeUndefined();
    expect(s.server.newhash.category).toBe('tv');
  });

  it('the same torrent is refused without removing anything', async () => {
    const s = setup();
    const c = { ...s.c, add: vi.fn(() => Promise.resolve({ ...s.old })) } as ReplaceClient;
    const r = await replaceTorrent(c, 'oldhash', 'magnet:x');
    expect(r).toEqual({ ok: false, error: 'Это та же раздача, заменять нечего.', cause: 'other' });
    expect(s.calls).toEqual([]);
    expect(Object.keys(s.server)).toEqual(['oldhash']);
  });

  describe('in English', () => {
    afterEach(() => applyLanguageSetting('ru'));

    it('the errors are English', async () => {
      applyLanguageSetting('en');
      const s = setup();
      const c = { ...s.c, add: vi.fn(() => Promise.resolve({ ...s.old })) } as ReplaceClient;
      const r = await replaceTorrent(c, 'oldhash', 'magnet:x');
      expect(r).toEqual({ ok: false, error: 'This is the same torrent, nothing to replace.', cause: 'other' });
      const s2 = setup();
      const r2 = await replaceTorrent(s2.c, 'nohash', 'magnet:x');
      expect(r2.ok).toBe(false);
      if (!r2.ok) expect(r2.error).not.toMatch(/[А-Яа-яЁё]/);
    });
  });

  it('refuses an unknown old torrent before adding anything', async () => {
    const s = setup();
    const r = await replaceTorrent(s.c, 'nope', 'magnet:x');
    expect(r).toEqual({ ok: false, error: 'Раздача не найдена на сервере.', cause: 'other' });
    expect(s.calls).toEqual([]);
  });

  it('refuses when the old data is not JSON (the journal would be lost)', async () => {
    const s = setup({ old: { data: 'plain text' } });
    const r = await replaceTorrent(s.c, 'oldhash', 'magnet:x');
    expect(r.ok).toBe(false);
    expect(s.calls).toEqual([]);
  });

  it('when only the removal of the old one fails both stay, with the history on the new one', async () => {
    const s = setup({ failRemoveOld: true });
    torrents.value = [{ ...s.old }];
    const r = await replaceTorrent(s.c, 'oldhash', 'magnet:x');
    expect(r).toEqual({ ok: false, error: 'Новая раздача добавлена, но старую удалить не удалось.', cause: 'both' });
    expect(Object.keys(s.server).sort()).toEqual(['newhash', 'oldhash']);
    expect(torrents.value.map((t) => t.hash).sort()).toEqual(['newhash', 'oldhash']);
    expect(parseData(s.server.newhash.data)!.journal).toHaveLength(2);
  });
});

describe('replaceTorrent · stopping and causes', () => {
  const NEW = 'a'.repeat(40);
  const MAGNET = 'magnet:?xt=urn:btih:' + NEW + '&dn=x';

  it('an add that times out while TorrServer goes on: the torrent it added is taken back; cause timeout', async () => {
    const s = setup({ fresh: { hash: NEW } });
    (s.c.add as ReturnType<typeof vi.fn>).mockImplementation(() => {
      s.calls.push('add');
      s.server[NEW] = { ...s.fresh };
      return Promise.reject(Object.assign(new Error('Timeout'), { kind: 'timeout' }));
    });
    const r = await replaceTorrent(s.c, 'oldhash', MAGNET);
    expect(r).toMatchObject({ ok: false, cause: 'timeout' });
    expect(s.calls).toEqual(['add', 'rem:' + NEW]);
    expect(Object.keys(s.server)).toEqual(['oldhash']);
  });

  it('no file list in time: cause timeout, the new torrent is removed', async () => {
    vi.useFakeTimers();
    try {
      const s = setup({ failInfo: 'hang' });
      const p = replaceTorrent(s.c, 'oldhash', 'magnet:x', { timeoutMs: 1000 });
      await vi.advanceTimersByTimeAsync(1500);
      expect(await p).toMatchObject({ ok: false, cause: 'timeout' });
      expect(Object.keys(s.server)).toEqual(['oldhash']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('«Отмена» while waiting: stops at once, removes the new torrent, keeps the old one', async () => {
    const s = setup({ failInfo: 'hang' });
    const ab = replaceAbort();
    const p = replaceTorrent(s.c, 'oldhash', 'magnet:x', { abort: ab });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(s.server.newhash).toBeTruthy();
    ab.abort();
    expect(await p).toMatchObject({ ok: false, cause: 'cancelled' });
    expect(s.calls).toContain('rem:newhash');
    expect(Object.keys(s.server)).toEqual(['oldhash']);
  });

  it('«Отмена» before the add answers: the torrent added late is taken back', async () => {
    const s = setup();
    let answer: (t: Torrent) => void = () => undefined;
    (s.c.add as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise<Torrent>((resolve) => {
          answer = resolve;
        }),
    );
    const ab = replaceAbort();
    const p = replaceTorrent(s.c, 'oldhash', 'magnet:x', { abort: ab });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    ab.abort();
    expect(await p).toMatchObject({ ok: false, cause: 'cancelled' });
    s.server.newhash = { ...s.fresh };
    answer({ ...s.fresh });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(s.calls).toContain('rem:newhash');
    expect(Object.keys(s.server)).toEqual(['oldhash']);
  });

  it('the deadline stops the whole wait as a timeout', async () => {
    vi.useFakeTimers();
    try {
      const s = setup({ failInfo: 'hang' });
      const p = replaceTorrent(s.c, 'oldhash', 'magnet:x', { deadlineMs: 45000 });
      await vi.advanceTimersByTimeAsync(45001);
      expect(await p).toMatchObject({ ok: false, cause: 'timeout' });
      expect(Object.keys(s.server)).toEqual(['oldhash']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a site that wants a login: cause login, nothing added', async () => {
    registerSource({ id: 'locked', name: 'Kinozal', kind: 'builtin', search: () => Promise.resolve([]), resolve: () => Promise.reject(loginRequired()) });
    try {
      const s = setup();
      const ctx = { http: { get: () => Promise.reject(new Error('no')), post: () => Promise.reject(new Error('no')), clearCookies: () => Promise.resolve() }, client: null };
      const r = await replaceWithResult(
        s.c,
        'oldhash',
        { Title: 'x', Categories: '', Size: '', CreateDate: '', Tracker: '', Link: '', Magnet: '', Hash: '', Peer: 0, Seed: 1, source: 'locked' },
        ctx,
      );
      expect(r).toMatchObject({ ok: false, cause: 'login' });
      expect(s.calls).toEqual([]);
    } finally {
      unregisterSource('locked');
    }
  });
});

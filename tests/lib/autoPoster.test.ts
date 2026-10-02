import { describe, it, expect, vi } from 'vitest';
import { attachPoster, fillPosters, type PosterClient } from '../../src/lib/autoPoster';
import type { Torrent, TmdbConfig } from '../../src/api/types';

const HASH = 'a'.repeat(40);

function client(cfg: TmdbConfig | null, states: Partial<Torrent>[]) {
  let i = 0;
  const c = {
    tmdbSettings: vi.fn(() => Promise.resolve(cfg)),
    get: vi.fn(() => {
      const s = states[Math.min(i, states.length - 1)];
      i++;
      return Promise.resolve({ hash: HASH, title: '', stat: 0, ...s } as Torrent);
    }),
    setPoster: vi.fn(() => Promise.resolve()),
  };
  return c as typeof c & PosterClient;
}

const found = (path: string) => vi.fn((_url: string) => Promise.resolve({ results: [{ poster_path: path }] }));
const noWait = () => Promise.resolve();

describe('attachPoster', () => {
  it('does nothing when the server has no TMDB key', async () => {
    const fetchJson = found('/p.jpg');
    for (const cfg of [null, {}, { APIKey: '' }]) {
      const c = client(cfg, [{ title: 'Дюна (2021)' }]);
      expect(await attachPoster(c, HASH, '', { fetchJson, wait: noWait })).toBe('');
      expect(c.setPoster).not.toHaveBeenCalled();
    }
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('searches by the hint and stores the first poster', async () => {
    const c = client({ APIKey: 'k' }, [{ title: '', category: 'movie' }]);
    const fetchJson = found('/p.jpg');
    const poster = await attachPoster(c, HASH, 'Дюна / Dune (2021) 1080p', { fetchJson, wait: noWait });
    expect(poster).toBe('https://imagetmdb.com/t/p/w300/p.jpg');
    expect(fetchJson.mock.calls[0][0]).toContain('query=' + encodeURIComponent('Дюна'));
    expect(c.setPoster).toHaveBeenCalledWith(expect.objectContaining({ hash: HASH, category: 'movie' }), poster);
  });

  it('waits for TorrServer to read the title when there is no hint', async () => {
    const c = client({ APIKey: 'k' }, [{}, {}, { title: 'Severance.S01.1080p' }]);
    const fetchJson = found('/s.jpg');
    const wait = vi.fn(noWait);
    await attachPoster(c, HASH, '', { fetchJson, wait });
    expect(wait).toHaveBeenCalledTimes(2);
    expect(fetchJson.mock.calls[0][0]).toContain('query=Severance');
    expect(c.setPoster).toHaveBeenCalled();
  });

  it('gives up when the title never arrives', async () => {
    const c = client({ APIKey: 'k' }, [{}]);
    const fetchJson = found('/s.jpg');
    expect(await attachPoster(c, HASH, '', { fetchJson, wait: noWait, tries: 3 })).toBe('');
    expect(c.get).toHaveBeenCalledTimes(3);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('keeps a poster that is already set, before or during the search', async () => {
    const before = client({ APIKey: 'k' }, [{ title: 'X', poster: 'http://p/1.jpg' }]);
    expect(await attachPoster(before, HASH, 'X', { fetchJson: found('/p.jpg'), wait: noWait })).toBe('');
    const during = client({ APIKey: 'k' }, [{ title: 'X' }, { title: 'X', poster: 'http://p/2.jpg' }]);
    expect(await attachPoster(during, HASH, 'X', { fetchJson: found('/p.jpg'), wait: noWait })).toBe('');
    expect(before.setPoster).not.toHaveBeenCalled();
    expect(during.setPoster).not.toHaveBeenCalled();
  });

  it('is quiet when nothing is found or TMDB fails', async () => {
    const empty = client({ APIKey: 'k' }, [{ title: 'X' }]);
    expect(await attachPoster(empty, HASH, 'X', { fetchJson: vi.fn(() => Promise.resolve({ results: [] })), wait: noWait })).toBe('');
    const failing = client({ APIKey: 'k' }, [{ title: 'X' }]);
    expect(await attachPoster(failing, HASH, 'X', { fetchJson: vi.fn(() => Promise.reject(new Error('net'))), wait: noWait })).toBe('');
    expect(empty.setPoster).not.toHaveBeenCalled();
    expect(failing.setPoster).not.toHaveBeenCalled();
  });
});

describe('fillPosters', () => {
  const T = (hash: string, extra: Partial<Torrent> = {}) => ({ hash, title: 'Film ' + hash, stat: 0, ...extra }) as Torrent;

  it('reads the TMDB settings once and fills only torrents without a poster', async () => {
    const list = [T('a'), T('b', { poster: 'http://p/b.jpg' }), T('c'), T('d', { title: '' })];
    const c = {
      tmdbSettings: vi.fn(() => Promise.resolve({ APIKey: 'k' })),
      get: vi.fn((h: string) => Promise.resolve(list.find((t) => t.hash === h)!)),
      setPoster: vi.fn(() => Promise.resolve()),
    };
    const fetchJson = vi.fn((url: string) => Promise.resolve({ results: url.includes('Film%20a') ? [{ poster_path: '/a.jpg' }] : [] }));
    const seen: string[] = [];
    const r = await fillPosters(c, list, { fetchJson, wait: noWait, onEach: (h, p, done, total) => seen.push(h + ':' + (p ? 'y' : 'n') + ':' + done + '/' + total) });
    expect(r).toEqual({ tried: 2, found: 1, hasKey: true });
    expect(seen).toEqual(['a:y:1/2', 'c:n:2/2']);
    expect(c.tmdbSettings).toHaveBeenCalledTimes(1);
    expect(c.setPoster).toHaveBeenCalledTimes(1);
  });

  it('skips torrents the caller says were tried, and does nothing without a key', async () => {
    const list = [T('a'), T('b')];
    const c = {
      tmdbSettings: vi.fn(() => Promise.resolve({ APIKey: 'k' })),
      get: vi.fn((h: string) => Promise.resolve(list.find((t) => t.hash === h)!)),
      setPoster: vi.fn(() => Promise.resolve()),
    };
    const r = await fillPosters(c, list, { skip: (h) => h === 'a', fetchJson: vi.fn(() => Promise.resolve({ results: [] })), wait: noWait });
    expect(r.tried).toBe(1);
    const noKey = { ...c, tmdbSettings: vi.fn(() => Promise.resolve(null)) };
    expect(await fillPosters(noKey, list)).toEqual({ tried: 0, found: 0, hasKey: false });
  });
});

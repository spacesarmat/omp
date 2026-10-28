import { describe, it, expect, vi } from 'vitest';
import { checkPosterUrl, posterCandidates, posterSearchText, posterTargets, posterYear, resetPoster, savePoster, storedPosterUrl } from '../../src/lib/posterPick';
import { findPoster, posterKind } from '../../src/lib/autoPoster';
import { tmdbTypedSearchRequest, yearPoster } from '../../src/lib/posterSearch';
import { posterImageSize } from '../../src/catalog/tmdb';
import type { Torrent } from '../../src/api/types';
import type { CatalogTitle } from '../../src/catalog/tmdb';

const film = (hash: string, title: string, extra: Partial<Torrent> = {}): Torrent => ({ hash, title, category: 'movie', stat: 3, ...extra });
const title = (id: number, kind: 'movie' | 'tv', year: number, poster = 'https://i/p' + id + '.jpg'): CatalogTitle => ({ id, kind, title: 'T' + id, original: '', year, poster, rating: 0 });

describe('checkPosterUrl', () => {
  it('takes https anywhere and http on the home network only', () => {
    expect(checkPosterUrl(' https://img.example/p.jpg ')).toEqual({ ok: true, url: 'https://img.example/p.jpg' });
    expect(checkPosterUrl('http://192.168.1.10:8090/p.jpg')).toEqual({ ok: true, url: 'http://192.168.1.10:8090/p.jpg' });
    expect(checkPosterUrl('http://nas.local/p.jpg').ok).toBe(true);
    expect(checkPosterUrl('http://img.example/p.jpg')).toEqual({ ok: false, error: 'torrent.poster.httpPublic' });
  });

  it('refuses other schemes, spaces, quotes and overlong links', () => {
    for (const bad of ['', 'img.example/p.jpg', 'ftp://x/p.jpg', 'javascript:alert(1)', 'data:image/png;base64,AA', 'https://x/a b.jpg', 'https://x/"a.jpg', 'https://']) {
      expect(checkPosterUrl(bad).ok, bad).toBe(false);
    }
    expect(checkPosterUrl('https://x/' + 'a'.repeat(2000))).toEqual({ ok: false, error: 'torrent.poster.urlTooLong' });
  });
});

describe('posterCandidates', () => {
  it('keeps the torrent kind, puts its year first, then a year off, then TMDB order', () => {
    const items = [title(1, 'tv', 2015), title(2, 'movie', 1984), title(3, 'movie', 2027), title(4, 'movie', 2026), title(5, 'movie', 0), title(6, 'movie', 2026, '')];
    expect(posterCandidates(items, 'movie', 2026).map((x) => x.id)).toEqual([4, 3, 2, 5]);
    expect(posterCandidates(items, 'tv', 2026).map((x) => x.id)).toEqual([1]);
    // no kind: everything with a poster, in TMDB order without a year
    expect(posterCandidates(items, null, 0).map((x) => x.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('falls back to every kind when none of the results is of the torrent kind', () => {
    expect(posterCandidates([title(1, 'tv', 2020)], 'movie', 2020).map((x) => x.id)).toEqual([1]);
  });
});

describe('the search text and the year', () => {
  it('reads the title proper and the year from the release name', () => {
    const t = film('h', 'Супергерл / Supergirl / 2026 / ДБ, СТ / 4K, HEVC / Blu-Ray Remux (2160p)');
    expect(posterSearchText(t)).toBe('Супергерл');
    expect(posterYear(t)).toBe(2026);
    expect(posterKind(t)).toBe('movie');
    expect(posterKind(film('s', 'Show S02 1080p', { category: 'tv' }))).toBe('tv');
    expect(posterKind(film('m', 'Album', { category: 'music' }))).toBeNull();
  });

  it('stores TMDB posters at the sharp size, other links as typed', () => {
    expect(storedPosterUrl('https://imagetmdb.com/t/p/w185/a.jpg')).toBe('https://imagetmdb.com/t/p/w500/a.jpg');
    expect(storedPosterUrl('https://x/p.jpg')).toBe('https://x/p.jpg');
  });
});

describe('posterTargets', () => {
  it('a film with several releases: this one first, then the others; a series: itself', () => {
    const a = film('a', 'Дюна: Часть вторая / Dune: Part Two (2024) WEB-DL 1080p');
    const b = film('b', 'Дюна: Часть вторая / Dune: Part Two (2024) 2160p Remux');
    const c = film('c', 'Другое кино (2020)');
    expect(posterTargets([a, b, c], b).map((x) => x.hash)).toEqual(['b', 'a']);
    expect(posterTargets([a, b, c], c).map((x) => x.hash)).toEqual(['c']);
    const s = film('s', 'Show S01 1080p', { category: 'tv' });
    expect(posterTargets([s], s).map((x) => x.hash)).toEqual(['s']);
  });
});

describe('savePoster', () => {
  it('reads each torrent again right before its write and sends its current title and category back', async () => {
    const calls: string[] = [];
    const c = {
      get: vi.fn(async (h: string) => {
        calls.push('get ' + h);
        return film(h, 'server ' + h, { category: h === 'a' ? 'movie' : 'tv' });
      }),
      setPoster: vi.fn(async (t: { hash: string }) => {
        calls.push('set ' + t.hash);
      }),
    };
    const r = await savePoster(c, [film('a', 'listed a'), film('b', 'listed b')], 'https://p.jpg');
    expect(r).toEqual({ saved: ['a', 'b'], failed: 0 });
    expect(calls).toEqual(['get a', 'set a', 'get b', 'set b']);
    expect(c.setPoster.mock.calls[0][0]).toEqual(expect.objectContaining({ hash: 'a', title: 'server a', category: 'movie' }));
    expect(c.setPoster.mock.calls[1][0]).toEqual(expect.objectContaining({ hash: 'b', title: 'server b', category: 'tv' }));
  });

  it('uses the listed torrent when the read fails, counts failed writes and rejects only when none was written', async () => {
    const c = {
      get: vi.fn(async () => Promise.reject(new Error('down'))),
      setPoster: vi.fn(async (t: { hash: string }) => {
        if (t.hash === 'b') throw new Error('nope');
      }),
    };
    const r = await savePoster(c, [film('a', 'listed a'), film('b', 'listed b')], 'https://p.jpg');
    expect(r).toEqual({ saved: ['a'], failed: 1 });
    expect(c.setPoster.mock.calls[0][0]).toEqual(expect.objectContaining({ hash: 'a', title: 'listed a', category: 'movie' }));
    await expect(savePoster(c, [film('b', 'x')], '')).rejects.toThrow('nope');
  });
});

describe('resetPoster', () => {
  it('clears every release, looks one up for the first and gives the others the same', async () => {
    const stored: { [h: string]: string } = { a: 'https://old/a.jpg', b: 'https://old/b.jpg' };
    const list = [film('a', 'Супергерл / Supergirl / 2026 / 4K'), film('b', 'Супергерл / Supergirl (2026) 1080p')];
    const c = {
      get: vi.fn(async (h: string) => ({ ...list.find((x) => x.hash === h)!, poster: stored[h] })),
      setPoster: vi.fn(async (t: { hash: string }, p: string) => {
        stored[t.hash] = p;
      }),
      tmdbSettings: vi.fn(async () => ({ APIKey: 'k' })),
    };
    const fetchJson = vi.fn(async () => ({ results: [{ poster_path: '/f.jpg', release_date: '2026-06-26' }] }));
    const found = await resetPoster(c, list, { fetchJson });
    const url = 'https://imagetmdb.com/t/p/' + posterImageSize() + '/f.jpg';
    expect(found).toBe(url);
    expect(c.setPoster.mock.calls.map((x) => x[0].hash + '=' + x[1])).toEqual(['a=', 'b=', 'a=' + url, 'b=' + url]);
  });
});

describe('the background poster lookup', () => {
  const cfg = { APIKey: 'k' };
  const respond = (byKind: { [k: string]: unknown[] }) =>
    vi.fn(async (u: string) => ({ results: byKind[/\/3\/search\/([a-z]+)/.exec(u)![1]] || [] }));

  it('a film with a year: the film of that year, not the first result of the multi search', async () => {
    const fetchJson = respond({
      movie: [{ poster_path: '/old.jpg', release_date: '1984-07-19' }, { poster_path: '/new.jpg', release_date: '2026-06-26' }],
      multi: [{ poster_path: '/series.jpg', first_air_date: '2015-10-26' }],
    });
    const p = await findPoster(cfg, fetchJson, 'Супергерл / Supergirl / 2026 / 4K', 'movie');
    expect(p).toBe('https://imagetmdb.com/t/p/' + posterImageSize() + '/new.jpg');
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('a film dated a year off counts; no film of that year falls back to the multi search', async () => {
    expect(yearPoster(cfg, [{ poster_path: '/x.jpg', release_date: '2027-01-02' }], 2026)).toContain('/x.jpg');
    const fetchJson = respond({ movie: [{ poster_path: '/old.jpg', release_date: '1984-07-19' }], multi: [{ poster_path: '/m.jpg' }] });
    expect(await findPoster(cfg, fetchJson, 'Супергерл (2026)', 'movie')).toContain('/m.jpg');
    expect(fetchJson.mock.calls.map((c) => /search\/([a-z]+)/.exec(String(c[0]))![1])).toEqual(['movie', 'multi']);
  });

  it('a series is looked up among series, the year only breaks ties; a failed typed search falls back', async () => {
    const fetchJson = respond({ tv: [{ poster_path: '/a.jpg', first_air_date: '2019-01-01' }, { poster_path: '/b.jpg', first_air_date: '2024-01-01' }] });
    expect(await findPoster(cfg, fetchJson, 'Show S02 [2024, WEB-DL]', 'tv')).toContain('/b.jpg');
    expect(await findPoster(cfg, fetchJson, 'Show S02 [2026, WEB-DL]', 'tv')).toContain('/a.jpg');
    const failing = vi.fn(async (u: string) => {
      if (u.indexOf('/search/tv') >= 0) throw new Error('down');
      return { results: [{ poster_path: '/m.jpg' }] };
    });
    expect(await findPoster(cfg, failing, 'Show S02', 'tv')).toContain('/m.jpg');
  });

  it('builds the typed search URL on the same base and keeps a v4 token out of it', () => {
    expect(tmdbTypedSearchRequest({ APIKey: 'k', APIURL: 'https://proxy.example/3/search/multi' }, 'movie', 'x').url).toMatch(/^https:\/\/proxy\.example\/3\/search\/movie\?api_key=k&/);
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig';
    const req = tmdbTypedSearchRequest({ APIKey: token }, 'tv', 'x');
    expect(req.url).toMatch(/^https:\/\/api\.themoviedb\.org\/3\/search\/tv\?language=ru/);
    expect(req.headers).toEqual({ Authorization: 'Bearer ' + token });
  });
});

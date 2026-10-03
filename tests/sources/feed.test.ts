import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { feedAll, feedSources } from '../../src/sources/feed';
import { rutor } from '../../src/sources/rutor';
import { nnmclub } from '../../src/sources/nnmclub';
import { torrentby } from '../../src/sources/torrentby';
import { anidub } from '../../src/sources/anidub';
import { mergePages } from '../../src/sources/site';
import { getHealth, reloadSourcePrefs, resetHealth, setHealth, setSourceOn } from '../../src/sources/store';
import { SOURCE_TIMEOUT_MS } from '../../src/sources/search';
import type { Source, SourceResult } from '../../src/sources/types';
import { fakeSite, fixture, page, CLOUDFLARE } from './fakeSite';

const GB = 1024 * 1024 * 1024;

function res(source: string, Title: string, date?: number, hash?: string): SourceResult {
  return { Title, Categories: '', Size: '', CreateDate: '', Tracker: source, Link: '', Magnet: '', Hash: '', Peer: 0, Seed: 1, source, hash, date };
}

beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
  resetHealth();
});

describe('rutor.latest', () => {
  it('reads the section pages of a category, newest first', async () => {
    const site = fakeSite((c) => page(fixture('rutor-browse.html'), c.url));
    const list = await rutor.latest!(site.ctx, 'tv');
    expect(site.calls.map((c) => c.url)).toEqual(['https://rutor.info/browse/0/4/0/0', 'https://rutor.info/browse/0/16/0/0']);
    // both calls answered with the same page: 2 × 5 rows, sorted by date (stable)
    expect(list).toHaveLength(10);
    const a = list[0];
    expect(a.source).toBe('rutor');
    expect(a.Title).toBe('Американская история ужасов / American Horror Story [13x01-06 из 13] (2026) WEBRip от Kerob | L2');
    expect(a.hash).toBe('f817c9ed9d81c73850acc9db4f7c57584015d202');
    expect(a.sizeBytes).toBe(Math.round(1.23 * GB));
    expect(a.date).toBe(new Date(2026, 9, 3).getTime());
    expect(list[list.length - 1].date).toBe(new Date(2026, 9, 2).getTime());
    for (let i = 1; i < list.length; i++) expect(list[i - 1].date! >= list[i].date!).toBe(true);
  });

  it('asks the right sections for movies and anime', async () => {
    const site = fakeSite((c) => page(fixture('rutor-browse.html'), c.url));
    await rutor.latest!(site.ctx, 'movie');
    await rutor.latest!(site.ctx, 'anime');
    expect(site.calls.map((c) => c.url)).toEqual([
      'https://rutor.info/browse/0/1/0/0',
      'https://rutor.info/browse/0/5/0/0',
      'https://rutor.info/browse/0/10/0/0',
    ]);
  });

  it('keeps the section that answered and fails only when all fail', async () => {
    const half = fakeSite((c) => (c.url.indexOf('/16/') > 0 ? page('oops', c.url, 502) : page(fixture('rutor-browse.html'), c.url)));
    expect(await rutor.latest!(half.ctx, 'tv')).toHaveLength(5);
    const none = fakeSite((c) => page(CLOUDFLARE, c.url, 403));
    await expect(rutor.latest!(none.ctx, 'tv')).rejects.toThrow('Сайт закрыт проверкой браузера (Cloudflare), попробуйте позже');
  });
});

describe('nnmclub.latest', () => {
  it('reads the tracker list of the category (guest page)', async () => {
    const site = fakeSite((c) => page(fixture('nnmclub-tracker.html'), c.url));
    const list = await nnmclub.latest!(site.ctx, 'tv');
    expect(site.calls.map((c) => c.url)).toEqual(['https://nnmclub.to/forum/tracker.php?c=27']);
    // the first row awaits approval (topicpremod) and is left out, as in the search
    expect(list.map((r) => r.Title)).toEqual([
      'Тёмная материя / Dark Matter (2026) WEB-DL [H.264/1080p] (сезон 2, серии 1-6 из 10) LostFilm, HDRezka, NewComers, ViruseProject, ColdFilm (обновляемая)',
      'Гангстерленд / MobLand (2026) WEB-DL [H.264/1080p] (сезон 2, серии 1-3 из 10) RHS, LostFilm, HDRezka, NewComers, ViruseProject, ColdFilm (обновляемая)',
      'Медленные лошади / Хромые кони / Slow Horses (2026) WEB-DL [H.264/1080p] (сезон 6, серии 1-3 из 6) LostFilm, HDRezka, RHS (обновляемая)',
    ]);
    const a = list[0];
    expect(a.source).toBe('nnmclub');
    expect(a.detailUrl).toBe('https://nnmclub.to/forum/viewtopic.php?t=1888339');
    expect(a.sizeBytes).toBe(30978251415);
    expect(a.Seed).toBe(7);
    expect(a.Peer).toBe(37);
    expect(a.Magnet).toBe('');
  });

  it('asks the movie and anime categories', async () => {
    const site = fakeSite((c) => page(fixture('nnmclub-tracker.html'), c.url));
    await nnmclub.latest!(site.ctx, 'movie');
    await nnmclub.latest!(site.ctx, 'anime');
    expect(site.calls.map((c) => c.url)).toEqual(['https://nnmclub.to/forum/tracker.php?c=14', 'https://nnmclub.to/forum/tracker.php?c=24']);
  });
});

describe('torrentby.latest', () => {
  it('reads the list after the heading, not the «need seeding» table', async () => {
    const site = fakeSite((c) => page(fixture('torrentby-category.html'), c.url));
    const list = await torrentby.latest!(site.ctx, 'anime');
    expect(site.calls.map((c) => c.url)).toEqual(['https://torrent.by/anime/']);
    expect(list).toHaveLength(5);
    const titles = list.map((r) => r.Title);
    expect(titles.indexOf('Два года спустя / Two Years Later [S01] (2026) WEB-DL 720p от New-Team | D | ДАБЛИН')).toBe(-1);
    expect(titles).toContain('Тед Лассо / Ted Lasso [04x01-09 из 10] (2026) WEB-DL 1080p | P, D, P2');
    const ted = list.filter((r) => r.Title.indexOf('Тед Лассо') === 0)[0];
    expect(ted.source).toBe('torrentby');
    expect(ted.detailUrl!.indexOf('https://torrent.by/')).toBe(0);
    expect(ted.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(ted.sizeBytes).toBeGreaterThan(GB);
    expect(typeof ted.date).toBe('number');
  });

  it('asks both sections for movies and series', async () => {
    const site = fakeSite((c) => page(fixture('torrentby-category.html'), c.url));
    await torrentby.latest!(site.ctx, 'movie');
    await torrentby.latest!(site.ctx, 'tv');
    expect(site.calls.map((c) => c.url)).toEqual([
      'https://torrent.by/films/',
      'https://torrent.by/movies/',
      'https://torrent.by/serials/',
      'https://torrent.by/series/',
    ]);
  });

  it('reports a page without the list', async () => {
    const site = fakeSite((c) => page('<html><body><p>нет</p></body></html>', c.url));
    await expect(torrentby.latest!(site.ctx, 'anime')).rejects.toThrow('Не удалось разобрать страницу сайта');
  });
});

describe('mergePages', () => {
  it('sorts newest first, undated last, and is empty without pages', async () => {
    const list = await mergePages([Promise.resolve([res('a', 'old', 1), res('a', 'none')]), Promise.resolve([res('b', 'new', 5)])]);
    expect(list.map((r) => r.Title)).toEqual(['new', 'old', 'none']);
    expect(await mergePages([])).toEqual([]);
  });
});

describe('feedAll', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function feedSource(id: string, impl: Source['latest']): Source {
    return { id, name: id, kind: 'builtin', search: () => Promise.resolve([]), latest: impl };
  }

  it('lists only sources with a feed', () => {
    expect(feedSources([rutor, nnmclub, anidub, torrentby]).map((s) => s.id)).toEqual(['rutor', 'nnmclub', 'torrentby']);
  });

  it('asks the switched-on feed sources in parallel and merges duplicates', async () => {
    setSourceOn('off', false);
    const asked: string[] = [];
    const nofeed: Source = { id: 'nofeed', name: 'nofeed', kind: 'builtin', search: () => Promise.resolve([]) };
    const from = [
      feedSource('a', (ctx, c) => {
        asked.push('a:' + c);
        return Promise.resolve([res('a', 'X', 2, 'h1'), res('a', 'Y', 1)]);
      }),
      feedSource('b', (ctx, c) => {
        asked.push('b:' + c);
        return Promise.resolve([res('b', 'X too', 3, 'h1')]);
      }),
      feedSource('off', () => {
        asked.push('off');
        return Promise.resolve([]);
      }),
      nofeed,
    ];
    const site = fakeSite(() => page('', ''));
    const h = feedAll(site.ctx, 'anime', { from });
    expect(h.sourceIds).toEqual(['a', 'b']);
    await h.done;
    expect(asked).toEqual(['a:anime', 'b:anime']);
    const merged = h.results();
    expect(merged).toHaveLength(2);
    expect(merged[0].sources).toEqual(['b']);
    const chosen = feedAll(site.ctx, 'tv', { from, sources: ['off', 'nofeed'] });
    expect(chosen.sourceIds).toEqual(['off']);
    await chosen.done;
  });

  it('does not touch the source health of the search', async () => {
    setHealth('a', { state: 'error', at: 1, message: 'search broke' });
    const site = fakeSite(() => page('', ''));
    const from = [feedSource('a', () => Promise.resolve([res('a', 'X', 1)])), feedSource('b', () => Promise.reject(new Error('feed broke')))];
    await feedAll(site.ctx, 'tv', { from }).done;
    expect(getHealth('a')).toEqual({ state: 'error', at: 1, message: 'search broke' });
    expect(getHealth('b')).toBeNull();
  });

  it('a feed source over 15 s fails', async () => {
    vi.useFakeTimers();
    const errors: string[] = [];
    const site = fakeSite(() => page('', ''));
    const h = feedAll(site.ctx, 'movie', {
      from: [feedSource('slow', () => new Promise<SourceResult[]>(() => undefined))],
      onDone: (id, err) => errors.push(id + ':' + (err ? err.message : '')),
    });
    await vi.advanceTimersByTimeAsync(SOURCE_TIMEOUT_MS);
    await h.done;
    expect(errors).toEqual(['slow:Источник не отвечает']);
    expect(h.failed()).toEqual(['slow']);
  });
});

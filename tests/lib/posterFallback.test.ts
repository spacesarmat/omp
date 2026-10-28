import { describe, it, expect, vi, afterEach } from 'vitest';
import { latinTitle, normTitle, posterQueries, sourcesYear, yearPoster, yoVariants } from '../../src/lib/posterSearch';
import { attachPoster, findPoster } from '../../src/lib/autoPoster';
import { pickerQueries, posterYear, searchCandidates } from '../../src/lib/posterPick';
import { setCatalogProvider } from '../../src/catalog/activeCatalog';
import { posterImageSize } from '../../src/catalog/tmdb';
import type { Torrent } from '../../src/api/types';
import type { CatalogTitle } from '../../src/catalog/tmdb';

const img = (p: string) => 'https://imagetmdb.com/t/p/' + posterImageSize() + p;
const cfg = { APIKey: 'k' };

// TMDB as it answers: «Супергерл» (е) finds nothing, «Супергёрл» and «Supergirl» find the 2026 film and the 1984 one;
// the multi search alone would give the 2015 series
const FILMS = [
  { title: 'Супергёрл', original_title: 'Supergirl', poster_path: '/1984.jpg', release_date: '1984-07-19' },
  { title: 'Супергёрл', original_title: 'Supergirl', poster_path: '/2026.jpg', release_date: '2026-06-26' },
];
const SERIES = [{ name: 'Супергёрл', original_name: 'Supergirl', poster_path: '/series.jpg', first_air_date: '2015-10-26' }];
function tmdb(opts: { yo?: boolean; latin?: boolean } = { yo: true, latin: true }) {
  return vi.fn(async (u: string) => {
    const kind = /\/3\/search\/([a-z]+)/.exec(u)![1];
    const q = decodeURIComponent(/[?&]query=([^&]*)/.exec(u)![1]);
    const hit = (opts.yo && q === 'Супергёрл') || (opts.latin && q === 'Supergirl');
    if (!hit) return { results: [] };
    if (kind === 'movie') return { results: FILMS };
    if (kind === 'tv') return { results: SERIES };
    return { results: SERIES.concat(FILMS as never[]) };
  });
}
const queriesOf = (f: ReturnType<typeof tmdb>) => f.mock.calls.map((c) => /search\/([a-z]+)/.exec(String(c[0]))![1] + ':' + decodeURIComponent(/query=([^&]*)/.exec(String(c[0]))![1]));

describe('search fallbacks: ё and the English title', () => {
  it('yoVariants reads each «е» as «ё» in turn, at most three; none when a «ё» is there', () => {
    expect(yoVariants('Супергерл')).toEqual(['Супёргерл', 'Супергёрл']);
    expect(yoVariants('Елка')).toEqual(['Ёлка']);
    expect(yoVariants('Супергёрл')).toEqual([]);
    expect(yoVariants('Supergirl')).toEqual([]);
    expect(yoVariants('где тебе ее').length).toBe(3);
  });

  it('normTitle reads ё as е and drops case and punctuation', () => {
    expect(normTitle('Супергёрл!')).toBe(normTitle('супергерл'));
    expect(normTitle('Ёлки: 2')).toBe('елки 2');
    expect(normTitle('Supergirl: Woman of Tomorrow')).toBe('supergirl woman of tomorrow');
    expect(normTitle('君の名は。')).toBe('君の名は。');
  });

  it('a title in another script is still searched (its comparison key is not empty)', async () => {
    expect(posterQueries('君の名は')).toEqual(['君の名は']);
    expect(posterQueries('Ялла / يلا')).toEqual(['Ялла']);
    const f = vi.fn(async () => ({ results: [{ poster_path: '/kimi.jpg', release_date: '2016-08-26' }] }));
    expect(await findPoster(cfg, f, '君の名は', 'movie')).toBe(img('/kimi.jpg'));
  });

  it('latinTitle takes the English part of «a / b / year» or of a release name', () => {
    expect(latinTitle(['Супергерл / Supergirl / 2026'])).toBe('Supergirl');
    expect(latinTitle(['Супергерл', 'Supergirl.2026.BDRemux.2160p.HDR-DV'])).toBe('Supergirl');
    expect(latinTitle(['Тихий сигнал / 2026'])).toBe('');
    expect(sourcesYear(['Супергерл', 'Supergirl.2026.BDRemux.2160p'])).toBe(2026);
  });

  it('posterQueries: the title, its ё variants, then the English title, each once', () => {
    expect(posterQueries('Супергерл / Supergirl / 2026')).toEqual(['Супергерл', 'Супёргерл', 'Супергёрл', 'Supergirl']);
    expect(posterQueries('Supergirl (2026)')).toEqual(['Supergirl']);
    expect(posterQueries('Ёлки 2', ['Ёлки 2 / Yolki 2'])).toEqual(['Ёлки 2', 'Yolki 2']);
  });

  it('yearPoster puts the result titled like the query first (ё read as е)', () => {
    const rows = [
      { title: 'Другое', poster_path: '/other.jpg', release_date: '2026-01-01' },
      { title: 'Супергёрл', poster_path: '/hit.jpg', release_date: '2026-06-26' },
    ];
    expect(yearPoster(cfg, rows, 2026, 'Супергерл')).toBe(img('/hit.jpg'));
    expect(yearPoster(cfg, rows, 2026)).toBe(img('/other.jpg'));
  });

  it('«Супергерл / Supergirl / 2026» resolves to the 2026 film through the ё variant, not the 2015 series', async () => {
    const f = tmdb({ yo: true });
    expect(await findPoster(cfg, f, 'Супергерл / Supergirl / 2026', 'movie')).toBe(img('/2026.jpg'));
    expect(queriesOf(f)).toEqual(['movie:Супергерл', 'movie:Супёргерл', 'movie:Супергёрл']);
  });

  it('«Супергерл / Supergirl / 2026» resolves to the 2026 film through the English title when ё does not help', async () => {
    const f = tmdb({ latin: true });
    expect(await findPoster(cfg, f, 'Супергерл / Supergirl / 2026', 'movie')).toBe(img('/2026.jpg'));
    expect(queriesOf(f)).toEqual(['movie:Супергерл', 'movie:Супёргерл', 'movie:Супергёрл', 'movie:Supergirl']);
  });

  it('a title without the year or the English part takes both from the torrent name', async () => {
    const f = tmdb({ latin: true });
    expect(await findPoster(cfg, f, 'Супергерл', 'movie', ['Супергерл', 'Supergirl.2026.BDRemux.2160p.HDR-DV'])).toBe(img('/2026.jpg'));
  });

  it('typed searches all come before the multi one', async () => {
    const f = tmdb({});
    expect(await findPoster(cfg, f, 'Супергерл / Supergirl / 2026', 'movie')).toBe('');
    const kinds = queriesOf(f).map((x) => x.split(':')[0]);
    expect(kinds).toEqual(['movie', 'movie', 'movie', 'movie', 'multi', 'multi', 'multi', 'multi']);
  });

  it('the background lookup stores the 2026 poster for a torrent titled «Супергерл» named «Supergirl.2026...»', async () => {
    const tor: Torrent = { hash: 'sg', title: 'Супергерл', name: 'Supergirl.2026.BDRemux.2160p.HDR-DV', category: 'movie', stat: 3 };
    const c = {
      get: vi.fn(async () => tor),
      tmdbSettings: vi.fn(async () => cfg),
      setPoster: vi.fn(async () => undefined),
    };
    const p = await attachPoster(c, 'sg', '', { fetchJson: tmdb({ latin: true }), tries: 1 });
    expect(p).toBe(img('/2026.jpg'));
    expect(c.setPoster).toHaveBeenCalledWith(tor, img('/2026.jpg'));
  });
});

describe('«Сменить постер» search fallbacks', () => {
  afterEach(() => setCatalogProvider(null));
  const tor: Torrent = { hash: 'sg', title: 'Супергерл', name: 'Supergirl.2026.BDRemux.2160p.HDR-DV', category: 'movie', stat: 3 };
  const item = (id: number, kind: 'movie' | 'tv', year: number): CatalogTitle => ({ id, kind, title: 'Супергёрл', original: 'Supergirl', year, poster: 'https://i/' + id + '.jpg', rating: 0 });

  it('the query, its ё variants, then the English title while the query is the torrent title', () => {
    expect(pickerQueries('Супергерл', tor)).toEqual(['Супергерл', 'Супёргерл', 'Супергёрл', 'Supergirl']);
    expect(pickerQueries('Матрица', tor)).toEqual(['Матрица']);
    expect(pickerQueries('Другое', tor)).toEqual(['Другое', 'Другоё']);
    expect(posterYear(tor)).toBe(2026);
  });

  it('nothing for «Супергерл»: the English title finds the 2026 film first', async () => {
    const search = vi.fn(async (q: string) => ({ items: q === 'Supergirl' ? [item(1, 'tv', 2015), item(2, 'movie', 1984), item(3, 'movie', 2026)] : [], pages: 1 }));
    setCatalogProvider(() => Promise.resolve({ search, posters: async () => [] } as never));
    const list = await searchCandidates('Супергерл', tor);
    expect(list.map((x) => x.id)).toEqual([3, 2]);
    expect(search.mock.calls.map((c) => c[0])).toEqual(['Супергерл', 'Супёргерл', 'Супергёрл', 'Supergirl']);
  });

  it('stops at the first search with results', async () => {
    const search = vi.fn(async (q: string) => ({ items: q === 'Супергёрл' ? [item(3, 'movie', 2026)] : [], pages: 1 }));
    setCatalogProvider(() => Promise.resolve({ search, posters: async () => [] } as never));
    expect((await searchCandidates('Супергерл', tor)).map((x) => x.id)).toEqual([3]);
    expect(search).toHaveBeenCalledTimes(3);
  });
});

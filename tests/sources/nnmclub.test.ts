import { describe, it, expect } from 'vitest';
import { nnmclub } from '../../src/sources/nnmclub';
import { fakeSite, fixture, page } from './fakeSite';

describe('nnmclub', () => {
  it('is a built-in source without login', () => {
    expect(nnmclub.id).toBe('nnmclub');
    expect(nnmclub.name).toBe('NNM-Club');
    expect(nnmclub.kind).toBe('builtin');
    expect(nnmclub.needsLogin).toBeFalsy();
  });

  it('searches the tracker and parses rows (no magnet on the list)', async () => {
    const site = fakeSite((c) => page(fixture('nnmclub-search.html'), c.url));
    const list = await nnmclub.search('матрица', site.ctx);
    expect(site.calls.map((c) => c.method + ' ' + c.url)).toEqual([
      'GET https://nnmclub.to/forum/tracker.php?nm=%D0%BC%D0%B0%D1%82%D1%80%D0%B8%D1%86%D0%B0',
    ]);
    expect(list).toHaveLength(3);
    const a = list[0];
    expect(a.source).toBe('nnmclub');
    expect(a.Tracker).toBe('NNM-Club');
    expect(a.Title).toBe('Матрица / The Matrix (1999) UHD BDRip [H.265/2160p] [4K, HDR10, DV 8.1, 10-bit] [handmade AI]');
    expect(a.detailUrl).toBe('https://nnmclub.to/forum/viewtopic.php?t=1892054');
    expect(a.Link).toBe(a.detailUrl);
    expect(a.Magnet).toBe('');
    expect(a.hash).toBeUndefined();
    expect(a.Categories).toBe('handmade * video');
    expect(a.Size).toBe('24.4 GB');
    expect(a.sizeBytes).toBe(26228254998);
    expect(a.Seed).toBe(19);
    expect(a.Peer).toBe(4);
    expect(a.date).toBe(1790365459 * 1000);
    expect(a.CreateDate).toBe(new Date(1790365459 * 1000).toISOString());
    expect(list[2].sizeBytes).toBe(33307120566);
    expect(list[2].Size).toBe('31 GB');
  });

  it('takes the magnet from the release page', async () => {
    const site = fakeSite((c) => page(fixture('nnmclub-detail.html'), c.url));
    const m = await nnmclub.magnet!('https://nnmclub.to/forum/viewtopic.php?t=1892054', site.ctx);
    expect(m).toBe('magnet:?xt=urn:btih:E65D3548F30476021969E0CE90F2815704AD6283');
    expect(site.calls[0].url).toBe('https://nnmclub.to/forum/viewtopic.php?t=1892054');
  });

  it('reports a release page without a magnet and a page it cannot read', async () => {
    const site = fakeSite((c) => page('<html><body>Тема не найдена</body></html>', c.url));
    await expect(nnmclub.magnet!('https://nnmclub.to/forum/viewtopic.php?t=1', site.ctx)).rejects.toThrow('На странице раздачи нет magnet-ссылки');
    await expect(nnmclub.search('x', site.ctx)).rejects.toThrow('Не удалось разобрать страницу сайта');
  });

  it('only opens release pages of nnmclub', async () => {
    const site = fakeSite((c) => page(fixture('nnmclub-detail.html'), c.url));
    await expect(nnmclub.magnet!('https://evil.example/viewtopic.php?t=1', site.ctx)).rejects.toThrow('Неверный адрес');
    expect(site.calls).toHaveLength(0);
  });

  it('returns nothing when the table has no rows', async () => {
    const empty =
      '<html><body><table class="forumline tablesorter"><thead><tr><th>Topic</th></tr></thead><tbody><tr><td class="row1" colspan="10">Не найдено</td></tr></tbody></table></body></html>';
    expect(await nnmclub.search('zzz', fakeSite((c) => page(empty, c.url)).ctx)).toEqual([]);
  });
});

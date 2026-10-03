import { describe, it, expect } from 'vitest';
import { rutor } from '../../src/sources/rutor';
import { fakeSite, fixture, page, CLOUDFLARE } from './fakeSite';

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe('rutor', () => {
  it('is a built-in source without login', () => {
    expect(rutor.id).toBe('rutor');
    expect(rutor.name).toBe('rutor');
    expect(rutor.kind).toBe('builtin');
    expect(rutor.needsLogin).toBeFalsy();
  });

  it('searches and parses the list page with magnets', async () => {
    const site = fakeSite((c) => page(fixture('rutor-search.html'), c.url));
    const list = await rutor.search('матрица 1999/2', site.ctx);
    expect(site.calls.map((c) => c.method + ' ' + c.url)).toEqual([
      'GET https://rutor.info/search/0/0/000/0/%D0%BC%D0%B0%D1%82%D1%80%D0%B8%D1%86%D0%B0%201999%2F2',
    ]);
    expect(list).toHaveLength(4);
    const a = list[0];
    expect(a.source).toBe('rutor');
    expect(a.Tracker).toBe('rutor');
    expect(a.Title).toBe('The Doors - Live at the Matrix 1967 (2008) FLAC');
    expect(a.detailUrl).toBe('https://rutor.info/torrent/1107709/the-doors-live-at-the-matrix-1967-2008-flac');
    expect(a.Link).toBe(a.detailUrl);
    expect(a.Magnet).toBe(
      'magnet:?xt=urn:btih:27dfbb4d9b7442cee9367cf9a60e92036f666331&dn=rutor.info&tr=udp://opentor.net:6969&tr=http://retracker.local/announce',
    );
    expect(a.hash).toBe('27dfbb4d9b7442cee9367cf9a60e92036f666331');
    expect(a.Hash).toBe(a.hash);
    expect(a.Size).toBe('694.43 MB');
    expect(a.sizeBytes).toBe(Math.round(694.43 * MB));
    expect(a.Seed).toBe(11);
    expect(a.Peer).toBe(0);
    expect(a.date).toBe(new Date(2026, 8, 26).getTime());
    expect(a.CreateDate).toBe(new Date(2026, 8, 26).toISOString());
    // a row with a comments column
    const c = list[2];
    expect(c.Title).toBe(
      'Матрица. Квадрология / The Matrix. Quadrology / 1999-2021 / UHD BDRemux 2160p | 4K | HDR | Dolby Vision Profile 8 | D',
    );
    expect(c.sizeBytes).toBe(Math.round(265.94 * GB));
    expect(c.Seed).toBe(7);
    expect(c.Peer).toBe(12);
    expect(list[3].date).toBe(new Date(2026, 4, 16).getTime());
  });

  it('returns nothing for an empty result page', async () => {
    const empty =
      '<html><body><div id="index">Результатов поиска 0 (max. 2000)<table><tr class="backgr"><td>Добавлен</td></tr></table></div></body></html>';
    const site = fakeSite((c) => page(empty, c.url));
    expect(await rutor.search('zzz', site.ctx)).toEqual([]);
  });

  it('reports a page it cannot read, an HTTP error and a Cloudflare check', async () => {
    const broken = fakeSite((c) => page('<html><body>Сайт на обслуживании</body></html>', c.url));
    await expect(rutor.search('x', broken.ctx)).rejects.toThrow('Не удалось разобрать страницу сайта');
    await expect(rutor.search('x', fakeSite((c) => page('oops', c.url, 502)).ctx)).rejects.toThrow('Сайт ответил ошибкой 502');
    await expect(rutor.search('x', fakeSite((c) => page(CLOUDFLARE, c.url, 403)).ctx)).rejects.toThrow(
      'Сайт закрыт проверкой браузера (Cloudflare), попробуйте позже',
    );
  });
});

import { describe, it, expect } from 'vitest';
import { torrentby } from '../../src/sources/torrentby';
import { fakeSite, fixture, page, CLOUDFLARE } from './fakeSite';

const GB = 1024 * 1024 * 1024;

function day(offset: number): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset).getTime();
}

describe('torrentby', () => {
  it('is a built-in source without login', () => {
    expect(torrentby.id).toBe('torrentby');
    expect(torrentby.name).toBe('torrent.by');
    expect(torrentby.kind).toBe('builtin');
    expect(torrentby.needsLogin).toBeFalsy();
  });

  it('searches and parses the list page with magnets', async () => {
    const site = fakeSite((c) => page(fixture('torrentby-search.html'), c.url));
    const list = await torrentby.search('невский', site.ctx);
    expect(site.calls.map((c) => c.method + ' ' + c.url)).toEqual([
      'GET https://torrent.by/search/?search=%D0%BD%D0%B5%D0%B2%D1%81%D0%BA%D0%B8%D0%B9',
    ]);
    expect(list).toHaveLength(4);
    const a = list[0];
    expect(a.source).toBe('torrentby');
    expect(a.Tracker).toBe('torrent.by');
    expect(a.Title).toBe('Невский: Наследство архитектора [08x01-10 из 30] (2025) WEB-DLRip-AVC от ExKinoRay');
    expect(a.detailUrl).toBe('https://torrent.by/217206/Nevskiy-Nasledstvo-arhitektora-08x01-10-iz-30-2025-WEB-DLRip-AVC-ot-ExKinoRay');
    expect(a.Magnet.indexOf('magnet:?xt=urn:btih:efaae18766f1e31febe472ca94009579e80360eb&')).toBe(0);
    expect(a.hash).toBe('efaae18766f1e31febe472ca94009579e80360eb');
    expect(a.Size).toBe('7.27 GB');
    expect(a.sizeBytes).toBe(Math.round(7.27 * GB));
    expect(a.Seed).toBe(0);
    expect(a.Peer).toBe(0);
    // «Сегодня» / «Вчера» / 2026-10-01
    expect(a.date).toBe(day(0));
    expect(list[1].date).toBe(day(-1));
    expect(list[3].date).toBe(new Date(2026, 9, 1).getTime());
    expect(list[2].Title).toBe('Невский/ Сезон: 8 / Серии: 1-10 из 30 [2026, детектив, WEBRip-AVC] от Aleksan55');
    expect(list[2].Peer).toBe(2);
    expect(list[2].sizeBytes).toBe(Math.round(7.25 * GB));
  });

  it('returns nothing for «Ничего не найдено», reports a page it cannot read and errors', async () => {
    const empty =
      '<html><body><form method="get" action="/search/"><input type="text" name="search" id="text-to-find" value="zzz" /></form>Ничего не найдено.</body></html>';
    expect(await torrentby.search('zzz', fakeSite((c) => page(empty, c.url)).ctx)).toEqual([]);
    await expect(torrentby.search('x', fakeSite((c) => page('<html><body>Техработы</body></html>', c.url)).ctx)).rejects.toThrow(
      'Не удалось разобрать страницу сайта',
    );
    await expect(torrentby.search('x', fakeSite((c) => page('oops', c.url, 503)).ctx)).rejects.toThrow('Сайт ответил ошибкой 503');
    await expect(torrentby.search('x', fakeSite((c) => page(CLOUDFLARE, c.url, 403)).ctx)).rejects.toThrow(
      'Сайт закрыт проверкой браузера (Cloudflare), попробуйте позже',
    );
  });
});

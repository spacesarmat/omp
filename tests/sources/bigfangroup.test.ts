import { describe, it, expect } from 'vitest';
import { bigfangroup } from '../../src/sources/bigfangroup';
import { fakeSite, fixture, page, CLOUDFLARE } from './fakeSite';

const GB = 1024 * 1024 * 1024;

describe('bigfangroup', () => {
  it('is a built-in source without login', () => {
    expect(bigfangroup.id).toBe('bigfangroup');
    expect(bigfangroup.name).toBe('BigFANGroup');
    expect(bigfangroup.kind).toBe('builtin');
    expect(bigfangroup.needsLogin).toBeFalsy();
  });

  it('searches with a windows-1251 query and parses the list with .torrent links', async () => {
    const site = fakeSite((c) => page(fixture('bigfangroup-search.html'), c.url));
    const list = await bigfangroup.search('матрица', site.ctx);
    // the site ignores a UTF-8 query (checked live), so the query goes in windows-1251
    expect(site.calls.map((c) => c.method + ' ' + c.url)).toEqual(['GET https://www.bigfangroup.org/browse.php?search=%EC%E0%F2%F0%E8%F6%E0']);
    // the made-up «Эротика» row is left out
    expect(list.map((r) => r.Title)).toEqual([
      'Матрица: Воскрешение / The Matrix Resurrections (2021) HDRip | Кинопоиск HD',
      'Матрица: Воскрешение / The Matrix Resurrections (2021) BDRip 720p',
      'Матрица: Воскрешение / The Matrix Resurrections (2021) WEB-DLRip-AVC | Jaskier',
    ]);
    const a = list[1];
    expect(a.source).toBe('bigfangroup');
    expect(a.Tracker).toBe('BigFANGroup');
    expect(a.detailUrl).toBe('https://www.bigfangroup.org/details.php?id=382043');
    // the .torrent downloads without a login; TorrServer adds the http(s) link itself
    expect(a.Link).toBe('https://www.bigfangroup.org/download.php?id=382043');
    expect(a.Magnet).toBe('');
    expect(a.hash).toBeUndefined();
    expect(a.Categories).toBe('Фантастика');
    expect(a.Size).toBe('7.46 GB');
    expect(a.sizeBytes).toBe(Math.round(7.46 * GB));
    expect(a.Seed).toBe(443);
    expect(a.Peer).toBe(297);
    expect(a.date).toBe(new Date(2022, 1, 20, 6, 19).getTime());
    expect(list[2].date).toBe(new Date(2021, 11, 25, 6, 56).getTime());
    expect(list[2].Seed).toBe(5);
    expect(list[2].Peer).toBe(43);
  });

  it('returns nothing for «Ничего не найдено», reports a page it cannot read and errors', async () => {
    const empty =
      '<html><body><table><tr><td><div class="error"><b>Ошибка</b><br />Ничего не найдено. <a href="javascript: history.go(-1)">Назад</a></div></td></tr></table></body></html>';
    expect(await bigfangroup.search('zzz', fakeSite((c) => page(empty, c.url)).ctx)).toEqual([]);
    await expect(bigfangroup.search('x', fakeSite((c) => page('<html><body>Техработы</body></html>', c.url)).ctx)).rejects.toThrow(
      'Не удалось разобрать страницу сайта',
    );
    await expect(bigfangroup.search('x', fakeSite((c) => page('oops', c.url, 502)).ctx)).rejects.toThrow('Сайт ответил ошибкой 502');
    await expect(bigfangroup.search('x', fakeSite((c) => page(CLOUDFLARE, c.url, 403)).ctx)).rejects.toThrow(
      'Сайт закрыт проверкой браузера (Cloudflare), попробуйте позже',
    );
  });

  it('magnet() gives the .torrent link of a release page without a request', async () => {
    const site = fakeSite((c) => page('', c.url, 404));
    expect(await bigfangroup.magnet!('https://www.bigfangroup.org/details.php?id=382043', site.ctx)).toBe(
      'https://www.bigfangroup.org/download.php?id=382043',
    );
    expect(await bigfangroup.magnet!('http://bigfangroup.org/details.php?id=7&hit=1', site.ctx)).toBe('https://www.bigfangroup.org/download.php?id=7');
    expect(site.calls).toHaveLength(0);
    await expect(bigfangroup.magnet!('https://evil.example/details.php?id=1', site.ctx)).rejects.toThrow('Неверный адрес');
    await expect(bigfangroup.magnet!('https://www.bigfangroup.org/browse.php', site.ctx)).rejects.toThrow('На странице раздачи нет ссылки на торрент');
  });
});

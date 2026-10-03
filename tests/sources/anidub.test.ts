import { describe, it, expect } from 'vitest';
import { anidub } from '../../src/sources/anidub';
import { fakeSite, fixture, page } from './fakeSite';
import type { HttpCall } from './fakeSite';

const MB = 1024 * 1024;
const GB = 1024 * MB;
const SEARCH = 'https://tr.anidub.com/index.php?do=search&subaction=search&story=';
const ROAD = 'https://tr.anidub.com/anime_movie/8696-naruto-put-nindzya-naruto-the-movie-road-to-ninja.html';

/** List page; only the «Путь ниндзя» release page is served, the other two fail. */
function site(other?: (c: HttpCall) => ReturnType<typeof page>) {
  return fakeSite((c) => {
    if (c.url.indexOf(SEARCH) === 0) return page(fixture('anidub-search.html'), c.url);
    if (c.url === ROAD) return page(fixture('anidub-detail.html'), c.url);
    return other ? other(c) : page('Not found', c.url, 404);
  });
}

describe('anidub', () => {
  it('is a built-in source without login', () => {
    expect(anidub.id).toBe('anidub');
    expect(anidub.name).toBe('Anidub');
    expect(anidub.kind).toBe('builtin');
    expect(anidub.needsLogin).toBeFalsy();
  });

  it('searches, opens the release pages and returns one result per .torrent link', async () => {
    const s = site();
    const list = await anidub.search('наруто', s.ctx);
    expect(s.calls[0].url).toBe(SEARCH + '%D0%BD%D0%B0%D1%80%D1%83%D1%82%D0%BE');
    expect(s.calls).toHaveLength(4);
    // the two failed release pages are skipped
    expect(list.map((r) => r.Title)).toEqual([
      'Наруто: Путь ниндзя / Naruto the Movie: Road to Ninja [PSP]',
      'Наруто: Путь ниндзя / Naruto the Movie: Road to Ninja [HWP]',
      'Наруто: Путь ниндзя / Naruto the Movie: Road to Ninja [HWP]',
      'Наруто: Путь ниндзя / Naruto the Movie: Road to Ninja [BD (720p)]',
    ]);
    const bd = list[3];
    expect(bd.source).toBe('anidub');
    expect(bd.Tracker).toBe('Anidub');
    // TorrServer adds an http(s) .torrent link itself: it goes to Link, there is no magnet and no hash
    expect(bd.Link).toBe('https://tr.anidub.com/engine/download.php?id=671');
    expect(bd.Magnet).toBe('');
    expect(bd.Hash).toBe('');
    expect(bd.hash).toBeUndefined();
    expect(bd.detailUrl).toBe(ROAD + '#torrent_671_info');
    expect(bd.Categories).toBe('Аниме Фильмы');
    expect(bd.Size).toBe('2.36 GB');
    expect(bd.sizeBytes).toBe(Math.round(2.36 * GB));
    expect(bd.Seed).toBe(12);
    expect(bd.Peer).toBe(3);
    expect(bd.date).toBeUndefined();
    expect(list[0].Link).toBe('https://tr.anidub.com/engine/download.php?id=673');
    expect(list[0].sizeBytes).toBe(Math.round(449.92 * MB));
  });

  it('fails when every release page fails, returns nothing when nothing is found', async () => {
    const broken = fakeSite((c) => (c.url.indexOf(SEARCH) === 0 ? page(fixture('anidub-search.html'), c.url) : page('x', c.url, 503)));
    await expect(anidub.search('наруто', broken.ctx)).rejects.toThrow('Сайт ответил ошибкой 503');
    const empty =
      '<html><body><form><input name="story" value="zzz"></form><div class="search_info">К сожалению, поиск по сайту не дал никаких результатов.</div></body></html>';
    const none = fakeSite((c) => page(empty, c.url));
    expect(await anidub.search('zzz', none.ctx)).toEqual([]);
    expect(none.calls).toHaveLength(1);
    await expect(anidub.search('x', fakeSite((c) => page('<html><body>Техработы</body></html>', c.url)).ctx)).rejects.toThrow(
      'Не удалось разобрать страницу сайта',
    );
  });

  it('magnet() gives the .torrent link of the chosen torrent, or the first one of a release page', async () => {
    const s = site();
    expect(await anidub.magnet!(ROAD + '#torrent_8944_info', s.ctx)).toBe('https://tr.anidub.com/engine/download.php?id=8944');
    expect(s.calls).toHaveLength(0);
    expect(await anidub.magnet!(ROAD, s.ctx)).toBe('https://tr.anidub.com/engine/download.php?id=673');
    await expect(anidub.magnet!('https://evil.example/x.html#torrent_1_info', s.ctx)).rejects.toThrow('Неверный адрес');
    const bare = fakeSite((c) => page('<html><body><h1>Нет торрентов</h1></body></html>', c.url));
    await expect(anidub.magnet!(ROAD, bare.ctx)).rejects.toThrow('На странице раздачи нет ссылки на торрент');
  });
});

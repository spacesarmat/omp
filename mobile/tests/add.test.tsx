import { TV_NO_OMP } from '../src/tv/tvClient';
import { describe, it, expect, beforeEach, afterEach, onTestFinished, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Add, normalizeLink } from '../src/screens/Add';
import { setWatchActions } from '../src/watch';
import { currentRoute, resetTo } from '../src/nav';
import { reloadTvs, saveTv } from '../src/tv/tvStore';
import { toast } from '../src/ui/toast';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { TorrServerClient } from '../../src/api/torrserver';
import { torrents } from '../../src/store/library';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { reloadSourcePrefs, resetHealth, setSourceOn } from '../../src/sources/store';
import type { Source, SourceResult } from '../../src/sources/types';

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

const HASH = 'a'.repeat(40);
const results = [
  { Title: 'Starbound Frontier S02', Categories: '', Size: '18 GB', CreateDate: '', Tracker: 'rutor', Link: '', Magnet: 'magnet:?xt=urn:btih:' + HASH, Hash: HASH, Peer: 3, Seed: 152 },
  { Title: 'Starbound Frontier S01', Categories: '', Size: '17 GB', CreateDate: '', Tracker: 'rutor', Link: '', Magnet: '', Hash: 'b'.repeat(40), Peer: 1, Seed: 88 },
];

let el: HTMLElement;
const launch = vi.fn();

function mount(link?: string) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<Add link={link} />, el));
}

function type(sel: string, v: string) {
  const i = el.querySelector(sel) as HTMLInputElement;
  act(() => {
    i.value = v;
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const byLabel = (l: string) => Array.from(el.querySelectorAll('button')).filter((b) => b.getAttribute('aria-label') === l);
const byText = (t: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent === t)!;
const click = (n: Element) => act(() => (n as HTMLElement).click());
const search = (q: string) => {
  type('input[aria-label="Поиск по источникам"]', q);
  act(() => {
    el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
};

beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
  resetHealth();
  reloadTvs();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  toast.value = '';
  launch.mockReset().mockResolvedValue(undefined);
  setWatchActions({ ompVersion: async () => null, reportUrl: async () => null, launchOnTv: launch, remoteDelayMs: 0 });
  resetTo({ name: 'add' });
  torrents.value = [];
  // background work after an add: list refresh and poster lookup (no TMDB key by default)
  vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
});

afterEach(() => {
  if (el) act(() => render(null, el));
  unregisterSource('fake');
  unregisterSource('fake2');
  vi.restoreAllMocks();
  setWatchActions(null);
});

describe('normalizeLink', () => {
  it('accepts magnet and bare hash only', () => {
    expect(normalizeLink(' magnet:?xt=urn:btih:abc ')).toBe('magnet:?xt=urn:btih:abc');
    expect(normalizeLink(HASH)).toBe('magnet:?xt=urn:btih:' + HASH);
    expect(normalizeLink('hello')).toBeNull();
  });
});

describe('Add', () => {
  it('prefills the incoming link and adds it, then opens the torrent', async () => {
    const add = vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    mount('magnet:?xt=urn:btih:' + HASH);
    expect((el.querySelector('input') as HTMLInputElement).value).toBe('magnet:?xt=urn:btih:' + HASH);
    click(byText('Добавить'));
    await flush();
    expect(add).toHaveBeenCalledWith({ link: 'magnet:?xt=urn:btih:' + HASH, category: '' });
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: HASH });
    expect(toast.value).toBe('Добавлено');
  });

  it('rejects garbage input', async () => {
    const add = vi.spyOn(TorrServerClient.prototype, 'add');
    mount();
    type('input', 'nope');
    click(byText('Добавить'));
    await flush();
    expect(add).not.toHaveBeenCalled();
    expect(el.querySelector('.m-error')).toBeTruthy();
  });

  it('searches every switched-on source and merges the duplicates', async () => {
    const s = vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue(results);
    mount();
    expect(byText('Все источники · 2')).toBeTruthy();
    search('starbound');
    await flush();
    expect(s).toHaveBeenCalledWith('starbound', 'rutor');
    expect(s).toHaveBeenCalledWith('starbound', 'torznab');
    const rows = el.querySelectorAll('.m-result');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('152 сид.');
    expect(rows[0].querySelector('.m-src-badge')!.textContent).toBe('rutor (TorrServer)');
    expect(rows[0].textContent).toContain('ещё в Torznab');
    expect(el.querySelector('[data-search-progress]')!.textContent).toBe('Найдено 2 · 2 из 2 источников ответили');
  });

  it('«Добавить и смотреть на ТВ» adds then launches', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue(results);
    const add = vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    mount();
    search('starbound');
    await flush();
    click(byLabel('Добавить и смотреть на ТВ')[0]);
    await flush();
    expect(add).toHaveBeenCalledWith({ link: 'magnet:?xt=urn:btih:' + HASH, category: 'tv' });
    expect(launch).toHaveBeenCalledWith({ server: 'http://srv:8090', torrent: HASH });
    expect(toast.value).toBe('Запустил на LG OLED');
  });

  it('plain «Добавить на сервер» does not launch', async () => {
    vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue(results);
    vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    mount();
    search('x');
    await flush();
    click(byLabel('Добавить на сервер')[0]);
    await flush();
    expect(launch).not.toHaveBeenCalled();
    expect(toast.value).toBe('Добавлено на сервер');
  });

  it('double tap on a row adds and launches once', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue(results);
    let resolveAdd: (v: any) => void = () => {};
    const add = vi.spyOn(TorrServerClient.prototype, 'add').mockImplementation(() => new Promise((r) => (resolveAdd = r)));
    mount();
    search('x');
    await flush();
    const b = byLabel('Добавить и смотреть на ТВ')[0];
    click(b);
    click(b);
    expect((b as HTMLButtonElement).disabled).toBe(true);
    await flush(); // the link is resolved first
    resolveAdd({ hash: HASH });
    await flush();
    expect(add).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledTimes(1);
    expect((b as HTMLButtonElement).disabled).toBe(false);
  });

  it('a result with only a .torrent link (Anidub) is added by that link', async () => {
    const torrentUrl = 'https://tr.anidub.com/engine/download.php?id=671';
    const row = { Title: 'Аниме [BD (720p)]', Categories: '', Size: '2.36 GB', CreateDate: '', Tracker: 'Anidub', Link: torrentUrl, Magnet: '', Hash: '', Peer: 3, Seed: 12 };
    vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue([row]);
    const add = vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    mount();
    search('x');
    await flush();
    click(byLabel('Добавить на сервер')[0]);
    await flush();
    expect(add).toHaveBeenCalledWith({ link: torrentUrl, category: expect.any(String) });
    expect(toast.value).toBe('Добавлено на сервер');
  });

  it('add errors from a row show under the search', async () => {
    vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue(results);
    vi.spyOn(TorrServerClient.prototype, 'add').mockRejectedValue(new Error('сервер упал'));
    mount();
    search('x');
    await flush();
    click(byLabel('Добавить на сервер')[0]);
    await flush();
    expect(el.querySelector('.m-error')!.textContent).toContain('сервер упал');
  });

  it('a new search drops the answers of the previous one', async () => {
    setSourceOn('ts-torznab', false);
    const resolvers: Array<(v: any) => void> = [];
    vi.spyOn(TorrServerClient.prototype, 'search').mockImplementation(() => new Promise((r) => resolvers.push(r)));
    mount();
    search('first');
    search('second');
    resolvers[1]([results[1]]);
    await flush();
    resolvers[0]([results[0]]);
    await flush();
    const rows = el.querySelectorAll('.m-result');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('S01');
  });

  it('does not jump to the remote after unmount', async () => {
    vi.useFakeTimers();
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    setWatchActions({ ompVersion: async () => null, reportUrl: async () => null, launchOnTv: launch, remoteDelayMs: 1000 });
    vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue(results);
    vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    mount();
    search('x');
    await flush();
    click(byLabel('Добавить и смотреть на ТВ')[0]);
    await flush();
    act(() => render(null, el));
    await vi.advanceTimersByTimeAsync(2000);
    expect(currentRoute.value.name).toBe('add');
    vi.useRealTimers();
  });

  it('«Добавить и смотреть на ТВ» with no OMP offers the install guide', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    setWatchActions({ ompVersion: async () => null, reportUrl: async () => null, launchOnTv: vi.fn().mockRejectedValue(new Error(TV_NO_OMP)), remoteDelayMs: 0 });
    vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue(results);
    vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    mount();
    search('x');
    await flush();
    click(byLabel('Добавить и смотреть на ТВ')[0]);
    await flush();
    expect(el.textContent).toContain('Как установить OMP на телевизор');
  });
});

describe('Add: the new torrent and its poster', () => {
  const M = 'magnet:?xt=urn:btih:' + HASH;
  it('the added torrent is in the list at once, so its page opens', async () => {
    vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH, title: '', stat: 1 } as any);
    mount(M);
    click(byText('Добавить'));
    await flush();
    expect(torrents.value.map((t) => t.hash)).toEqual([HASH]);
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: HASH });
  });

  it('looks up a poster by the magnet name with the server TMDB key and stores it', async () => {
    vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH, title: '', stat: 1 } as any);
    vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue({ APIKey: 'k' });
    vi.spyOn(TorrServerClient.prototype, 'get').mockResolvedValue({ hash: HASH, title: '', category: 'movie', stat: 1 } as any);
    const setPoster = vi.spyOn(TorrServerClient.prototype, 'setPoster').mockResolvedValue(undefined);
    vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([{ hash: HASH, title: 'Dune', poster: 'https://imagetmdb.com/t/p/w300/d.jpg', stat: 1 }]);
    const tmdb = vi.fn(async () => new Response(JSON.stringify({ results: [{ poster_path: '/d.jpg' }] })));
    vi.stubGlobal('fetch', tmdb);
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    mount(M + '&dn=Dune+(2021)+1080p');
    click(byText('Добавить'));
    await flush();
    await flush();
    expect(String((tmdb.mock.calls[0] as unknown[])[0])).toContain('query=Dune');
    expect(setPoster).toHaveBeenCalledWith(expect.objectContaining({ hash: HASH }), 'https://imagetmdb.com/t/p/w300/d.jpg');
    expect(torrents.value[0].poster).toBe('https://imagetmdb.com/t/p/w300/d.jpg');
  });
});

describe('Add category', () => {
  const M = 'magnet:?xt=urn:btih:' + HASH;
  it('guesses from the magnet dn and sends it', async () => {
    const add = vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    mount(M + '&dn=Band+-+Discography+FLAC');
    click(byText('Добавить'));
    await flush();
    expect(add).toHaveBeenCalledWith({ link: M + '&dn=Band+-+Discography+FLAC', category: 'music' });
  });

  it('a user pick is not overwritten by a later guess', async () => {
    const add = vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    mount();
    click(byText('Прочее'));
    type('input', M + '&dn=Show+S01E02');
    click(byText('Добавить'));
    await flush();
    expect(add).toHaveBeenCalledWith({ link: M + '&dn=Show+S01E02', category: 'other' });
  });

  it('a pick is forgotten when the link is replaced by a different one', async () => {
    const add = vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    mount();
    type('input', M + '&dn=Show+S01E02');
    click(byText('Прочее'));
    type('input', 'magnet:?xt=urn:btih:' + 'b'.repeat(40) + '&dn=Show+S01E03');
    click(byText('Добавить'));
    await flush();
    expect(add.mock.calls[0][0].category).toBe('tv');
  });

  it('search result category can be changed through the sheet', async () => {
    vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue(results);
    const add = vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    mount();
    search('x');
    await flush();
    expect(byLabel('Категория: Сериалы').length).toBe(2);
    click(byLabel('Категория: Сериалы')[0]);
    click(el.querySelector('.m-sheet')!.querySelectorAll('button')[3]);
    expect(byLabel('Категория: Музыка').length).toBe(1);
    click(byLabel('Добавить на сервер')[0]);
    await flush();
    expect(add).toHaveBeenCalledWith({ link: M, category: 'music' });
  });
});

describe('Add TV launch with report', () => {
  it('«Добавить и смотреть на ТВ» sends the report url and no file', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    setWatchActions({ ompVersion: async () => '0.8.0', reportUrl: async () => 'http://192.168.1.9:8123/p', launchOnTv: launch, remoteDelayMs: 0 });
    vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue(results);
    vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    mount();
    search('x');
    await flush();
    click(byLabel('Добавить и смотреть на ТВ')[0]);
    await flush();
    expect(launch).toHaveBeenCalledWith({ server: 'http://srv:8090', torrent: HASH, report: 'http://192.168.1.9:8123/p' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    // no file: nothing plays yet, land on the remote as in v0.7
    expect(currentRoute.value.name).toBe('remote');
  });
});

describe('Add unified search', () => {
  const MAG = 'magnet:?xt=urn:btih:' + 'c'.repeat(40);
  function row(p: Partial<SourceResult>): SourceResult {
    return { Title: 'Северный ветер 1080p', Categories: '', Size: '18 GB', CreateDate: '', Tracker: 'F', Link: '', Magnet: '', Hash: '', Peer: 0, Seed: 10, source: 'fake', ...p };
  }
  function fake(id: string, list: SourceResult[], magnet?: Source['magnet']): Source {
    return { id, name: id === 'fake' ? 'Фейк' : 'Фейк-2', kind: 'builtin', search: () => Promise.resolve(list), magnet };
  }
  const sheetButtons = () => Array.from(el.querySelectorAll('.m-sheet button')) as HTMLButtonElement[];

  beforeEach(() => {
    setSourceOn('ts-rutor', false);
    setSourceOn('ts-torznab', false);
  });

  it('takes the magnet from the release page, showing «Получаю ссылку…»', async () => {
    let give: (v: string) => void = () => {};
    const magnet = vi.fn(() => new Promise<string>((r) => (give = r)));
    registerSource(fake('fake', [row({ detailUrl: 'https://f.example/t=1', Link: 'https://f.example/t=1' })], magnet));
    const add = vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    mount();
    search('ветер');
    await flush();
    click(byLabel('Добавить на сервер')[0]);
    await flush();
    expect(el.textContent).toContain('Получаю ссылку…');
    expect(magnet).toHaveBeenCalledWith('https://f.example/t=1', expect.anything());
    expect(add).not.toHaveBeenCalled();
    give(MAG);
    await flush();
    expect(add).toHaveBeenCalledWith({ link: MAG, category: expect.any(String) });
    expect(el.textContent).not.toContain('Получаю ссылку…');
    expect(toast.value).toBe('Добавлено на сервер');
  });

  it('a .torrent link from the source is added as is', async () => {
    registerSource(fake('fake', [row({ detailUrl: 'https://f.example/7' })], () => Promise.resolve('https://f.example/download.php?id=7')));
    const add = vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    mount();
    search('ветер');
    await flush();
    click(byLabel('Добавить на сервер')[0]);
    await flush();
    expect(add).toHaveBeenCalledWith({ link: 'https://f.example/download.php?id=7', category: expect.any(String) });
  });

  it('a failed link lookup shows the error in Russian', async () => {
    registerSource(fake('fake', [row({ detailUrl: 'https://f.example/7' })], () => Promise.reject(new Error('На странице раздачи нет magnet-ссылки'))));
    const add = vi.spyOn(TorrServerClient.prototype, 'add');
    mount();
    search('ветер');
    await flush();
    click(byLabel('Добавить на сервер')[0]);
    await flush();
    expect(add).not.toHaveBeenCalled();
    expect(el.querySelector('.m-error')!.textContent).toContain('На странице раздачи нет magnet-ссылки');
    expect((byLabel('Добавить на сервер')[0] as HTMLButtonElement).disabled).toBe(false);
  });

  it('two torrents with one title are separate rows', async () => {
    let give: (v: string) => void = () => {};
    registerSource(
      fake(
        'fake',
        [
          row({ Title: 'Аниме [HWP]', Size: '1 GB', detailUrl: 'https://f.example/x#torrent_1_info' }),
          row({ Title: 'Аниме [HWP]', Size: '3 GB', detailUrl: 'https://f.example/x#torrent_2_info' }),
        ],
        () => new Promise<string>((r) => (give = r)),
      ),
    );
    vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    mount();
    search('аниме');
    await flush();
    expect(el.querySelectorAll('.m-result').length).toBe(2);
    click(byLabel('Добавить на сервер')[0]);
    await flush();
    const buttons = byLabel('Добавить на сервер') as HTMLButtonElement[];
    expect(buttons.map((b) => b.disabled)).toEqual([true, false]);
    give('https://f.example/dl?id=1');
    await flush();
  });

  it('results stream in with the progress line', async () => {
    let late: (v: SourceResult[]) => void = () => {};
    registerSource(fake('fake', [row({ Title: 'A 1080p', detailUrl: 'https://f.example/a' })]));
    registerSource({ id: 'fake2', name: 'Фейк-2', kind: 'builtin', search: () => new Promise((r) => (late = r)) });
    mount();
    search('ветер');
    await flush();
    expect(el.querySelectorAll('.m-result').length).toBe(1);
    expect(el.querySelector('[data-search-progress]')!.textContent).toBe('Найдено 1 · 1 из 2 источников ответил · ещё ищу в Фейк-2…');
    late([row({ source: 'fake2', Title: 'B 720p', Size: '1 GB', detailUrl: 'https://g.example/b' })]);
    await flush();
    expect(el.querySelectorAll('.m-result').length).toBe(2);
    expect(el.querySelector('[data-search-progress]')!.textContent).toBe('Найдено 2 · 2 из 2 источников ответили');
  });

  it('quality chips and sorting', async () => {
    registerSource(
      fake('fake', [
        row({ Title: 'Small 2160p', Size: '1 GB', Seed: 99, detailUrl: 'https://f.example/1' }),
        row({ Title: 'Big 1080p', Size: '30 GB', Seed: 5, detailUrl: 'https://f.example/2' }),
        row({ Title: 'Old 720p', Size: '2 GB', Seed: 50, detailUrl: 'https://f.example/3' }),
      ]),
    );
    mount();
    search('x');
    await flush();
    const titles = () => Array.from(el.querySelectorAll('.m-result-title')).map((n) => n.textContent);
    expect(titles()).toEqual(['Small 2160p', 'Old 720p', 'Big 1080p']);
    click(byText('1080p+'));
    expect(titles()).toEqual(['Small 2160p', 'Big 1080p']);
    click(byText('2160p'));
    expect(titles()).toEqual(['Small 2160p']);
    click(byText('2160p'));
    click(byText('По сидам ▾'));
    click(sheetButtons().filter((b) => b.textContent === 'По размеру')[0]);
    expect(titles()).toEqual(['Big 1080p', 'Old 720p', 'Small 2160p']);
    expect(byText('По размеру ▾')).toBeTruthy();
  });

  it('the sources sheet picks the sources of this search', async () => {
    const one = vi.fn(() => Promise.resolve([row({ detailUrl: 'https://f.example/1' })]));
    const two = vi.fn(() => Promise.resolve([] as SourceResult[]));
    registerSource({ id: 'fake', name: 'Фейк', kind: 'builtin', search: one });
    registerSource({ id: 'fake2', name: 'Фейк-2', kind: 'builtin', search: two });
    mount();
    click(byText('Все источники · 2'));
    const items = sheetButtons().filter((b) => b.getAttribute('role') === 'checkbox');
    expect(items.map((b) => b.textContent)).toEqual(['rutor (TorrServer)', 'Torznab', 'Фейк', 'Фейк-2']);
    expect(items.map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true', 'true']);
    click(items[3]);
    expect(byText('Источники · 1')).toBeTruthy();
    search('x');
    await flush();
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).not.toHaveBeenCalled();
  });
});

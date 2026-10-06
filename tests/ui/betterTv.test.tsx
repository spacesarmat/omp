import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init, getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation';

vi.mock('../../src/monitor/replace', async (orig) => {
  const actual = await orig<typeof import('../../src/monitor/replace')>();
  return { ...actual, replaceWithResult: vi.fn() };
});
vi.mock('../../src/monitor/upgrade', async (orig) => {
  const actual = await orig<typeof import('../../src/monitor/upgrade')>();
  return { ...actual, findUpgrades: vi.fn(actual.findUpgrades), carryProgress: vi.fn(actual.carryProgress) };
});

import { TorrentScreen } from '../../src/screens/Torrent';
import { SeriesScreen } from '../../src/screens/Series';
import { DialogHost } from '../../src/ui/dialog';
import { ToastHost } from '../../src/ui/toast';
import { dispatchKey } from '../../src/ui/keys';
import { currentRoute, routeStack } from '../../src/ui/nav';
import { servers, addServer, setActiveServer, removeServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { TorrServerClient } from '../../src/api/torrserver';
import { setCatalogProvider } from '../../src/catalog/activeCatalog';
import { replaceWithResult } from '../../src/monitor/replace';
import { findUpgrades, carryProgress } from '../../src/monitor/upgrade';
import { seriesKey } from '../../src/lib/seriesGroups';
import type { SearchResult, Torrent } from '../../src/api/types';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const H = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const film: Torrent = {
  hash: H,
  title: 'Дюна: Часть вторая / Dune: Part Two (2024) WEB-DL 1080p',
  category: 'movie',
  stat: 3,
  torrent_size: 8.9e9,
  file_stats: [{ id: 1, path: 'Dune.Part.Two.2024.1080p.WEB-DL.mkv', length: 8.9e9 }],
};
const res = (title: string, seed: number, hash: string): SearchResult => ({
  Title: title,
  Categories: 'Movies',
  Size: '20 GB',
  CreateDate: '',
  Tracker: 'rutor',
  Link: '',
  Magnet: 'magnet:?xt=urn:btih:' + hash,
  Hash: hash,
  Peer: 0,
  Seed: seed,
});
const found = [
  res('Дюна: Часть вторая / Dune: Part Two (2024) BDRip 1080p', 31, 'c'.repeat(40)),
  res('Дюна: Часть вторая / Dune: Part Two (2024) UHD BDRemux 2160p HDR', 42, 'd'.repeat(40)),
  res('Дюна: Часть вторая / Dune: Part Two (2024) WEB-DL 2160p', 18, 'e'.repeat(40)),
];

const flush = () => act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
let host: HTMLElement;
const all = (sel: string) => Array.prototype.slice.call(host.querySelectorAll(sel)) as HTMLElement[];
const btn = (label: string) => all('.button, .dialog-option').filter((b) => (b.textContent || '').trim() === label)[0];
const click = (el: Element) => act(async () => { (el as HTMLElement).click(); });
const back = () => act(() => { dispatchKey('back', new KeyboardEvent('keydown')); });
const rows = () => all('.better-row');
let search: ReturnType<typeof vi.spyOn>;

function mount(screen: any) {
  act(() => render(h('div', {}, screen, h(DialogHost, {}), h(ToastHost, {})), host));
}

beforeEach(async () => {
  localStorage.clear();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  torrents.value = [film];
  vi.spyOn(TorrServerClient.prototype, 'get').mockImplementation((hash: string) =>
    Promise.resolve(torrents.value.filter((x) => x.hash === hash)[0] || film),
  );
  vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'loadInfo').mockImplementation((hash: string) =>
    Promise.resolve({ ...film, hash, file_stats: [{ id: 1, path: 'New.2160p.mkv', length: 2e10 }] }),
  );
  vi.spyOn(TorrServerClient.prototype, 'list').mockImplementation(() => Promise.resolve(torrents.value));
  search = vi.spyOn(TorrServerClient.prototype, 'search').mockImplementation((_q: string, src: string) =>
    Promise.resolve(src === 'rutor' ? found : []),
  );
  setCatalogProvider(() => Promise.reject(Object.assign(new Error('offline'), { code: 'offline' })));
  routeStack.value = [{ name: 'library' }, { name: 'torrent', hash: H }];
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  setCatalogProvider(null);
  vi.restoreAllMocks();
  vi.mocked(replaceWithResult).mockReset();
  vi.mocked(carryProgress).mockClear();
});

async function openOnTorrent() {
  mount(h(TorrentScreen, { hash: H }));
  await flush();
  await click(btn('Найти в лучшем качестве'));
  await flush();
  await tick();
}

describe('TV «В лучшем качестве»', () => {
  it('is not offered when the torrent is neither a film nor a series season', async () => {
    torrents.value = [{ ...film, title: 'Some Album FLAC', category: 'music' }];
    mount(h(TorrentScreen, { hash: H }));
    await flush();
    expect(btn('Найти в лучшем качестве')).toBeFalsy();
    expect(btn('Переименовать')).toBeTruthy();
  });

  it('searches the TorrServer sources and lists the better releases best first', async () => {
    await openOnTorrent();
    expect(host.querySelector('.better-dialog .dialog-title')!.textContent).toBe('В лучшем качестве');
    expect(host.querySelector('.better-current')!.textContent).toContain('1080p WEB-DL');
    expect(search).toHaveBeenCalled();
    expect((vi.mocked(findUpgrades).mock.calls[0][0] as any).client).toBeTruthy();
    const names = rows().map((r) => r.querySelector('.better-name')!.textContent);
    expect(names.length).toBe(3);
    // 2160p Remux > 2160p WEB-DL > 1080p BDRip
    expect(names[0]).toContain('BDRemux 2160p');
    expect(names[1]).toContain('WEB-DL 2160p');
    expect(names[2]).toContain('BDRip 1080p');
    expect(rows()[0].querySelector('.better-meta')!.textContent).toContain('20 GB');
    expect(rows()[0].className).toContain('focused');
    // the follow switch is shown, disabled, pointing to the phone
    expect(host.querySelector('.better-follow')!.textContent).toContain('в OMP на телефоне');
  });

  it('replaces the torrent and opens the new one', async () => {
    vi.mocked(replaceWithResult).mockResolvedValue({ ok: true, hash: NEW });
    const remove = vi.spyOn(TorrServerClient.prototype, 'remove').mockResolvedValue(undefined as any);
    await openOnTorrent();
    await click(rows()[0]);
    await flush();
    expect(host.querySelector('.dialog:not(.better-dialog) .dialog-title')!.textContent).toContain('1080p WEB-DL → 4K Remux');
    await click(btn('Заменить'));
    await flush();
    await tick();
    await flush();
    expect(replaceWithResult).toHaveBeenCalledTimes(1);
    const call = vi.mocked(replaceWithResult).mock.calls[0];
    expect(call[1]).toBe(H);
    expect(call[2].Title).toContain('BDRemux 2160p');
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: NEW });
    expect(host.querySelector('.better-dialog')).toBeNull();
    expect(remove).not.toHaveBeenCalled(); // removal is replaceWithResult's job
  });

  it('«Добавить рядом» adds the release and keeps the old torrent', async () => {
    const add = vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: NEW, title: 'Dune 2160p' } as Torrent);
    const remove = vi.spyOn(TorrServerClient.prototype, 'remove').mockResolvedValue(undefined as any);
    await openOnTorrent();
    await click(rows()[1]);
    await flush();
    await click(btn('Добавить рядом'));
    await flush();
    expect(add).toHaveBeenCalledTimes(1);
    expect((add.mock.calls[0][0] as any).link).toBe('magnet:?xt=urn:btih:' + 'e'.repeat(40));
    expect((add.mock.calls[0][0] as any).category).toBe('movie');
    expect(remove).not.toHaveBeenCalled();
    expect(replaceWithResult).not.toHaveBeenCalled();
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: H });
    expect(host.querySelector('.better-dialog')).toBeNull();
  });

  it('says so when nothing better is found, and shows why a replace failed', async () => {
    search.mockImplementation(() => Promise.resolve([]));
    await openOnTorrent();
    expect(host.querySelector('.better-empty')!.textContent).toContain('Лучше вашей раздачи ничего не нашлось');
    expect(btn('Искать все раздачи')).toBeTruthy();
    await back();
    search.mockImplementation((_q: string, src: string) => Promise.resolve(src === 'rutor' ? found : []));
    vi.mocked(replaceWithResult).mockResolvedValue({ ok: false, error: 'x', cause: 'timeout' });
    await click(btn('Найти в лучшем качестве'));
    await flush();
    await tick();
    await click(rows()[0]);
    await flush();
    await click(btn('Заменить'));
    await flush();
    expect(host.querySelector('.better-failure')!.textContent).toContain('TorrServer не дождался данных');
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: H });
  });

  it('Back stops the search and closes; during a replace Back stops the replace', async () => {
    const cancel = vi.fn();
    vi.mocked(findUpgrades).mockImplementationOnce(() => ({ done: new Promise(() => undefined), cancel }));
    await openOnTorrent();
    expect(host.querySelector('.better-wait')).toBeTruthy();
    await back();
    expect(cancel).toHaveBeenCalled();
    expect(host.querySelector('.better-dialog')).toBeNull();

    let aborted = false;
    vi.mocked(replaceWithResult).mockImplementation((_c, _h, _r, _ctx, o) =>
      new Promise((resolve) => o!.abort!.onAbort(() => {
        aborted = true;
        resolve({ ok: false, error: 'cancelled', cause: 'cancelled' });
      })),
    );
    await click(btn('Найти в лучшем качестве'));
    await flush();
    await tick();
    await click(rows()[0]);
    await flush();
    await click(btn('Заменить'));
    await flush();
    expect(host.querySelector('.better-busy')).toBeTruthy();
    await back();
    await flush();
    expect(aborted).toBe(true);
    // the dialog stays with the list: another release can be picked
    expect(host.querySelector('.better-dialog')).toBeTruthy();
    expect(host.querySelector('.better-busy')).toBeNull();
    expect(host.querySelector('.better-failure')).toBeNull();
  });

  it('on the series screen replaces the chosen season and stays', async () => {
    const files = [1, 2].map((e) => ({ id: e, path: 'Dark.Matter.S01E0' + e + '.1080p.mkv', length: 2e9 }));
    const s1: Torrent = {
      hash: H,
      title: 'Тёмная материя / Dark Matter / Сезон: 1 / Серии: 1-2 из 9 (2024) WEB-DL 1080p',
      category: 'tv',
      stat: 3,
      timestamp: 1,
      torrent_size: 4e9,
      file_stats: files,
    };
    torrents.value = [s1];
    const key = seriesKey(s1);
    routeStack.value = [{ name: 'library' }, { name: 'series', key }];
    search.mockImplementation((_q: string, src: string) =>
      Promise.resolve(src === 'rutor' ? [res('Тёмная материя / Dark Matter / Сезон: 1 / Серии: 1-9 из 9 (2024) WEB-DL 2160p', 40, NEW)] : []),
    );
    vi.mocked(replaceWithResult).mockResolvedValue({ ok: true, hash: NEW });
    mount(h(SeriesScreen, { seriesKey: key }));
    await flush();
    await click(btn('Найти в лучшем качестве'));
    await flush();
    await tick();
    expect(rows().length).toBe(1);
    await click(rows()[0]);
    await flush();
    await click(btn('Заменить'));
    await flush();
    await tick();
    expect(replaceWithResult).toHaveBeenCalledTimes(1);
    expect(currentRoute.value).toEqual({ name: 'series', key });
    expect(host.querySelector('.better-dialog')).toBeNull();
  });
  it('after a replace the focus goes to Play, not to the gone «Найти в лучшем качестве»', async () => {
    vi.mocked(replaceWithResult).mockResolvedValue({ ok: true, hash: NEW });
    mount(h(TorrentScreen, { hash: H }));
    await flush();
    // the remote opens the dialog from the focused button
    act(() => setFocus('torrent-better'));
    await click(btn('Найти в лучшем качестве'));
    await flush();
    await tick();
    await click(rows()[0]);
    await flush();
    await click(btn('Заменить'));
    await flush();
    await tick();
    await flush();
    expect(host.querySelector('.better-dialog')).toBeNull();
    expect(getCurrentFocusKey()).toBe('torrent-play');
  });

  it('a replace that ends after the dialog is gone does not touch the route', async () => {
    let finish: (v: any) => void = () => {};
    vi.mocked(replaceWithResult).mockImplementation(() => new Promise((r) => { finish = r; }));
    await openOnTorrent();
    await click(rows()[0]);
    await flush();
    await click(btn('Заменить'));
    await flush();
    expect(host.querySelector('.better-busy')).toBeTruthy();
    // the screen goes away (e.g. the server switched) while the replace still runs
    act(() => render(null, host));
    routeStack.value = [{ name: 'library' }, { name: 'settings' } as any];
    finish({ ok: true, hash: NEW });
    await flush();
    await tick();
    await flush();
    expect(currentRoute.value).toEqual({ name: 'settings' });
  });

  it('a failing position carry-over does not break the replace', async () => {
    vi.mocked(replaceWithResult).mockResolvedValue({ ok: true, hash: NEW });
    vi.mocked(carryProgress).mockImplementationOnce(() => { throw new Error('storage full'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await openOnTorrent();
    await click(rows()[0]);
    await flush();
    await click(btn('Заменить'));
    await flush();
    await tick();
    await flush();
    expect(carryProgress).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: NEW });
    expect(host.querySelector('.better-dialog')).toBeNull();
  });

  it('«Добавить рядом» shows that it is busy, and Back during it says to wait', async () => {
    let done: (v: any) => void = () => {};
    vi.spyOn(TorrServerClient.prototype, 'add').mockImplementation(() => new Promise((r) => { done = r; }));
    await openOnTorrent();
    await click(rows()[1]);
    await flush();
    await click(btn('Добавить рядом'));
    await flush();
    expect(host.querySelector('.better-busy')!.textContent).toBe('Добавляем раздачу…');
    await back();
    await flush();
    expect(host.querySelector('.better-dialog')).toBeTruthy();
    expect(host.querySelector('.better-busy')!.textContent).toContain('остановить нельзя');
    done({ hash: NEW, title: 'Dune 2160p' });
    await flush();
    expect(host.querySelector('.better-dialog')).toBeNull();
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: H });
  });

  it('on the series screen the «which release» choice shows the quality', async () => {
    const mk = (hash: string, q: string, size: number): Torrent => ({
      hash: hash,
      title: 'Тёмная материя / Dark Matter / Сезон: 1 / Серии: 1-2 из 9 (2024) ' + q,
      category: 'tv',
      stat: 3,
      timestamp: 1,
      torrent_size: size,
      file_stats: [1, 2].map((e) => ({ id: e, path: 'Dark.Matter.S01E0' + e + '.mkv', length: 2e9 })),
    });
    const a = mk(H, 'WEB-DL 720p', 4e9);
    const b = mk('f'.repeat(40), 'WEB-DL 1080p', 4e9);
    torrents.value = [a, b];
    const key = seriesKey(a);
    expect(seriesKey(b)).toBe(key);
    routeStack.value = [{ name: 'library' }, { name: 'series', key }];
    mount(h(SeriesScreen, { seriesKey: key }));
    await flush();
    await click(btn('Найти в лучшем качестве'));
    await flush();
    const labels = all('.dialog-option').map((o) => (o.textContent || '').trim());
    expect(labels.length).toBe(2);
    expect(labels.some((l) => l.indexOf('720p') >= 0)).toBe(true);
    expect(labels.some((l) => l.indexOf('1080p') >= 0)).toBe(true);
  });
});

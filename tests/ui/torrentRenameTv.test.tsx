import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { TorrentScreen } from '../../src/screens/Torrent';
import { TextDialogHost } from '../../src/ui/TextDialog';
import { DialogHost } from '../../src/ui/dialog';
import { ToastHost } from '../../src/ui/toast';
import { servers, addServer, setActiveServer, removeServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { TorrServerClient } from '../../src/api/torrserver';
import { setCatalogProvider } from '../../src/catalog/activeCatalog';
import type { Torrent } from '../../src/api/types';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const H = 'e'.repeat(40);
const tor: Torrent = {
  hash: H,
  title: 'Starbound Frontier S02 1080p',
  stat: 3,
  file_stats: [1, 2].map((i) => ({ id: i, path: 'Show.S02E0' + i + '.mkv', length: 1e9 })),
};
const flush = () => act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); });
let host: HTMLElement;
const btn = (label: string) =>
  (Array.prototype.slice.call(host.querySelectorAll('.button, .dialog-option')) as HTMLElement[]).filter((b) => (b.textContent || '').trim() === label)[0];
const click = (el: Element) => act(async () => { (el as HTMLElement).click(); });

beforeEach(async () => {
  localStorage.clear();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  torrents.value = [tor];
  vi.spyOn(TorrServerClient.prototype, 'get').mockResolvedValue(tor);
  vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(h('div', {}, h(TorrentScreen, { hash: H }), h(TextDialogHost, {}), h(DialogHost, {}), h(ToastHost, {})), host));
  await flush();
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  setCatalogProvider(null);
  vi.restoreAllMocks();
});

describe('TV torrent screen · rename and poster', () => {
  it('renames through the text dialog and shows the new title', async () => {
    const set = vi.spyOn(TorrServerClient.prototype, 'setTitle').mockResolvedValue(undefined);
    await click(btn('Переименовать'));
    const input = host.querySelector('.text-dialog input') as HTMLInputElement;
    expect(input.value).toBe('Starbound Frontier S02 1080p');
    act(() => { input.value = 'Новое имя'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await click(btn('Сохранить'));
    await flush();
    expect(set).toHaveBeenCalled();
    expect((set.mock.calls[0] as any)[1]).toBe('Новое имя');
    expect(host.querySelector('h1')!.textContent).toBe('Новое имя');
    expect(torrents.value[0].title).toBe('Новое имя');
  });

  it('«Сменить постер»: a grid of the catalog results, a title opens its variants, the pick is saved', async () => {
    const set = vi.spyOn(TorrServerClient.prototype, 'setPoster').mockResolvedValue(undefined);
    const item = (id: number, kind: string, p: string) => ({ id, kind, title: 'Кино ' + id, original: '', year: 2020 + id, poster: p, rating: 7 });
    const search = vi.fn(() => Promise.resolve({ items: [item(1, 'movie', 'http://p/1.jpg'), item(2, 'tv', 'http://p/2.jpg'), item(3, 'tv', '')], pages: 1 }));
    const posters = vi.fn(() => Promise.resolve(['http://p/2b.jpg']));
    setCatalogProvider(() => Promise.resolve({ search, posters } as any));
    await click(btn('Сменить постер'));
    await flush();
    expect(search).toHaveBeenCalledWith('Starbound Frontier', 1);
    // a series torrent: the series only, the result without a poster is left out
    const tiles = host.querySelectorAll('.poster-tile');
    expect(tiles.length).toBe(1);
    expect(tiles[0].textContent).toBe('Кино 22022');
    await click(tiles[0]);
    await flush();
    expect(posters).toHaveBeenCalledWith('tv', 2);
    const variants = host.querySelectorAll('.poster-variant');
    expect(variants.length).toBe(2);
    await click(variants[1]);
    await flush();
    expect(set).toHaveBeenCalledTimes(1);
    expect((set.mock.calls[0] as any)[1]).toBe('http://p/2b.jpg');
    expect(torrents.value[0].poster).toBe('http://p/2b.jpg');
    expect(host.querySelector('.poster-dialog')).toBeNull();
  });

  it('«Вставить ссылку» checks the link; «Сбросить» clears the poster', async () => {
    const set = vi.spyOn(TorrServerClient.prototype, 'setPoster').mockResolvedValue(undefined);
    vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
    setCatalogProvider(() => Promise.resolve({ search: () => Promise.resolve({ items: [], pages: 1 }) } as any));
    torrents.value = [{ ...tor, poster: 'https://old/p.jpg' }];
    await click(btn('Сменить постер'));
    await flush();
    expect(host.querySelector('.poster-empty')!.textContent).toBe('Постеры не найдены');
    await click(btn('Вставить ссылку'));
    const input = host.querySelector('.text-dialog input') as HTMLInputElement;
    act(() => { input.value = 'ftp://x/p.jpg'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await click(btn('Сохранить'));
    await flush();
    expect(set).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Нужна ссылка http:// или https:// на картинку');
    await click(btn('Сбросить (найти автоматически)'));
    for (let i = 0; i < 6; i++) await flush();
    expect(set).toHaveBeenCalledTimes(1);
    expect((set.mock.calls[0] as any)[1]).toBe('');
    expect(torrents.value[0].poster).toBe('');
  });

  it('a late variants reply for a title the user has left does not replace the current one', async () => {
    const item = (id: number) => ({ id, kind: 'tv', title: 'Кино ' + id, original: '', year: 2020, poster: 'http://p/' + id + '.jpg', rating: 7 });
    const replies: { [id: number]: (urls: string[]) => void } = {};
    setCatalogProvider(() =>
      Promise.resolve({
        search: () => Promise.resolve({ items: [item(1), item(2)], pages: 1 }),
        posters: (_k: string, id: number) => new Promise<string[]>((r) => (replies[id] = r)),
      } as any),
    );
    await click(btn('Сменить постер'));
    await flush();
    await click(host.querySelectorAll('.poster-tile')[0]);
    await flush();
    await click(btn('К результатам'));
    await click(host.querySelectorAll('.poster-tile')[1]);
    await flush();
    act(() => replies[2](['http://p/2b.jpg']));
    await flush();
    act(() => replies[1](['http://p/1b.jpg', 'http://p/1c.jpg']));
    await flush();
    const srcs = Array.from(host.querySelectorAll('.poster-variant img')).map((n) => n.getAttribute('src'));
    expect(srcs).toEqual(['http://p/2.jpg', 'http://p/2b.jpg']);
  });
});

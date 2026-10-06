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

  it('picks another poster from the catalog results', async () => {
    const set = vi.spyOn(TorrServerClient.prototype, 'setPoster').mockResolvedValue(undefined);
    const item = (id: number, p: string) => ({ id, kind: 'tv', title: 'Кино ' + id, original: '', year: 2020 + id, poster: p, rating: 7 });
    setCatalogProvider(() => Promise.resolve({ search: () => Promise.resolve({ items: [item(1, 'http://p/1.jpg'), item(2, 'http://p/2.jpg')], pages: 1 }) } as any));
    await click(btn('Другой постер'));
    await flush();
    expect(btn('Кино 1 · 2021')).toBeTruthy();
    await click(btn('Кино 2 · 2022'));
    await flush();
    expect(set).toHaveBeenCalledTimes(1);
    expect((set.mock.calls[0] as any)[1]).toBe('http://p/2.jpg');
    expect(torrents.value[0].poster).toBe('http://p/2.jpg');
  });
});

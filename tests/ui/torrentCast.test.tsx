import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { TorrentScreen } from '../../src/screens/Torrent';
import { servers, addServer, setActiveServer, removeServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { currentRoute, routeStack } from '../../src/ui/nav';
import { setCatalogProvider } from '../../src/catalog/activeCatalog';
import { TorrServerClient } from '../../src/api/torrserver';
import type { Torrent } from '../../src/api/types';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const film = (hash: string, name = 'Тихий сигнал'): Torrent => ({
  hash,
  title: name + ' / Quiet Signal (2023) BDRip 1080p',
  category: 'movie',
  stat: 3,
  file_stats: [{ id: 1, path: 'Quiet.Signal.2023.mkv', length: 1e9 }],
});
const series: Torrent = {
  hash: 'tvh',
  title: 'Тёмная материя / Dark Matter (2024) S01 1080p',
  category: 'tv',
  stat: 3,
  file_stats: [{ id: 1, path: 'Dark.Matter.S01E01.mkv', length: 1e9 }],
};
const cast = [
  { id: 7, name: 'Джоэл Эдгертон', photo: '', role: 'Джейсон', job: 'cast' },
  { id: 8, name: 'Блейк Крауч', photo: '', role: '', job: 'director' },
];
const search = vi.fn();
const card = vi.fn();
let host: HTMLElement;
const flush = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });

async function mount(tor: Torrent) {
  torrents.value = [tor];
  vi.spyOn(TorrServerClient.prototype, 'get').mockResolvedValue(tor);
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(h(TorrentScreen, { hash: tor.hash }), host));
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'probe').mockResolvedValue(null);
  routeStack.value = [{ name: 'library' }, { name: 'torrent', hash: 'x' }];
  search.mockReset();
  card.mockReset();
  setCatalogProvider(() => Promise.resolve({ search, card } as any));
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  setCatalogProvider(null);
  vi.restoreAllMocks();
});

describe('TV torrent screen · «В ролях»', () => {
  it('shows the cast of a film that TMDB knows; OK on a person opens the person screen', async () => {
    search.mockResolvedValue({ items: [{ kind: 'movie', id: 3, title: 'x', original: 'x', year: 2023, poster: '', rating: 0 }], pages: 1 });
    card.mockResolvedValue({ kind: 'movie', id: 3, cast });
    await mount(film('film1'));
    expect(search).toHaveBeenCalledWith('Тихий сигнал', 1);
    expect(host.querySelector('.tc-h2')!.textContent).toBe('В ролях');
    expect(host.querySelector('[data-fk="torrent-cast-0"]')).not.toBeNull();
    act(() => { (host.querySelector('[data-fk="torrent-cast-1"]') as HTMLElement).click(); });
    expect(currentRoute.value).toEqual({ name: 'person', id: 7, label: 'Джоэл Эдгертон' });
  });
  it('sits right under the action buttons, before the skip block and the files', async () => {
    search.mockResolvedValue({ items: [{ kind: 'movie', id: 3, title: 'x', original: 'x', year: 2023, poster: '', rating: 0 }], pages: 1 });
    card.mockResolvedValue({ kind: 'movie', id: 3, cast });
    await mount(film('film3'));
    const after = (a: string, b: string) => !!(host.querySelector(a)!.compareDocumentPosition(host.querySelector(b)!) & 4);
    expect(after('.torrent-head', '.tc-cast-row')).toBe(true);
    expect(after('.tc-cast-row', '.skip-block')).toBe(true);
    expect(after('.tc-cast-row', '[data-fk="file-1"]')).toBe(true);
  });
  it('shows nothing when TMDB has no such film', async () => {
    search.mockResolvedValue({ items: [], pages: 1 });
    await mount(film('film2', 'Пустой фильм'));
    expect(search).toHaveBeenCalled();
    expect(host.querySelector('.tc-cast-row')).toBeNull();
  });
  it('never looks a series up', async () => {
    search.mockResolvedValue({ items: [], pages: 1 });
    await mount(series);
    expect(card).not.toHaveBeenCalledWith('movie', expect.anything());
    expect(host.querySelector('.tc-cast-row')).toBeNull();
  });
});

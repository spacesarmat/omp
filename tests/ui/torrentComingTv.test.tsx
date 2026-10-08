import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init, setFocus, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { TorrentScreen } from '../../src/screens/Torrent';
import { servers, addServer, setActiveServer, removeServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { currentRoute, routeStack } from '../../src/ui/nav';
import { setCatalogProvider } from '../../src/catalog/activeCatalog';
import { resetSeriesMatches } from '../../src/lib/seriesMatch';
import { resetEpisodeNames } from '../../src/lib/episodeNames';
import { TorrServerClient } from '../../src/api/torrserver';
import type { Torrent } from '../../src/api/types';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

// «Тёмная материя»: 6 files of a 10-episode season
const series: Torrent = {
  hash: 'dm1',
  title: 'Тёмная материя / Dark Matter / Сезон: 1 / Серии: 1-6 из 10 (2024) WEB-DL 1080p',
  category: 'tv',
  stat: 3,
  file_stats: [1, 2, 3, 4, 5, 6].map((e) => ({ id: e, path: 'Dark.Matter.S01E0' + e + '.1080p.mkv', length: 2e9 })),
};
const film: Torrent = {
  hash: 'f1',
  title: 'Тихий сигнал / Quiet Signal (2023) BDRip 1080p',
  category: 'movie',
  stat: 3,
  file_stats: [{ id: 1, path: 'Quiet.Signal.2023.mkv', length: 1e9 }],
};
const dated = (n: number, title: string, airDate: string) => ({ n, title, airDate, runtime: 50, overview: '' });
const episodes = [1, 2, 3, 4, 5, 6].map((n) => dated(n, 'Вышедшая ' + n, '2024-05-0' + n)).concat([
  dated(7, 'Пирамида', '2099-01-08'),
  dated(8, 'Эпизод 8', '2099-01-15'),
  dated(9, 'Без даты', ''),
]);
const plainSeason = (_id: number, n: number) => Promise.resolve({ number: n, name: '', airDate: '', overview: '', episodes });
const stub: any = {
  search: () => Promise.resolve({ items: [{ id: 1, kind: 'tv', title: 'Тёмная материя', original: 'Dark Matter', year: 2024, poster: '', rating: 7.6 }], pages: 1 }),
  card: () =>
    Promise.resolve({ id: 1, kind: 'tv', title: 'Тёмная материя', original: 'Dark Matter', year: 2024, cast: [], seasons: [{ number: 1, episodes: 10, year: 2024, aired: 6 }] }),
  season: plainSeason,
};

let host: HTMLElement;
const flush = async () => {
  for (let i = 0; i < 20; i++) await act(() => Promise.resolve());
};
const text = (el: Element | null) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');
const coming = () => Array.prototype.slice.call(host.querySelectorAll('.ep-coming')) as HTMLElement[];

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
  resetSeriesMatches();
  resetEpisodeNames();
  stub.season = plainSeason;
  setCatalogProvider(() => Promise.resolve(stub));
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  setCatalogProvider(null);
  vi.restoreAllMocks();
});

describe('TV torrent screen · announced episodes', () => {
  it('after the last file row: dashed muted rows «S01E07 Пирамида · выйдет …», «Серия 8» without a name; no OK', async () => {
    await mount(series);
    const rows = Array.prototype.slice.call(host.querySelectorAll('.file-row')) as HTMLElement[];
    expect(rows).toHaveLength(8);
    const c = coming();
    expect(c).toHaveLength(2);
    expect(rows.indexOf(c[0])).toBe(6);
    expect(text(c[0].querySelector('.ep'))).toBe('S01E07');
    expect(text(c[0].querySelector('.name'))).toBe('Пирамида');
    expect(text(c[0].querySelector('.size'))).toMatch(/^выйдет \d+ янв/);
    expect(text(c[1].querySelector('.name'))).toBe('Серия 8');
    expect(c.every((r) => r.tagName === 'DIV' && !r.hasAttribute('data-fk') && r.getAttribute('aria-disabled') === 'true')).toBe(true);
    const before = currentRoute.value;
    act(() => { c[0].click(); });
    await flush();
    expect(currentRoute.value).toBe(before);
  });

  it('Down from the last file row does not land on them', async () => {
    await mount(series);
    expect(coming()).toHaveLength(2);
    act(() => setFocus('file-6'));
    await flush();
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 40, key: 'ArrowDown', bubbles: true } as KeyboardEventInit)); });
    await flush();
    const k = getCurrentFocusKey();
    expect(k).toBeTruthy();
    expect(host.querySelector('[data-fk="' + k + '"]')).not.toBeNull();
    expect(host.querySelector('.ep-coming.focused')).toBeNull();
  });

  it('none for a film', async () => {
    await mount(film);
    expect(coming()).toHaveLength(0);
  });

  it('none without TMDB', async () => {
    stub.season = () => Promise.reject(new Error('offline'));
    await mount(series);
    expect(coming()).toHaveLength(0);
    expect(host.querySelectorAll('.file-row')).toHaveLength(6);
  });
});

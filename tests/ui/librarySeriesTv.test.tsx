import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { LibraryScreen } from '../../src/screens/Library';
import { servers, activeServerId, addServer, setActiveServer } from '../../src/store/servers';
import { torrents, resetLibrary } from '../../src/store/library';
import { currentRoute, routeStack } from '../../src/ui/nav';
import { mockFetch } from '../helpers/fetchMock';
import { setCatalogProvider } from '../../src/catalog/activeCatalog';
import { resetSeriesMatches, seriesMatchVersion } from '../../src/lib/seriesMatch';
import { setTvCatalogForTests, tvCatalog } from '../../src/catalog/tvCatalog';
import { t } from '../../src/i18n';

const file = (name: string) => JSON.stringify({ TorrServer: { Files: [{ id: 1, path: name, length: 1 }] } });
const season = (n: number) => ({
  hash: 's' + n,
  title: 'Тёмная материя / Dark Matter / Сезон: ' + n + ' / Серии: 1-9 из 9 (2024) WEB-DL 1080p',
  category: 'tv',
  timestamp: n,
  data: file('Dark.Matter.S0' + n + 'E01.mkv'),
});

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  activeServerId.value = null;
  document.body.innerHTML = '';
  const fixture = [
    season(1),
    season(2),
    { hash: 'f1', title: 'Quiet Signal (2024) 2160p', category: 'movie', timestamp: 9, data: file('Quiet.Signal.2024.mkv') },
  ];
  // the library reloads the list on mount: serve the fixture so it is not replaced by an empty one
  mockFetch((url) => ({ body: url.indexOf('/torrents') >= 0 ? JSON.stringify(fixture) : '[]' }));
  const a = addServer({ url: '10.0.0.2' });
  setActiveServer(a.id);
  resetLibrary();
  resetSeriesMatches();
  setTvCatalogForTests(null);
  setCatalogProvider(null);
  routeStack.value = [{ name: 'library' }];
  torrents.value = fixture as any;
});

const hosts: HTMLElement[] = [];
afterEach(() => {
  // an unmounted screen cannot ask for a lookup of the next test
  while (hosts.length) render(null, hosts.pop()!);
});

function mount() {
  const host = document.createElement('div');
  hosts.push(host);
  document.body.appendChild(host);
  act(() => { render(h(LibraryScreen, {}), host); });
  return host;
}
const flush = () => act(() => Promise.resolve());

describe('LibraryScreen on the TV: short titles and series tiles', () => {
  it('shows one tile for the two seasons with the short title and the seasons count', async () => {
    const host = mount();
    await flush();
    const tiles = host.querySelectorAll('.tile-series');
    expect(tiles).toHaveLength(1);
    expect(tiles[0].querySelector('.tile-title')!.textContent).toBe('Тёмная материя');
    expect(tiles[0].querySelector('.tile-meta')!.textContent).toBe('2 сезона');
    expect(tiles[0].querySelector('.tile-count')!.textContent).toBe('2');
  });
  it('shows a film with the short title and the year', async () => {
    const host = mount();
    await flush();
    const film = Array.prototype.filter.call(host.querySelectorAll('.tile'), (e: Element) => !e.classList.contains('tile-series'))[0] as Element;
    expect(film.querySelector('.tile-title')!.textContent).toBe('Quiet Signal');
    expect(film.querySelector('.tile-meta')!.textContent).toBe('2024');
  });
  it('opens the series route on OK', async () => {
    const host = mount();
    await flush();
    (host.querySelector('.tile-series') as HTMLElement).click();
    await flush();
    const r = currentRoute.value as any;
    expect(r.name).toBe('series');
    expect(typeof r.key).toBe('string');
    expect(r.key.length).toBeGreaterThan(0);
  });
  it('shows the TMDB status pill once the lookup is done', async () => {
    const stub: any = {
      search: () => Promise.resolve({ items: [{ id: 7, kind: 'tv', title: 'Dark Matter', year: 2024 }], pages: 1 }),
      card: (_k: string, id: number) => Promise.resolve({ id, kind: 'tv', title: 'Dark Matter', year: 2024, status: 'returning', nextEpisode: null, seasons: [], airing: true }),
    };
    setTvCatalogForTests(stub);
    setCatalogProvider(() => tvCatalog());
    const host = mount();
    for (let i = 0; i < 20; i++) await flush();
    const pill = host.querySelector('.tile-series .series-pill');
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toBe(t('series.statusAiring'));
  });
});

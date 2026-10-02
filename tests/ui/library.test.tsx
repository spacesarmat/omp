import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { LibraryScreen } from '../../src/screens/Library';
import { servers, activeServerId, addServer, setActiveServer } from '../../src/store/servers';
import { torrents, libraryTab, libraryQuery, librarySearchOpen, resetLibrary } from '../../src/store/library';
import { mockFetch } from '../helpers/fetchMock';
import { settings, resetSettings } from '../../src/store/settings';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  activeServerId.value = null;
  document.body.innerHTML = '';
  mockFetch(() => ({ body: '[]' }));
  const a = addServer({ url: '10.0.0.2' });
  setActiveServer(a.id);
  torrents.value = [
    { hash: 'a1', title: 'Alpha movie', timestamp: 2 },
    { hash: 'b2', title: 'Beta show', timestamp: 1 },
  ] as any;
});

function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(h(LibraryScreen, {}), host);
  return host;
}
const flush = () => act(() => Promise.resolve());

describe('LibraryScreen view state', () => {
  it('keeps the History tab across unmount and remount', async () => {
    let host = mount();
    await flush();
    libraryTab.value = 'history';
    await flush();
    expect(host.querySelector('.tab.active')!.textContent).toContain('История');
    render(null, host);
    host.remove();
    host = mount();
    await flush();
    expect(libraryTab.value).toBe('history');
    expect(host.querySelector('.tab.active')!.textContent).toContain('История');
  });
  it('keeps the search row and query across remount', async () => {
    let host = mount();
    await flush();
    librarySearchOpen.value = true;
    libraryQuery.value = 'beta';
    await flush();
    expect(host.querySelector('.search-count')!.textContent).toBe('Найдено: 1');
    render(null, host);
    host.remove();
    host = mount();
    await flush();
    expect(host.querySelector('.search-row')).not.toBeNull();
    expect(host.querySelector('.search-count')!.textContent).toBe('Найдено: 1');
  });
  it('resetLibrary() resets tab, search and query', () => {
    libraryTab.value = 'history';
    librarySearchOpen.value = true;
    libraryQuery.value = 'x';
    resetLibrary();
    expect(libraryTab.value).toBe('all');
    expect(librarySearchOpen.value).toBe(false);
    expect(libraryQuery.value).toBe('');
  });
});

describe('LibraryScreen history with sources', () => {
  const now = Date.now();
  const journal = (h: object[]) => JSON.stringify({ TorrServer: { Files: [{ id: 1, path: 'Film.mkv', length: 1 }] }, omp: { v: 1, h } });
  const list = [
    { hash: 'a1', title: 'Alpha movie', category: 'movie', stat: 5, timestamp: 2, data: journal([{ f: 1, t: 600, d: 2900, at: now - 60000, src: 'phone', name: 'Pixel 7' }]) },
    { hash: 'b2', title: 'Beta show', category: 'movie', stat: 5, timestamp: 1, data: journal([{ f: 1, t: 60, d: 100, at: now - 120000, src: 'tv' }]) },
  ];

  beforeEach(() => {
    resetSettings();
    mockFetch((_url, init) => {
      const body = init.body ? JSON.parse(init.body) : {};
      return { body: body.action === 'list' && _url.indexOf('/torrents') >= 0 ? JSON.stringify(list) : '[]' };
    });
  });

  it('shows the source line and filters by source; the filter is kept in settings', async () => {
    const host = mount();
    await flush();
    await flush();
    libraryTab.value = 'history';
    await flush();
    expect(host.querySelectorAll('.hcard')).toHaveLength(2);
    expect(host.querySelector('.hcard-src')!.textContent).toMatch(/^Телефон «Pixel 7» · (сегодня|вчера) /);
    const filters = host.querySelectorAll('.hfilter');
    expect(filters).toHaveLength(3);
    act(() => (filters[2] as HTMLElement).click());
    await flush();
    expect(settings.value.historyFilter).toBe('phone');
    expect(JSON.parse(localStorage.getItem('tsp.settings')!).historyFilter).toBe('phone');
    expect(host.querySelectorAll('.hcard')).toHaveLength(1);
    expect(host.querySelector('.hcard-title')!.textContent).toBe('Alpha movie');
    act(() => (host.querySelectorAll('.hfilter')[1] as HTMLElement).click());
    await flush();
    expect(host.querySelectorAll('.hcard')).toHaveLength(1);
    expect(host.querySelector('.hcard-title')!.textContent).toBe('Beta show');
    expect(host.querySelector('.hcard-src')!.textContent).toMatch(/^Телевизор · (сегодня|вчера) /);
  });

  it('no filter row outside the history tab', async () => {
    const host = mount();
    await flush();
    libraryTab.value = 'all';
    await flush();
    expect(host.querySelector('.hfilter')).toBeNull();
  });
});

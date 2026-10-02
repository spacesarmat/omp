import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { LibraryScreen } from '../../src/screens/Library';
import { servers, activeServerId, addServer, setActiveServer } from '../../src/store/servers';
import { torrents, libraryTab, libraryQuery, librarySearchOpen, resetLibrary } from '../../src/store/library';
import { mockFetch } from '../helpers/fetchMock';

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

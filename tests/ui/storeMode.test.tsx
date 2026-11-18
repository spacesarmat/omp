import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';

// The store flag is baked at build time; here a hoisted mutable cell stands in for it so one file can test both
// the store build (public search off) and the regular build (unchanged). Components read it at render/call time.
const flag = vi.hoisted(() => ({ store: false }));
vi.mock('../../src/storeMode', () => ({
  get STORE_BUILD() {
    return flag.store;
  },
  publicSearchEnabled: () => !flag.store,
}));

import { tvLibraryTabs } from '../../src/lib/libraryView';
import { TopBar } from '../../src/ui/TopBar';
import { SettingsScreen } from '../../src/screens/Settings';
import { servers, activeServerId, addServer, setActiveServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { mockFetch } from '../helpers/fetchMock';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  flag.store = false;
  localStorage.clear();
  servers.value = [];
  activeServerId.value = null;
  document.body.innerHTML = '';
  mockFetch(() => ({ body: '[]' }));
  const a = addServer({ url: '10.0.0.2' });
  setActiveServer(a.id);
  torrents.value = [{ hash: 'a1', title: 'Alpha movie', timestamp: 2 }] as any;
});
afterEach(() => {
  flag.store = false;
  Array.from(document.body.children).forEach((c) => render(null, c));
  document.body.innerHTML = '';
});

function mount(node: preact.ComponentChild): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(node, host));
  return host;
}
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });

const topBar = () =>
  h(TopBar, {
    tab: 'all',
    onTab: () => {},
    view: 'large',
    sort: 'new',
    searchOpen: false,
    onSearch: () => {},
    onView: () => {},
    onSort: () => {},
    onFocused: () => {},
  });

describe('store build: public search and discovery are off', () => {
  it('library tabs drop «Обзор» and «Новое», keep history and categories', () => {
    flag.store = true;
    const ids = tvLibraryTabs().map((t) => t.id);
    expect(ids).not.toContain('discover');
    expect(ids).not.toContain('news');
    expect(ids).toContain('history');
    expect(ids).toContain('all');
  });

  it('top bar has no «find a release» button, keeps local search and playlist', async () => {
    flag.store = true;
    const host = mount(topBar());
    await flush();
    expect(host.querySelector('[data-fk="lib-btn-add"]')).toBeNull();
    expect(host.querySelector('[data-fk="lib-btn-search"]')).toBeTruthy();
    expect(host.querySelector('[data-fk="lib-btn-playlist"]')).toBeTruthy();
  });

  it('settings hide the search section (sources, live seeds, help rank)', async () => {
    flag.store = true;
    const host = mount(h(SettingsScreen, {}));
    await flush();
    expect(host.querySelector('[data-fk="set-sources"]')).toBeNull();
    expect(host.querySelector('[data-fk="set-live-seeds"]')).toBeNull();
    expect(host.querySelector('[data-fk="set-help-rank"]')).toBeNull();
    // playback/server settings stay
    expect(host.querySelector('[data-fk="set-server"]')).toBeTruthy();
  });
});

describe('regular build: unchanged', () => {
  it('library tabs keep «Обзор» and «Новое»', () => {
    const ids = tvLibraryTabs().map((t) => t.id);
    expect(ids).toContain('discover');
    expect(ids).toContain('news');
  });

  it('top bar keeps the «find a release» button', async () => {
    const host = mount(topBar());
    await flush();
    expect(host.querySelector('[data-fk="lib-btn-add"]')).toBeTruthy();
  });

  it('settings keep the search section', async () => {
    const host = mount(h(SettingsScreen, {}));
    await flush();
    expect(host.querySelector('[data-fk="set-sources"]')).toBeTruthy();
    expect(host.querySelector('[data-fk="set-live-seeds"]')).toBeTruthy();
  });
});
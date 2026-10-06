import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { LibraryScreen } from '../../src/screens/Library';
import { TopBar } from '../../src/ui/TopBar';
import { DialogHost } from '../../src/ui/dialog';
import { TextDialogHost } from '../../src/ui/TextDialog';
import { servers, activeServerId, addServer, setActiveServer } from '../../src/store/servers';
import { torrents, resetLibrary, libraryTab } from '../../src/store/library';
import { currentRoute, routeStack } from '../../src/ui/nav';
import { mockFetch } from '../helpers/fetchMock';
import { setCatalogProvider } from '../../src/catalog/activeCatalog';
import { resetDiscoverState, TV_DISCOVER_QUERY_KEY } from '../../src/store/discover';
import { wantList, toggleWant } from '../../src/store/wantList';
import { dispatchKey } from '../../src/ui/keys';
import { lastRowStart } from '../../src/screens/library/DiscoverGrid';

const fixture = [
  { hash: 'f1', title: 'Основание / Foundation / Сезон: 1 (2021) WEB-DL 1080p', category: 'tv', timestamp: 1 },
];

const title = (i: number, over: Record<string, unknown> = {}) => ({
  kind: i % 2 ? 'tv' : 'movie', id: 100 + i, title: 'Фильм ' + i, original: 'Film ' + i, year: 2020 + (i % 5), poster: '', rating: 7.25, ...over,
});

function page(n: number) {
  const items = [];
  for (let i = 0; i < 16; i++) items.push(title((n - 1) * 16 + i));
  if (n === 1) items[0] = { kind: 'tv', id: 1, title: 'Основание', original: 'Foundation', year: 2021, poster: 'http://img/p.jpg', rating: 7.6 };
  return { items: items, pages: 3 };
}

let stub: any;

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  activeServerId.value = null;
  document.body.innerHTML = '';
  mockFetch((url) => ({ body: url.indexOf('/torrents') >= 0 ? JSON.stringify(fixture) : '[]' }));
  const a = addServer({ url: '10.0.0.2' });
  setActiveServer(a.id);
  resetLibrary();
  resetDiscoverState();
  wantList.value = [];
  stub = {
    discover: vi.fn((_kind: string, _q: unknown, n: number) => Promise.resolve(page(n))),
    search: vi.fn(() => Promise.resolve({ items: [title(99, { title: 'Дюна' })], pages: 1 })),
  };
  setCatalogProvider(() => Promise.resolve(stub));
  torrents.value = fixture as any;
  routeStack.value = [{ name: 'library' }];
  libraryTab.value = 'discover';
});

const hosts: HTMLElement[] = [];
afterEach(() => {
  while (hosts.length) {
    const host = hosts.pop()!;
    act(() => { render(null, host); });
  }
  setCatalogProvider(null);
});

const flush = async () => {
  for (let i = 0; i < 20; i++) await act(() => Promise.resolve());
};

async function mount() {
  const host = document.createElement('div');
  hosts.push(host);
  document.body.appendChild(host);
  act(() => { render(h('div', {}, h(LibraryScreen, {}), h(DialogHost, {}), h(TextDialogHost, {})), host); });
  await flush();
  return host;
}

const text = (el: Element | null) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');
const byText = (host: Element, sel: string, label: string) =>
  (Array.prototype.slice.call(host.querySelectorAll(sel)) as HTMLElement[]).filter((b) => text(b) === label)[0];
const click = async (el: Element) => {
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
};

describe('TV «Обзор» tab', () => {
  it('comes right after «История» in the header', () => {
    const host = document.createElement('div');
    hosts.push(host);
    document.body.appendChild(host);
    const props = { tab: 'discover', onTab: vi.fn(), view: 'large', sort: 'new', searchOpen: false, onSearch: vi.fn(), onView: vi.fn(), onSort: vi.fn(), onFocused: vi.fn() };
    act(() => { render(h(TopBar as any, props), host); });
    const tabs = Array.prototype.map.call(host.querySelectorAll('.tab'), (e: Element) => text(e)) as string[];
    expect(tabs.slice(0, 3)).toEqual(['История', 'Обзор', 'Все']);
    expect(text(host.querySelector('.tab.active'))).toBe('Обзор');
  });

  it('shows the TMDB posters with the rating and the library mark', async () => {
    const host = await mount();
    expect(stub.discover).toHaveBeenCalledWith('all', expect.objectContaining({ sort: 'popular' }), 1);
    const tiles = host.querySelectorAll('.disc-tile');
    expect(tiles).toHaveLength(16);
    expect(text(tiles[0].querySelector('.disc-title'))).toBe('Основание');
    expect(text(tiles[0].querySelector('.disc-rating'))).toBe('★ 7,6');
    expect(text(tiles[0].querySelector('.disc-mark'))).toBe('В медиатеке');
    expect(text(tiles[0].querySelector('.disc-meta'))).toBe('2021 · Сериал');
    expect(tiles[0].querySelector('img')!.getAttribute('src')).toBe('http://img/p.jpg');
    expect(tiles[1].querySelector('.disc-mark')).toBeNull();
    expect(text(host.querySelector('.hints'))).toContain('ОК — карточка');
  });

  it('opens the title card on OK', async () => {
    const host = await mount();
    await click(host.querySelectorAll('.disc-tile')[0]);
    expect(currentRoute.value).toEqual({ name: 'title', kind: 'tv', id: 1 });
  });

  it('re-queries with a new sort chosen in the dialog and keeps it', async () => {
    const host = await mount();
    await click(host.querySelector('[data-fk="disc-sort"]')!);
    await click(byText(document.body, '.dialog-option', 'По рейтингу'));
    const last = stub.discover.mock.calls[stub.discover.mock.calls.length - 1];
    expect(last[1].sort).toBe('rating');
    expect(last[2]).toBe(1);
    expect(JSON.parse(localStorage.getItem(TV_DISCOVER_QUERY_KEY)!).sort).toBe('rating');
    expect(text(host.querySelector('[data-fk="disc-sort"]'))).toBe('Сортировка: По рейтингу');
  });

  it('sets one genre and the minimum rating', async () => {
    const host = await mount();
    await click(host.querySelector('[data-fk="disc-genre"]')!);
    await click(byText(document.body, '.dialog-option', 'Фантастика'));
    await click(host.querySelector('[data-fk="disc-rating"]')!);
    await click(byText(document.body, '.dialog-option', 'от 7'));
    const last = stub.discover.mock.calls[stub.discover.mock.calls.length - 1];
    expect(last[1].genres).toEqual(['scifi']);
    expect(last[1].rating).toBe(7);
    expect(text(host.querySelector('[data-fk="disc-genre"]'))).toBe('Жанр: Фантастика');
    expect(text(host.querySelector('[data-fk="disc-rating"]'))).toBe('Рейтинг: от 7');
  });

  it('switches the kind by focus', async () => {
    const host = await mount();
    await act(() => { setFocus('disc-kind-tv'); });
    await flush();
    expect(host.querySelector('.disc-kind.active')!.textContent).toBe('Сериалы');
    const last = stub.discover.mock.calls[stub.discover.mock.calls.length - 1];
    expect(last[0]).toBe('tv');
  });

  it('replaces the grid with the search results and restores it on «Сбросить поиск»', async () => {
    const host = await mount();
    await click(host.querySelector('[data-fk="disc-find"]')!);
    const input = document.body.querySelector('.text-dialog input') as HTMLInputElement;
    act(() => { input.value = 'дюна'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await click(byText(document.body, '.button', 'Поиск'));
    expect(stub.search).toHaveBeenCalledWith('дюна', 1);
    expect(text(host.querySelector('.disc-sub-text'))).toBe('Результаты: дюна');
    expect(host.querySelectorAll('.disc-tile')).toHaveLength(1);
    expect(text(host.querySelector('.disc-title'))).toBe('Дюна');
    await click(host.querySelector('[data-fk="disc-reset"]')!);
    expect(host.querySelectorAll('.disc-tile')).toHaveLength(16);
    expect(host.querySelector('.disc-sub-text')).toBeNull();
  });

  it('loads the next page when focus reaches the last row and keeps the focus', async () => {
    const host = await mount();
    expect(lastRowStart(16)).toBe(8);
    await act(() => { setFocus('disc-movie-102'); });
    await flush();
    expect(stub.discover).toHaveBeenCalledTimes(1);
    await act(() => { setFocus('disc-movie-108'); });
    await flush();
    expect(stub.discover).toHaveBeenCalledTimes(2);
    expect(stub.discover.mock.calls[1][2]).toBe(2);
    expect(host.querySelectorAll('.disc-tile')).toHaveLength(32);
    expect(host.querySelector('[data-fk="disc-movie-108"]')!.className).toContain('focused');
  });

  it('shows the offline text with «Повторить» and loads again', async () => {
    stub.discover = vi.fn(() => Promise.reject(Object.assign(new Error('offline'), { code: 'offline' })));
    const host = await mount();
    expect(text(host.querySelector('.disc-error'))).toContain('TMDB не отвечает');
    stub.discover = vi.fn((_k: string, _q: unknown, n: number) => Promise.resolve(page(n)));
    await click(host.querySelector('[data-fk="disc-retry"]')!);
    expect(stub.discover).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('.disc-tile')).toHaveLength(16);
  });

  it('shows the no-key text', async () => {
    stub.discover = vi.fn(() => Promise.reject(Object.assign(new Error('nokey'), { code: 'nokey' })));
    const host = await mount();
    expect(text(host.querySelector('.disc-error'))).toContain('Нет ключа TMDB');
  });

  it('marks wanted titles, toggles with the yellow key and lists them under «Хочу»', async () => {
    toggleWant({ kind: 'tv', id: 101, title: 'Фильм 1', year: 2021, poster: '' });
    const host = await mount();
    const tiles = host.querySelectorAll('.disc-tile');
    expect(text(tiles[1].querySelector('.disc-mark'))).toBe('Хочу');
    await act(() => { setFocus('disc-movie-102'); });
    await flush();
    await act(async () => { dispatchKey('yellow', new KeyboardEvent('keydown')); });
    expect(wantList.value.map((w) => w.id)).toEqual([102, 101]);
    await act(() => { setFocus('disc-kind-want'); });
    await flush();
    const want = host.querySelectorAll('.disc-tile');
    expect(want).toHaveLength(2);
    expect(text(want[0].querySelector('.disc-title'))).toBe('Фильм 2');
    expect(host.querySelector('.disc-kind.active')!.textContent).toBe('Хочу');
  });
});

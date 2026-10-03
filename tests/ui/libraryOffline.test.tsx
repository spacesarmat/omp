import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { LibraryScreen } from '../../src/screens/Library';
import { servers, activeServerId, addServer, setActiveServer } from '../../src/store/servers';
import { torrents, torrentsAt } from '../../src/store/library';
import { currentRoute, resetTo } from '../../src/ui/nav';
import { mockFetch } from '../helpers/fetchMock';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});
let host: HTMLElement;
beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  activeServerId.value = null;
  document.body.innerHTML = '';
  torrents.value = [];
  torrentsAt.value = 0;
  resetTo({ name: 'library' });
  setActiveServer(addServer({ name: 'Гостиная', url: '10.0.0.2' }).id);
});
afterEach(() => {
  act(() => render(null, host));
  vi.restoreAllMocks();
});
function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(h(LibraryScreen, {}), host));
}
const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
const btn = (t: string) => Array.from(host.querySelectorAll('.button')).find((b) => (b.textContent || '').includes(t)) as HTMLElement | undefined;
const failing = () => mockFetch(() => ({ status: 500, body: 'boom' }));

describe('TV library: catalog unavailable', () => {
  it('server down, no cache: full state with named reason, hint and actions', async () => {
    failing();
    mount();
    await flush();
    const t = host.textContent || '';
    expect(t).toContain('Каталог недоступен');
    expect(t).toContain('Сервер «Гостиная» не отвечает');
    expect(t).toContain('Проверьте, что телефон и сервер в одной сети');
    expect(t).not.toContain('Нет торрентов');
    expect(btn('Повторить')).toBeDefined();
    act(() => btn('Сменить сервер')!.click());
    expect(currentRoute.value.name).toBe('connect');
  });

  it('retry reloads and shows the catalog when the server answers', async () => {
    failing();
    mount();
    await flush();
    mockFetch(() => ({ body: JSON.stringify([{ hash: 'a1', title: 'Alpha movie', timestamp: 2 }]) }));
    act(() => btn('Повторить')!.click());
    await flush();
    expect(host.textContent).not.toContain('Каталог недоступен');
    expect(host.textContent).toContain('Alpha movie');
  });

  it('offline: network reason', async () => {
    failing();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    mount();
    await flush();
    expect(host.textContent).toContain('Нет подключения к сети');
  });

  it('no server: redirects to the connect screen (no catalog state there)', async () => {
    activeServerId.value = null;
    mount();
    await flush();
    expect(currentRoute.value.name).toBe('connect');
  });

  it('cached list and failed refresh: banner with time and retry button', async () => {
    failing();
    torrents.value = [{ hash: 'a1', title: 'Alpha movie', timestamp: 2 }] as any;
    torrentsAt.value = new Date(2026, 0, 2, 9, 5).getTime();
    mount();
    await flush();
    expect(host.textContent).toContain('Каталог недоступен · показан сохранённый список от 09:05');
    expect(host.textContent).toContain('Alpha movie');
    expect(btn('Повторить')).toBeDefined();
  });

  it('real refresh time feeds the banner after a later failure', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 2, 9, 5));
    mockFetch(() => ({ body: JSON.stringify([{ hash: 'a1', title: 'Alpha movie', timestamp: 2 }]) }));
    mount();
    await flush();
    act(() => render(null, host));
    failing();
    mount();
    await flush();
    vi.useRealTimers();
    expect(host.textContent).toContain('показан сохранённый список от 09:05');
  });

  it('empty text only when the server answered with an empty list', async () => {
    mockFetch(() => ({ body: '[]' }));
    mount();
    await flush();
    expect(host.textContent).toContain('Нет торрентов');
    expect(host.textContent).not.toContain('Каталог недоступен');
  });
});

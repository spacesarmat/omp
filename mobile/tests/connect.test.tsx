import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Connect } from '../src/screens/Connect';
import { setQrScanner } from '../src/platform/qr';
import { toast } from '../src/ui/toast';
import { currentRoute, routeStack, resetTo } from '../src/nav';
import { saveTv, setActiveTv, reloadTvs } from '../src/tv/tvStore';
import { setPlayerLinkDeps } from '../src/tv/playerLink';
import { activeServer, addServer, setActiveServer, removeServer, servers } from '../../src/store/servers';
import { mockFetch } from '../../tests/helpers/fetchMock';

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

function mount(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  act(() => render(<Connect />, el));
  return el;
}

function btn(el: HTMLElement, text: string): HTMLButtonElement {
  const b = Array.from(el.querySelectorAll('button')).find((x) => (x.textContent || '').includes(text));
  if (!b) throw new Error('no button ' + text);
  return b as HTMLButtonElement;
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  act(() => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(null);
  reloadTvs();
  resetTo({ name: 'connect' });
  toast.value = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  setQrScanner(null);
});

describe('Connect screen', () => {
  it('shows the shared logo', () => {
    const el = mount();
    expect(el.querySelector('.m-brand svg.logo')).not.toBeNull();
  });

  it('connects by address after a successful echo and opens the library', async () => {
    const f = mockFetch(() => ({ body: 'MatriX.145.1' }));
    const el = mount();
    type(el.querySelector<HTMLInputElement>('#addr')!, '192.168.1.10:8090');
    await act(async () => btn(el, 'Подключиться').click());
    await flush();
    expect(f.mock.calls.some((c) => String(c[0]).startsWith('http://192.168.1.10:8090/echo'))).toBe(true);
    expect(activeServer.value?.url).toBe('http://192.168.1.10:8090');
    expect(currentRoute.value.name).toBe('library');
  });

  it('shows an error under the field and stays when the server is unreachable', async () => {
    mockFetch(() => ({ status: 500, body: 'x' }));
    const el = mount();
    type(el.querySelector<HTMLInputElement>('#addr')!, '10.0.0.1');
    await act(async () => btn(el, 'Подключиться').click());
    await flush();
    expect(el.querySelector('.m-error')?.textContent).toBeTruthy();
    expect(currentRoute.value.name).toBe('connect');
    expect(servers.value).toHaveLength(0);
  });

  it('saves login and password from the collapsible block', async () => {
    mockFetch(() => ({ body: 'MatriX' }));
    const el = mount();
    type(el.querySelector<HTMLInputElement>('#addr')!, '10.0.0.2:8090');
    await act(async () => btn(el, 'Логин и пароль').click());
    type(el.querySelector<HTMLInputElement>('#user')!, 'bob');
    type(el.querySelector<HTMLInputElement>('#pass')!, 'pw');
    await act(async () => btn(el, 'Подключиться').click());
    await flush();
    expect(activeServer.value?.user).toBe('bob');
    expect(activeServer.value?.password).toBe('pw');
  });

  it('adds a server with credentials from the scanned QR and toasts', async () => {
    mockFetch(() => ({ body: 'MatriX' }));
    setQrScanner(async () => ({ url: 'http://192.168.1.10:8090', name: 'Дом', user: 'u', password: 'p' }));
    const el = mount();
    await act(async () => btn(el, 'Сканировать QR').click());
    await flush();
    expect(servers.value).toHaveLength(1);
    expect(servers.value[0]).toMatchObject({ name: 'Дом', user: 'u', password: 'p' });
    expect(activeServer.value?.name).toBe('Дом');
    expect(toast.value).toBe('Сервер «Дом» добавлен');
    // no TV yet: offer to pick one, the catalog stays underneath
    expect(currentRoute.value.name).toBe('tv');
    expect(routeStack.value.map((r) => r.name)).toEqual(['library', 'tv']);
  });

  it('after a scan with a saved TV links to it instead of opening the TV list', async () => {
    mockFetch(() => ({ body: 'MatriX' }));
    saveTv({ ip: '192.168.1.57', name: 'Спальня', clientKey: 'k' });
    setActiveTv('192.168.1.57');
    const launches: object[] = [];
    setPlayerLinkDeps({
      native: { startPlayerServer: async () => 'http://192.168.1.2:8123/', queuePlayerCommands: async () => {}, onPlayerMessage: () => () => {} } as any,
      foregroundAppId: async () => 'com.spacesarmat.torrplayer',
      launchOnTv: async (p) => void launches.push(p),
      tvIp: () => '192.168.1.57',
      tvFailed: () => false,
    });
    try {
      setQrScanner(async () => ({ url: 'http://192.168.1.10:8090', name: 'Дом' }));
      const el = mount();
      await act(async () => btn(el, 'Сканировать QR').click());
      await flush();
      expect(currentRoute.value.name).toBe('library');
      expect(launches).toEqual([{ report: 'http://192.168.1.2:8123/' }]);
    } finally {
      setPlayerLinkDeps(null);
    }
  });

  it('shows a scanner error and cancel is silent', async () => {
    setQrScanner(async () => {
      throw new Error('Это не QR OMP');
    });
    const el = mount();
    await act(async () => btn(el, 'Сканировать QR').click());
    await flush();
    expect(el.querySelector('.m-error')?.textContent).toBe('Это не QR OMP');
    setQrScanner(async () => null);
    await act(async () => btn(el, 'Сканировать QR').click());
    await flush();
    expect(el.querySelector('.m-error')).toBeNull();
  });

  it('lists saved servers with status and connects on tap', async () => {
    mockFetch((url) => (url.startsWith('http://10.0.0.12') ? { status: 500, body: '' } : { body: 'MatriX.145.1' }));
    addServer({ name: 'Дом', url: '192.168.1.10:8090' });
    addServer({ name: 'Дача', url: '10.0.0.12:8090' });
    const el = mount();
    await flush();
    const items = el.querySelectorAll('.m-server');
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('.m-dot.on')).not.toBeNull();
    expect(items[1].querySelector('.m-dot.on')).toBeNull();
    expect(items[0].textContent).toContain('онлайн');
    await act(async () => (items[0] as HTMLButtonElement).click());
    await flush();
    expect(activeServer.value?.name).toBe('Дом');
    expect(currentRoute.value.name).toBe('library');
  });

  it('renames a saved server; empty restores the URL without scheme', async () => {
    mockFetch(() => ({ body: 'MatriX.145.1' }));
    addServer({ name: 'Дом', url: '192.168.1.10:8090' });
    const el = mount();
    await flush();
    const open = () => act(async () => (el.querySelector('[aria-label="Переименовать ' + servers.value[0].name + '"]') as HTMLButtonElement).click());
    await open();
    const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dlg.textContent).toContain('Название сервера');
    const input = dlg.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('Дом');
    type(input, '  Кухня ');
    await act(async () => { btn(dlg, 'Сохранить').click(); });
    expect(servers.value[0].name).toBe('Кухня');
    expect(currentRoute.value.name).toBe('connect');
    expect(el.textContent).toContain('Кухня');
    await open();
    const d2 = document.querySelector('[role="dialog"]') as HTMLElement;
    type(d2.querySelector('input') as HTMLInputElement, '');
    await act(async () => { btn(d2, 'Сохранить').click(); });
    expect(servers.value[0].name).toBe('192.168.1.10:8090');
  });
});

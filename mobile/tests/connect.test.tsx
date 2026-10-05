import { applyLanguageSetting } from '../../src/i18n';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Connect, setServerScanner, scanLan } from '../src/screens/Connect';
import { localServer, setLocalServerDeps } from '../src/server/localServer';
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
  // unmount the previous screen: it would otherwise react to the shared local server signal
  const prev = document.getElementById('app');
  if (prev) act(() => render(null, prev));
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
  setServerScanner(null);
  setLocalServerDeps(null);
  localServer.value = { supported: false, running: false };
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

describe('Connect screen: TorrServer on the phone', () => {
  const supportedDeps = () =>
    setLocalServerDeps({ native: { localServerInfo: async () => ({ supported: true, running: false }) } as any });

  it('offers the card when nothing is found and the phone supports it', async () => {
    supportedDeps();
    setServerScanner(async () => []);
    localServer.value = { supported: true, running: false };
    const el = mount();
    await flush();
    const t = el.textContent!;
    expect(t).toContain('В сети не нашлось TorrServer');
    expect(t).toContain('TorrServer прямо на телефоне');
    expect(t).toContain('OMP запустит встроенный сервер. Телевизор найдёт его сам, пока телефон в той же сети Wi‑Fi.');
    expect(t).not.toContain('Искать в сети ещё раз');
    await act(async () => btn(el, 'Запустить TorrServer на телефоне').click());
    expect(currentRoute.value.name).toBe('localServer');
  });

  it('has no card on a phone without the embedded server', async () => {
    setServerScanner(async () => []);
    const el = mount();
    await flush();
    expect(el.textContent).not.toContain('TorrServer прямо на телефоне');
    expect(el.textContent).not.toContain('В сети не нашлось TorrServer');
  });

  it('has no card while a server was found', async () => {
    supportedDeps();
    setServerScanner(async () => [{ url: 'http://192.168.1.9:8090', version: 'MatriX.1' }]);
    localServer.value = { supported: true, running: false };
    const el = mount();
    await flush();
    expect(el.textContent).not.toContain('TorrServer прямо на телефоне');
    expect(el.textContent).toContain('192.168.1.9:8090');
  });

  it('has no card with saved servers', async () => {
    supportedDeps();
    setServerScanner(async () => []);
    addServer({ url: 'http://192.168.1.5:8090', name: 'Home' });
    localServer.value = { supported: true, running: false };
    mockFetch(() => ({ body: 'MatriX' }));
    const el = mount();
    await flush();
    expect(el.textContent).not.toContain('TorrServer прямо на телефоне');
  });

  it('scans again on request', async () => {
    supportedDeps();
    let n = 0;
    setServerScanner(async () => (n++, []));
    localServer.value = { supported: true, running: false };
    const el = mount();
    await flush();
    await act(async () => btn(el, 'Найти в сети').click());
    await flush();
    expect(n).toBe(2);
  });

  it('stops the scan when the screen goes away', async () => {
    supportedDeps();
    let cancelled: (() => boolean) | null = null;
    setServerScanner((isCancelled) => {
      cancelled = isCancelled;
      return new Promise(() => {});
    });
    localServer.value = { supported: true, running: false };
    const el = mount();
    await flush();
    expect(cancelled!()).toBe(false);
    act(() => render(null, el));
    expect(cancelled!()).toBe(true);
  });
});

describe('Connect screen: find in the network', () => {
  const HINT =
    'Не находится? Проверьте, что оба устройства в одной сети Wi‑Fi, VPN выключен или разрешает локальную сеть, а в роутере выключена изоляция клиентов (гостевая сеть).';

  it('shows the button with saved servers on a phone without the embedded server and scans on tap', async () => {
    mockFetch(() => ({ body: 'MatriX' }));
    addServer({ url: 'http://192.168.1.5:8090', name: 'Home' });
    let n = 0;
    setServerScanner(async () => (n++, [{ url: 'http://192.168.1.9:8090', version: 'MatriX.1' }]));
    const el = mount();
    await flush();
    expect(n).toBe(0);
    await act(async () => btn(el, 'Найти в сети').click());
    await flush();
    expect(n).toBe(1);
    expect(el.textContent).toContain('Найдено в сети');
    expect(el.textContent).toContain('192.168.1.9:8090');
    expect(el.textContent).not.toContain('Не находится?');
  });

  it('disables the button and says «Ищу…» while scanning', async () => {
    mockFetch(() => ({ body: 'MatriX' }));
    addServer({ url: 'http://192.168.1.5:8090', name: 'Home' });
    setServerScanner(() => new Promise(() => {}));
    const el = mount();
    await flush();
    await act(async () => btn(el, 'Найти в сети').click());
    const b = btn(el, 'Ищу…');
    expect(b.disabled).toBe(true);
  });

  it('marks found servers that are saved and opens the saved entry on tap', async () => {
    mockFetch(() => ({ body: 'MatriX' }));
    addServer({ url: 'http://192.168.1.9:8090', name: 'Кухня', user: 'u', password: 'p' });
    setServerScanner(async () => [{ url: 'http://192.168.1.9:8090', version: 'MatriX.1' }]);
    const el = mount();
    await flush();
    await act(async () => btn(el, 'Найти в сети').click());
    await flush();
    const row = Array.from(el.querySelectorAll('.m-list')).find((l) => l.previousElementSibling?.textContent === 'Найдено в сети')!;
    expect(row.textContent).toContain('сохранён');
    await act(async () => (row.querySelector('.m-server') as HTMLButtonElement).click());
    await flush();
    expect(servers.value).toHaveLength(1);
    expect(activeServer.value?.name).toBe('Кухня');
    expect(currentRoute.value.name).toBe('library');
  });

  it('shows the troubleshooting hint after an empty scan', async () => {
    mockFetch(() => ({ body: 'MatriX' }));
    addServer({ url: 'http://192.168.1.5:8090', name: 'Home' });
    setServerScanner(async () => []);
    const el = mount();
    await flush();
    expect(el.textContent).not.toContain(HINT);
    await act(async () => btn(el, 'Найти в сети').click());
    await flush();
    expect(el.textContent).toContain(HINT);
  });

  it('shows the hint after a manual connect fails with a network error, not on a server error', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fail')));
    const el = mount();
    type(el.querySelector<HTMLInputElement>('#addr')!, '10.0.0.1');
    await act(async () => btn(el, 'Подключиться').click());
    await flush();
    expect(el.querySelector('.m-error')?.textContent).toBe('Сервер недоступен');
    expect(el.textContent).toContain(HINT);
    mockFetch(() => ({ status: 500, body: 'x' }));
    await act(async () => btn(el, 'Подключиться').click());
    await flush();
    expect(el.textContent).not.toContain(HINT);
  });
});

describe('Connect screen: hint on timeout', () => {
  it('shows the hint when the manual connect times out', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', () => new Promise(() => {}));
      const el = mount();
      type(el.querySelector<HTMLInputElement>('#addr')!, '10.0.0.1');
      await act(async () => btn(el, 'Подключиться').click());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });
      expect(el.querySelector('.m-error')?.textContent).toBe('Сервер не отвечает');
      expect(el.textContent).toContain('Не находится?');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('scanLan', () => {
  it('scans only the own /24 of the phone when its address is known', async () => {
    const calls: any[] = [];
    const isCancelled = () => false;
    await scanLan(isCancelled, {
      localIp: async () => '10.0.5.23',
      discover: async (o) => (calls.push(o), []),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].subnets).toEqual(['10.0.5']);
    expect(calls[0].ports).toEqual([8090, 5665]);
    expect(calls[0].isCancelled).toBe(isCancelled);
  });

  it('falls back to the common home subnets without an address', async () => {
    const calls: any[] = [];
    await scanLan(() => false, { localIp: async () => null, discover: async (o) => (calls.push(o), []) });
    await scanLan(() => false, {
      localIp: async () => {
        throw new Error('no wifi');
      },
      discover: async (o) => (calls.push(o), []),
    });
    expect(calls.map((c) => c.subnets)).toEqual([
      ['192.168.1', '192.168.0'],
      ['192.168.1', '192.168.0'],
    ]);
  });
});

describe('Connect screen in English', () => {
  beforeEach(() => applyLanguageSetting('en'));
  afterEach(() => applyLanguageSetting('ru'));
  const supportedDeps = () =>
    setLocalServerDeps({ native: { localServerInfo: async () => ({ supported: true, running: false }) } as any });

  it('form, login block and QR', async () => {
    mockFetch(() => ({ body: 'MatriX' }));
    addServer({ url: 'http://192.168.1.5:8090', name: 'Home' });
    const el = mount();
    await flush();
    expect(el.querySelector('h1')!.textContent).toBe('Connect to TorrServer');
    expect(el.querySelector('label[for=addr]')!.textContent).toBe('Server address');
    expect(btn(el, 'Connect')).toBeTruthy();
    expect(btn(el, 'Find on network')).toBeTruthy();
    expect(btn(el, 'Scan the QR from the TV')).toBeTruthy();
    expect(el.textContent).toContain('On the TV: OMP → Settings → “Connect phone”.');
    expect(el.textContent).toContain('Saved servers');
    expect(el.textContent).toContain('192.168.1.5:8090 · online · MatriX');
    expect(el.querySelector('[aria-label="Rename Home"]')).toBeTruthy();
    await act(async () => btn(el, 'Login and password').click());
    expect(el.querySelector('label[for=user]')!.textContent).toBe('Login');
    expect(el.querySelector('label[for=pass]')!.textContent).toBe('Password');
    expect(el.textContent).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('empty address and the toast after a scanned QR', async () => {
    mockFetch(() => ({ body: 'MatriX' }));
    setQrScanner(async () => ({ url: 'http://192.168.1.10:8090', name: 'Home' }));
    const el = mount();
    await act(async () => btn(el, 'Connect').click());
    expect(el.querySelector('.m-error')!.textContent).toBe('Enter the server address');
    await act(async () => btn(el, 'Scan the QR from the TV').click());
    await flush();
    expect(toast.value).toBe('Server “Home” added');
  });

  it('the card with the phone server after an empty scan', async () => {
    supportedDeps();
    setServerScanner(async () => []);
    localServer.value = { supported: true, running: false };
    const el = mount();
    await flush();
    const t = el.textContent!;
    expect(t).toContain('No TorrServer found on the network');
    expect(t).toContain('TorrServer right on the phone');
    expect(t).toContain('Not found? Check that both devices are on the same Wi‑Fi network');
    expect(btn(el, 'Start TorrServer on the phone')).toBeTruthy();
    expect(t).not.toMatch(/[А-Яа-яЁё]/);
  });
});

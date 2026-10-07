import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { ConnectScreen, CONNECT_TIMEOUT_MS, connectEcho, connectErrorText } from '../../src/screens/Connect';
import type { TorrServerClient } from '../../src/api/torrserver';
import { servers, activeServerId, addServer } from '../../src/store/servers';
import { mockFetch } from '../helpers/fetchMock';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  activeServerId.value = null;
  mockFetch(() => ({ body: 'MatriX.145.1' }));
});

function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(h(ConnectScreen, {}), host);
  return host;
}

describe('ConnectScreen', () => {
  it('keeps the boot-check class and hides history without saved servers', () => {
    const host = mount();
    expect(host.querySelector('.screen.connect')).not.toBeNull();
    expect(host.querySelector('.history-btn')).toBeNull();
    expect(host.querySelectorAll('.connect-card input')).toHaveLength(1);
  });
  it('the address field asks for the URL keyboard: Latin, no capitals or corrections', () => {
    const host = mount();
    const input = host.querySelector('.connect-card input') as HTMLInputElement;
    expect(input.getAttribute('type')).toBe('url');
    expect(input.getAttribute('inputmode')).toBe('url');
    expect(input.getAttribute('autocapitalize')).toBe('off');
    expect(input.getAttribute('autocorrect')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('lang')).toBe('en');
  });
  it('reveals login and password under «Дополнительно»', async () => {
    const host = mount();
    (host.querySelector('.link-toggle') as HTMLElement).click();
    await Promise.resolve();
    expect(host.querySelectorAll('.connect-card input')).toHaveLength(3);
  });
  it('opens the server history with a card per server and an edit dialog', async () => {
    addServer({ url: '192.168.1.191:5665', name: 'Дом' });
    addServer({ url: '10.0.0.12:8090', name: 'Дача' });
    const host = mount();
    expect(host.querySelector('.history-count')!.textContent).toBe('2');
    (host.querySelector('.history-btn') as HTMLElement).click();
    await Promise.resolve();
    const cards = host.querySelectorAll('.hist-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('.hist-name')!.textContent).toContain('Дом');
    (cards[1].querySelector('.button') as HTMLElement).click();
    await Promise.resolve();
    expect(host.querySelector('.edit-server .dialog-title')!.textContent).toBe('Изменить сервер');
    expect((host.querySelector('.edit-server input') as HTMLInputElement).value).toBe('Дача');
  });
});

describe('ConnectScreen: a server that does not answer', () => {
  const flush = async () => {
    for (let r = 0; r < 4; r++) {
      for (let i = 0; i < 30; i++) await Promise.resolve();
      await new Promise((res) => setTimeout(res, 0));
    }
  };
  it('says which address failed under the buttons; the button stays enabled', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const host = mount();
    const input = host.querySelector('.connect-card input') as HTMLInputElement;
    input.value = '192.168.1.191:8090';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    const btn = () => host.querySelector('[data-fk="connect-btn"], .button.primary') as HTMLElement;
    btn().click();
    await flush();
    expect(host.querySelector('.connect-error')!.textContent).toBe('Не удалось подключиться к 192.168.1.191:8090 — проверьте адрес и порт');
    expect(btn().textContent).toBe('Подключиться');
    expect(btn().className).not.toContain('disabled');
    expect(servers.value).toHaveLength(0);
  });

  it('a server that never answers is given up with a timeout', async () => {
    vi.useFakeTimers();
    try {
      const client = { echo: () => new Promise<string>(() => undefined) } as unknown as TorrServerClient;
      const seen = connectEcho(client, CONNECT_TIMEOUT_MS).then(
        () => 'ok',
        (e: { kind?: string }) => e.kind,
      );
      vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
      expect(await seen).toBe('timeout');
      expect(connectErrorText('http://10.0.0.5:8091', { kind: 'timeout', message: 'Timeout' })).toBe(
        'Не удалось подключиться к 10.0.0.5:8091 — проверьте адрес и порт',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ConnectScreen: a typed address with look-alikes, the VPN hint', () => {
  const flush = async () => {
    for (let r = 0; r < 4; r++) {
      for (let i = 0; i < 30; i++) await Promise.resolve();
      await new Promise((res) => setTimeout(res, 0));
    }
  };
  const w = window as unknown as { Capacitor?: unknown };
  afterEach(() => { delete w.Capacitor; });
  const type = async (host: HTMLElement, text: string) => {
    const input = host.querySelector('.connect-card input') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    (host.querySelector('.button.primary') as HTMLElement).click();
    await flush();
    return input;
  };
  const androidTv = (vpnState?: () => Promise<unknown>) => {
    const plugin: Record<string, unknown> = { localIpv4: () => Promise.resolve({ ip: null }), addListener: () => Promise.resolve({ remove() {} }) };
    if (vpnState) plugin.vpnState = vpnState;
    w.Capacitor = { getPlatform: () => 'android', Plugins: { OmpNative: plugin } };
  };

  it('a full-width colon and an NBSP are cleaned: it connects and the field shows the clean address', async () => {
    const seen: string[] = [];
    mockFetch((u: string) => { seen.push(u); return { body: 'MatriX.145.1' }; });
    const host = mount();
    const input = await type(host, '192.168.1.124\uFF1A8090\u00A0');
    expect(seen[0]).toBe('http://192.168.1.124:8090/echo');
    expect(input.value).toBe('192.168.1.124:8090');
    expect(servers.value.map((s) => s.url)).toEqual(['http://192.168.1.124:8090']);
  });

  it('a character no address has is named and nothing is requested', async () => {
    const seen: string[] = [];
    mockFetch((u: string) => { seen.push(u); return { body: 'x' }; });
    const host = mount();
    await type(host, '192.168.1.124;8090');
    expect(host.querySelector('.connect-error')!.textContent).toBe('В адресе есть недопустимый символ: «;»');
    expect(seen).toHaveLength(0);
  });

  it('Android TV with a VPN: the failure says to exclude OMP or bypass the LAN', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    androidTv(() => Promise.resolve({ active: true }));
    const host = mount();
    await type(host, '192.168.1.124:8090');
    expect(host.querySelector('.connect-net-hint')!.textContent).toContain('На телевизоре работает VPN');
  });

  it('Android TV without a VPN: the always-on / block note', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    androidTv(() => Promise.resolve({ active: false }));
    const host = mount();
    await type(host, '192.168.1.124:8090');
    expect(host.querySelector('.connect-net-hint')!.textContent).toContain('Блокировать соединения без VPN');
  });

  it('LG (no plugin) and an APK without vpnState: no hint', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    let host = mount();
    await type(host, '192.168.1.124:8090');
    expect(host.querySelector('.connect-error')).not.toBeNull();
    expect(host.querySelector('.connect-net-hint')).toBeNull();
    androidTv();
    host = mount();
    await type(host, '192.168.1.124:8090');
    expect(host.querySelector('.connect-net-hint')).toBeNull();
  });
});

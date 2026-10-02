import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { PairPhoneScreen } from '../../src/screens/PairPhone';
import { Qr } from '../../src/ui/Qr';
import { buildPairUri } from '../../src/lib/pairing';
import { servers, activeServerId, addServer, setActiveServer } from '../../src/store/servers';
import { attachPhone, detachPhone, setLinkTransport } from '../../src/phone/link';
import { currentRoute, resetTo } from '../../src/ui/nav';
import { act } from 'preact/test-utils';
import { ToastHost } from '../../src/ui/toast';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  activeServerId.value = null;
});

function mount(node: any) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(node, host);
  return host;
}

describe('PairPhoneScreen', () => {
  it('shows the server QR and the steps', () => {
    const s = addServer({ url: '192.168.1.191:5665', name: 'Дом', user: 'admin', password: 'p&s s' });
    setActiveServer(s.id);
    const host = mount(h(PairPhoneScreen, {}));
    const svg = host.querySelector('svg.qr') as SVGElement;
    expect(svg).not.toBeNull();
    const ref = mount(h(Qr, { text: buildPairUri({ url: s.url, name: s.name, user: 'admin', password: 'p&s s' }), size: 360 }));
    expect(svg.querySelector('path')!.getAttribute('d')).toBe(ref.querySelector('path')!.getAttribute('d'));
    expect(host.textContent).toContain('Сканировать QR с телевизора');
  });
  it('asks to connect first without a server', () => {
    const host = mount(h(PairPhoneScreen, {}));
    expect(host.querySelector('svg.qr')).toBeNull();
    expect(host.textContent).toContain('Сначала подключитесь к серверу');
  });
  it('returns to the catalog once a phone links to the TV', async () => {
    const s = addServer({ url: '192.168.1.191:5665' });
    setActiveServer(s.id);
    setLinkTransport(() => new Promise<string>(() => {}));
    try {
      attachPhone('http://192.168.1.50:4000/omp/a');
      resetTo({ name: 'pairPhone' } as any);
      mount(h(PairPhoneScreen, {}));
      expect(currentRoute.value.name).toBe('pairPhone');
      await act(async () => attachPhone('http://192.168.1.60:4000/omp/b'));
      expect(currentRoute.value.name).toBe('library');
    } finally {
      detachPhone();
      setLinkTransport(null);
    }
  });
});

describe('PairPhoneScreen on Android TV', () => {
  const w = window as unknown as { Capacitor?: unknown };
  const hosts: HTMLElement[] = [];
  function fakePlugin(codes: { code: string; expiresAt: number }[]) {
    const listeners: { [e: string]: ((d: any) => void)[] } = {};
    let i = 0;
    const plugin = {
      localIpv4: vi.fn(() => Promise.resolve({ ip: null })),
      pairingCode: vi.fn(() => Promise.resolve(codes[Math.min(i++, codes.length - 1)])),
      tvName: vi.fn(() => Promise.resolve({ name: 'Гостиная' })),
      clearPairingCode: vi.fn(() => Promise.resolve()),
      addListener: vi.fn((e: string, cb: (d: any) => void) => {
        (listeners[e] = listeners[e] || []).push(cb);
        return Promise.resolve({ remove: () => { listeners[e] = listeners[e].filter((x) => x !== cb); } });
      }),
    };
    w.Capacitor = { getPlatform: () => 'android', Plugins: { OmpNative: plugin } };
    return { plugin, emit: (e: string, d: any) => (listeners[e] || []).slice().forEach((cb) => cb(d)) };
  }
  function mountTracked(node: any) {
    const host = mount(node);
    hosts.push(host);
    return host;
  }
  // Preact 11 runs effects after paint (up to ~35 ms)
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  const digits = (host: HTMLElement) => Array.from(host.querySelectorAll('.pair-digit')).map((d) => d.textContent).join('');
  afterEach(() => {
    hosts.splice(0).forEach((h) => render(null, h));
    delete w.Capacitor;
  });

  it('shows the QR and the remote code block', async () => {
    const s = addServer({ url: '192.168.1.191:5665' });
    setActiveServer(s.id);
    fakePlugin([{ code: '4821', expiresAt: Date.now() + 300000 }]);
    const host = mountTracked(h(PairPhoneScreen, {}));
    await settle();
    expect(host.querySelector('svg.qr')).not.toBeNull();
    expect(digits(host)).toBe('4821');
    const text = host.textContent!;
    expect(text).toContain('Код для пульта на телефоне');
    expect(text).toContain('На телефоне: OMP → Телевизор → «Гостиная» → введите код');
    expect(text).toContain('Код действует 5 минут');
    expect(text).toContain('Готово');
    expect(text).toContain('Новый код');
  });

  it('shows the code without a server too', async () => {
    fakePlugin([{ code: '0007', expiresAt: Date.now() + 300000 }]);
    const host = mountTracked(h(PairPhoneScreen, {}));
    await settle();
    expect(host.querySelector('svg.qr')).toBeNull();
    expect(digits(host)).toBe('0007');
  });

  it('«Новый код» asks for a new code', async () => {
    const f = fakePlugin([{ code: '1111', expiresAt: Date.now() + 300000 }, { code: '2222', expiresAt: Date.now() + 300000 }]);
    const host = mountTracked(h(PairPhoneScreen, {}));
    await settle();
    expect(digits(host)).toBe('1111');
    const btn = Array.from(host.querySelectorAll('.button')).find((b) => b.textContent === 'Новый код') as HTMLElement;
    await act(async () => { btn.click(); });
    await settle();
    expect(f.plugin.pairingCode).toHaveBeenCalledTimes(2);
    expect(digits(host)).toBe('2222');
  });

  it('refreshes the code when it expires', async () => {
    const f = fakePlugin([{ code: '1111', expiresAt: Date.now() + 10 }, { code: '3333', expiresAt: Date.now() + 300000 }]);
    const host = mountTracked(h(PairPhoneScreen, {}));
    await settle();
    expect(digits(host)).toBe('1111');
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    await settle();
    expect(f.plugin.pairingCode).toHaveBeenCalledTimes(2);
    expect(digits(host)).toBe('3333');
  });

  it('a paired phone shows the toast and returns to the catalog', async () => {
    const s = addServer({ url: '192.168.1.191:5665' });
    setActiveServer(s.id);
    const f = fakePlugin([{ code: '4821', expiresAt: Date.now() + 300000 }]);
    resetTo({ name: 'pairPhone' } as any);
    const toasts = mountTracked(h(ToastHost, {}));
    mountTracked(h(PairPhoneScreen, {}));
    await settle();
    await act(async () => f.emit('phonePaired', { phone: 'Pixel' }));
    expect(currentRoute.value.name).toBe('library');
    expect(toasts.textContent).toContain('Телефон подключён');
  });

  it('shows why there is no code when the control server did not start', async () => {
    const f = fakePlugin([]);
    f.plugin.pairingCode.mockImplementation(() => Promise.reject({ message: 'Сервер управления не запустился' }));
    const host = mountTracked(h(PairPhoneScreen, {}));
    await settle();
    expect(host.textContent).toContain('Сервер управления не запустился');
    expect(host.querySelectorAll('.pair-digit').length).toBe(0);
  });

  it('a non-Russian rejection gets the generic text', async () => {
    const f = fakePlugin([]);
    f.plugin.pairingCode.mockImplementation(() => Promise.reject(new Error('boom')));
    const host = mountTracked(h(PairPhoneScreen, {}));
    await settle();
    expect(host.textContent).toContain('Не удалось получить код');
  });

  it('leaving the screen invalidates the code', async () => {
    const f = fakePlugin([{ code: '4821', expiresAt: Date.now() + 300000 }]);
    const host = mountTracked(h(PairPhoneScreen, {}));
    await settle();
    expect(f.plugin.clearPairingCode).not.toHaveBeenCalled();
    await act(async () => { render(null, host); });
    await settle();
    expect(f.plugin.clearPairingCode).toHaveBeenCalledTimes(1);
  });

  it('a failed code request is reported', async () => {
    fakePlugin([]);
    const host = mountTracked(h(PairPhoneScreen, {}));
    await settle();
    expect(host.textContent).toContain('Не удалось получить код');
  });
});

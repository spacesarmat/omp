import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Settings, setUpdateChecker } from '../src/screens/Settings';
import { currentRoute, resetTo } from '../src/nav';
import { settings, updateSettings } from '../../src/store/settings';
import { addServer, setActiveServer, removeServer, servers } from '../../src/store/servers';
import { ANDROID_UPDATE_URL } from '../../src/lib/updateInfo';
import { APP_VERSION } from '../../src/version';
import { toast } from '../src/ui/toast';
import { localServer, localAutostart, setLocalServerDeps, reloadLocalServerSettings } from '../src/server/localServer';

function mount(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  act(() => render(<Settings />, el));
  return el;
}
const btn = (el: HTMLElement, t: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent === t)!;

beforeEach(() => {
  localStorage.clear();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(null);
  updateSettings({ updateCheck: true });
  toast.value = '';
  setUpdateChecker(null);
  resetTo({ name: 'settings' });
  reloadLocalServerSettings();
  localServer.value = { supported: false, running: false };
});

afterEach(() => setLocalServerDeps(null));

describe('Settings', () => {
  it('shows version, server and navigates', async () => {
    const s = addServer({ url: 'http://192.168.1.5:8090', name: 'Home' });
    setActiveServer(s.id);
    const el = mount();
    expect(el.textContent).toContain(APP_VERSION);
    expect(el.textContent).toContain('Home');
    await act(async () => btn(el, 'Сменить').click());
    expect(currentRoute.value.name).toBe('connect');
    resetTo({ name: 'settings' });
    await act(async () => btn(el, 'Выбрать').click());
    expect(currentRoute.value.name).toBe('tv');
  });

  it('manual check uses the Android feed and toasts the result', async () => {
    const urls: (string | undefined)[] = [];
    const manual: boolean[] = [];
    setUpdateChecker(async (o) => {
      urls.push(o.url);
      manual.push(o.manual);
      return 'latest';
    });
    const el = mount();
    await act(async () => btn(el, 'Проверить обновления').click());
    await act(async () => {});
    expect(urls).toEqual([ANDROID_UPDATE_URL]);
    expect(manual).toEqual([true]);
    expect(toast.value).toBe('У вас последняя версия');
    setUpdateChecker(async () => 'error');
    await act(async () => btn(el, 'Проверить обновления').click());
    await act(async () => {});
    expect(toast.value).toBe('Не удалось проверить обновления');
  });

  it('toggles check on start', async () => {
    const el = mount();
    const sw = el.querySelector<HTMLElement>('[role="switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await act(async () => sw.click());
    expect(settings.value.updateCheck).toBe(false);
  });

  it('opens the project page externally', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const el = mount();
    await act(async () => btn(el, 'Страница проекта').click());
    expect(open).toHaveBeenCalledWith('https://github.com/spacesarmat/omp', '_system');
    open.mockRestore();
  });
});

describe('Settings: TorrServer on the phone', () => {
  function fake(state: { running: boolean }, cache = { bytes: 412 * 1024 * 1024 }) {
    const calls: string[] = [];
    setLocalServerDeps({
      native: {
        async localServerInfo() {
          return state.running
            ? { supported: true, running: true, version: 'MatriX.145.1', ip: '192.168.1.50' }
            : { supported: true, running: false };
        },
        async startLocalServer() {
          calls.push('start');
          state.running = true;
          return { supported: true, running: true };
        },
        async stopLocalServer() {
          calls.push('stop');
          state.running = false;
        },
        async localServerCache() {
          return cache.bytes;
        },
        async clearLocalServerCache() {
          calls.push('clear');
          cache.bytes = 0;
        },
        onLocalServerState: () => () => {},
      } as any,
    });
    return calls;
  }
  const flush = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

  it('is hidden when the phone does not support the server', async () => {
    const el = mount();
    await flush();
    expect(el.textContent).not.toContain('TorrServer на телефоне');
  });

  it('shows status, cache and the notes', async () => {
    fake({ running: true });
    localServer.value = { supported: true, running: true };
    const el = mount();
    await flush();
    const t = el.textContent!;
    expect(t).toContain('Работает');
    expect(t).toContain('MatriX.145.1 · 192.168.1.50:8090');
    expect(t).toContain('Кэш на телефоне');
    expect(t).toContain('Занято 412 МБ из 1 ГБ');
    expect(t).toContain('Новая версия сервера приходит вместе с обновлением OMP');
    expect(t).toContain('Сервер доступен всем устройствам в этой сети Wi‑Fi');
  });

  it('switch starts and stops the server', async () => {
    const calls = fake({ running: false });
    localServer.value = { supported: true, running: false };
    const el = mount();
    await flush();
    expect(el.textContent).toContain('Остановлен');
    await act(async () => el.querySelector<HTMLElement>('[aria-label="TorrServer на телефоне"]')!.click());
    await flush();
    expect(calls).toEqual(['start']);
    expect(el.textContent).toContain('Работает');
    await act(async () => el.querySelector<HTMLElement>('[aria-label="TorrServer на телефоне"]')!.click());
    await flush();
    expect(calls).toEqual(['start', 'stop']);
    expect(el.textContent).toContain('Остановлен');
  });

  it('toggles autostart', async () => {
    fake({ running: false });
    localServer.value = { supported: true, running: false };
    const el = mount();
    await flush();
    await act(async () => el.querySelector<HTMLElement>('[aria-label="Запускать вместе с OMP"]')!.click());
    expect(localAutostart.value).toBe(true);
    expect(JSON.parse(localStorage.getItem('tsp.localServer')!)).toEqual({ autostart: true });
  });

  it('clears the cache and re-reads its size', async () => {
    const calls = fake({ running: true });
    localServer.value = { supported: true, running: true };
    const el = mount();
    await flush();
    await act(async () => btn(el, 'Очистить').click());
    await flush();
    expect(calls).toContain('clear');
    expect(el.textContent).toContain('Занято 0 МБ из 1 ГБ');
  });
});

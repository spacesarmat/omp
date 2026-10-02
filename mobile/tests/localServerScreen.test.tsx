import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { LocalServer } from '../src/screens/LocalServer';
import { setLocalServerDeps, localServer, reloadLocalServerSettings } from '../src/server/localServer';
import { currentRoute, resetTo } from '../src/nav';
import { activeServer, setActiveServer, removeServer, servers } from '../../src/store/servers';

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

function mount(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  act(() => render(<LocalServer />, el));
  return el;
}

function deps(over: { echoFails?: number } = {}) {
  let fails = over.echoFails ?? 0;
  let running = false;
  return {
    native: {
      async localServerInfo() {
        return running
          ? { supported: true, running, version: 'MatriX.145.1', ip: '192.168.1.50' }
          : { supported: true, running };
      },
      async startLocalServer() {
        running = true;
        return { supported: true, running };
      },
      async stopLocalServer() {},
      async localServerCache() {
        return 0;
      },
      async clearLocalServerCache() {},
      onLocalServerState: () => () => {},
    } as any,
    echo: async () => {
      if (fails-- > 0) throw new Error('Сервер не отвечает');
      return 'MatriX.145.1';
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(null);
  reloadLocalServerSettings();
  localServer.value = { supported: true, running: false };
  resetTo({ name: 'connect' });
});
afterEach(() => setLocalServerDeps(null));

describe('LocalServer screen', () => {
  it('walks the steps, shows the address and opens the catalog', async () => {
    setLocalServerDeps(deps());
    const el = mount();
    await flush();
    const text = el.textContent!;
    expect(text).toContain('TorrServer на телефоне');
    expect(text).toContain('Подготовка сервера MatriX.145.1');
    expect(text).toContain('Запуск в фоне');
    expect(text).toContain('Проверка связи');
    expect(text).toContain('Подключение OMP');
    expect(el.querySelectorAll('.m-step.ok')).toHaveLength(4);
    expect(text).toContain('Адрес для телевизора');
    expect(text).toContain('192.168.1.50:8090');
    expect(text).toContain('На ТВ: Вход → «Найти в сети». Сервер работает, пока телефон включён и в этой сети Wi‑Fi.');
    expect(activeServer.value).toMatchObject({ name: 'Этот телефон', url: 'http://127.0.0.1:8090' });
    const open = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Открыть каталог')!;
    await act(async () => open.click());
    expect(currentRoute.value.name).toBe('library');
  });

  it('shows the error at the failing step and retries', async () => {
    setLocalServerDeps(deps({ echoFails: 1 }));
    const el = mount();
    await flush();
    expect(el.querySelector('.m-error')?.textContent).toBe('Сервер не отвечает');
    expect(el.querySelector('.m-step.fail')?.textContent).toContain('Проверка связи');
    expect(el.textContent).not.toContain('Открыть каталог');
    const retry = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Повторить')!;
    await act(async () => retry.click());
    await flush();
    expect(el.querySelector('.m-error')).toBeNull();
    expect(el.textContent).toContain('Открыть каталог');
    expect(servers.value).toHaveLength(1);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { ServerSettings } from '../src/screens/ServerSettings';
import { Settings } from '../src/screens/Settings';
import { currentRoute, resetTo } from '../src/nav';
import { toast } from '../src/ui/toast';
import { addServer, setActiveServer, removeServer, servers } from '../../src/store/servers';
import { localServer } from '../src/server/localServer';
import { mockFetch } from '../../tests/helpers/fetchMock';

const MB = 1024 * 1024;
const BASE = {
  CacheSize: 64 * MB,
  PreloadCache: 50,
  ReaderReadAHead: 95,
  ConnectionsLimit: 25,
  DownloadRateLimit: 0,
  UploadRateLimit: 1024,
  TorrentDisconnectTimeout: 30,
  TrackTimecode: false,
  UseDisk: false,
  TorrentsSavePath: '/data/x',
  Unknown: 'keep',
};

let el: HTMLElement;
let posts: any[];
let current: any;
let failSet: boolean;

function setup(url = 'http://192.168.1.5:8090', getFails = false) {
  posts = [];
  current = { ...BASE };
  failSet = false;
  let getCalls = 0;
  mockFetch((_u, init) => {
    const body = JSON.parse(init.body);
    posts.push(body);
    if (body.action === 'get') {
      getCalls++;
      if (getFails && getCalls === 1) return { status: 500, body: 'boom' };
      return { body: JSON.stringify(current) };
    }
    if (body.action === 'set') {
      if (failSet) return { status: 500, body: 'нет места' };
      current = body.sets;
      return { body: '{}' };
    }
    current = { ...BASE, CacheSize: 128 * MB };
    return { body: '{}' };
  });
  const s = addServer({ url, name: 'Home' });
  setActiveServer(s.id);
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}
async function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<ServerSettings />, el));
  await flush();
}
const btn = (t: string, root: ParentNode = el) => Array.from(root.querySelectorAll('button')).find((b) => (b.textContent || '').includes(t))!;
const sets = () => posts.filter((p) => p.action === 'set');

beforeEach(() => {
  localStorage.clear();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(null);
  toast.value = '';
  localServer.value = { supported: false, running: false };
  resetTo({ name: 'serverSettings' });
});
afterEach(() => vi.unstubAllGlobals());

describe('ServerSettings', () => {
  it('shows the server name and current values', async () => {
    setup();
    await mount();
    expect(el.textContent).toContain('Настройки сервера');
    expect(el.textContent).toContain('Home');
    expect(btn('Размер кэша').textContent).toContain('64 МБ');
    expect(btn('Предзагрузка').textContent).toContain('50%');
    expect(btn('Ограничение загрузки').textContent).toContain('Без ограничений');
    expect(btn('Ограничение отдачи').textContent).toContain('1 МБ/с');
    expect(el.querySelector('[aria-label="Сохранять тайм-коды на сервере"]')!.getAttribute('aria-checked')).toBe('false');
  });

  it('a change saves the full merged settings and toasts', async () => {
    setup();
    await mount();
    act(() => btn('Размер кэша').click());
    const sheet = el.querySelector('[role="dialog"]')!;
    expect(btn('64 МБ', sheet).getAttribute('aria-checked')).toBe('true');
    await act(async () => btn('512 МБ', sheet).click());
    await flush();
    expect(sets()).toHaveLength(1);
    expect(sets()[0].sets).toEqual({ ...BASE, CacheSize: 512 * MB });
    expect(toast.value).toBe('Сохранено');
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(btn('Размер кэша').textContent).toContain('512 МБ');
  });

  it('the timecode switch saves immediately', async () => {
    setup();
    await mount();
    await act(async () => (el.querySelector('[aria-label="Сохранять тайм-коды на сервере"]') as HTMLElement).click());
    await flush();
    expect(sets()[0].sets.TrackTimecode).toBe(true);
    expect(toast.value).toBe('Сохранено');
  });

  it('a failed save reverts the row and shows the error', async () => {
    setup();
    await mount();
    failSet = true;
    act(() => btn('Предзагрузка').click());
    await act(async () => btn('95%', el.querySelector('[role="dialog"]')!).click());
    await flush();
    expect(toast.value).toBe('Ошибка сервера (500)');
    expect(btn('Предзагрузка').textContent).toContain('50%');
  });

  it('reset asks first, then resets and reloads', async () => {
    setup();
    await mount();
    act(() => btn('Сбросить к стандартным').click());
    expect(posts.some((p) => p.action === 'def')).toBe(false);
    await act(async () => btn('Сбросить', el.querySelector('[role="dialog"]')!).click());
    await flush();
    expect(posts.some((p) => p.action === 'def')).toBe(true);
    expect(btn('Размер кэша').textContent).toContain('128 МБ');
  });

  it('cancelling the reset does nothing', async () => {
    setup();
    await mount();
    act(() => btn('Сбросить к стандартным').click());
    act(() => btn('Отмена', el.querySelector('[role="dialog"]')!).click());
    expect(posts.some((p) => p.action === 'def')).toBe(false);
  });

  it('shows the load error and retries', async () => {
    setup('http://192.168.1.5:8090', true);
    await mount();
    expect(el.textContent).toContain('Не удалось загрузить настройки сервера');
    await act(async () => btn('Повторить').click());
    await flush();
    expect(btn('Размер кэша')).toBeTruthy();
  });

  it('the disk cache row is only for the embedded server', async () => {
    setup();
    await mount();
    expect(el.querySelector('[aria-label="Кэш на диске телефона"]')).toBeNull();
    setup('http://127.0.0.1:8090');
    await mount();
    const sw = el.querySelector('[aria-label="Кэш на диске телефона"]') as HTMLElement;
    expect(sw).toBeTruthy();
    await act(async () => sw.click());
    await flush();
    expect(sets()[0].sets.UseDisk).toBe(true);
    expect(sets()[0].sets.TorrentsSavePath).toBe('/data/x');
    expect(el.querySelectorAll('button[data-field="CacheSize"]')).toHaveLength(1);
  });
});

describe('Settings entry', () => {
  it('opens the server settings for the active server', async () => {
    setup();
    document.body.innerHTML = '<div id="app"></div>';
    el = document.getElementById('app')!;
    act(() => render(<Settings />, el));
    await act(async () => btn('Настройки сервера').click());
    expect(currentRoute.value.name).toBe('serverSettings');
  });
});

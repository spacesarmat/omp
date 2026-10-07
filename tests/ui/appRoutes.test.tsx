import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { App } from '../../src/app';
import { routeStack, openPlayer, routeKey } from '../../src/ui/nav';
import { servers, activeServerId } from '../../src/store/servers';
import { setCatalogProvider } from '../../src/catalog/activeCatalog';
import { reloadProgress } from '../../src/store/progress';
import type { PlayItem } from '../../src/player/types';

const w = window as unknown as { Capacitor?: unknown };
const q1: PlayItem[] = [{ url: 'http://h:1/one.mkv', title: 'Первый' }];
const q2: PlayItem[] = [{ url: 'http://h:1/two.mkv', title: 'Второй' }];

async function until(cond: () => boolean) {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(cond()).toBe(true);
}

let host: HTMLElement | null = null;
const closers: (() => void)[] = [];

function mountApp() {
  host = document.createElement('div');
  document.body.appendChild(host);
  render(h(App, {}), host);
  return host;
}

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  localStorage.clear();
  reloadProgress();
  servers.value = [];
  activeServerId.value = null;
});
afterEach(async () => {
  closers.splice(0).forEach((c) => c());
  if (host) render(null, host);
  host = null;
  await new Promise((r) => setTimeout(r, 60)); // Preact 11 runs unmount cleanups after paint
  delete w.Capacitor;
});

describe('App route host', () => {
  it('gives every route object its own key', () => {
    const a = { name: 'player' as const, queue: q1, index: 0 };
    const b = { name: 'player' as const, queue: q1, index: 0 };
    expect(routeKey(a)).toBe(routeKey(a));
    expect(routeKey(a)).not.toBe(routeKey(b));
  });

  it('androidtv: a player replaced by a player remounts and launches the new queue', async () => {
    const listeners: { [e: string]: ((d: any) => void)[] } = {};
    const plugin = {
      localIpv4: vi.fn(() => Promise.resolve({ ip: null })),
      downloadAndInstallApk: vi.fn(),
      playNative: vi.fn((_o: any) => Promise.resolve()),
      nativePlayerCommand: vi.fn(() => Promise.resolve()),
      addListener: vi.fn((e: string, cb: (d: any) => void) => {
        (listeners[e] = listeners[e] || []).push(cb);
        return Promise.resolve({ remove: () => { listeners[e] = listeners[e].filter((x) => x !== cb); } });
      }),
    };
    w.Capacitor = { getPlatform: () => 'android', Plugins: { OmpNative: plugin } };
    closers.push(() => (listeners.nativePlayerClosed || []).slice().forEach((cb) => cb({ index: 0, time: 0, duration: 0 })));
    routeStack.value = [{ name: 'library' }, { name: 'player', queue: q1, index: 0 }];
    mountApp();
    await until(() => plugin.playNative.mock.calls.length === 1);
    expect(plugin.playNative.mock.calls[0][0].queue[0].url).toBe(q1[0].url);
    openPlayer({ name: 'player', queue: q2, index: 0 });
    expect(routeStack.value.map((r) => r.name)).toEqual(['library', 'player']);
    await until(() => plugin.playNative.mock.calls.length === 2);
    expect(plugin.playNative.mock.calls[1][0].queue[0].url).toBe(q2[0].url);
  });

  it('webOS: a player replaced by a player remounts PlayerScreen with the new queue', async () => {
    routeStack.value = [{ name: 'library' }, { name: 'player', queue: q1, index: 0 }];
    const app = mountApp();
    await until(() => !!app.querySelector('video') && app.querySelector('video')!.getAttribute('src') === q1[0].url);
    const first = app.querySelector('video');
    openPlayer({ name: 'player', queue: q2, index: 0 });
    await until(() => !!app.querySelector('video') && app.querySelector('video')!.getAttribute('src') === q2[0].url);
    expect(app.querySelector('video')).not.toBe(first);
  });
});

describe('App person route', () => {
  it('renders the person screen for the person route', async () => {
    const stub = { person: vi.fn(() => Promise.resolve({ id: 7, name: 'Иван Тест', photo: '', birth: '', death: '', bio: '', known: 'acting', acting: [], directing: [] })) };
    setCatalogProvider(() => Promise.resolve(stub as any));
    routeStack.value = [{ name: 'library' }, { name: 'person', id: 7, label: 'Иван Тест' }];
    const app = mountApp();
    await until(() => !!app.querySelector('.person-name'));
    expect(stub.person).toHaveBeenCalledWith(7);
    expect(app.querySelector('.person-name')!.textContent).toBe('Иван Тест');
    setCatalogProvider(null);
  });
});

describe('App scale safety net', () => {
  it('androidtv: the .app root is scaled to the window width', async () => {
    const plugin = {
      localIpv4: vi.fn(() => Promise.resolve({ ip: null })),
      addListener: vi.fn(() => Promise.resolve({ remove: () => {} })),
    };
    w.Capacitor = { getPlatform: () => 'android', Plugins: { OmpNative: plugin } };
    routeStack.value = [{ name: 'connect' }];
    const app = mountApp();
    const root = app.querySelector('.app') as HTMLElement;
    await until(() => root.style.transform !== '');
    expect(root.style.transform).toBe('scale(' + window.innerWidth / 1920 + ')');
  });

  it('webOS: the .app root is never scaled', async () => {
    routeStack.value = [{ name: 'connect' }];
    const app = mountApp();
    await new Promise((r) => setTimeout(r, 30));
    expect((app.querySelector('.app') as HTMLElement).style.transform).toBe('');
  });
});

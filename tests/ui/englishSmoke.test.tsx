import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';

vi.mock('../../src/store/journal', async (orig) => ({
  ...(await orig<typeof import('../../src/store/journal')>()),
  loadSkip: vi.fn(() => Promise.resolve({ i: false, c: false })),
  saveSkip: vi.fn(),
  recordWatch: vi.fn(() => Promise.resolve()),
}));

import { ConnectScreen } from '../../src/screens/Connect';
import { SettingsScreen } from '../../src/screens/Settings';
import { UpdateScreen } from '../../src/screens/Update';
import { SourcesScreen } from '../../src/screens/Sources';
import { PlayerScreen } from '../../src/screens/Player';
import { DialogHost } from '../../src/ui/dialog';
import { ToastHost } from '../../src/ui/toast';
import { dispatchKey } from '../../src/ui/keys';
import { applyLanguageSetting } from '../../src/i18n';
import { servers, activeServerId } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { resetSettings } from '../../src/store/settings';
import { updatePrompt, latestUpdate } from '../../src/store/updates';
import { closeWhatsNew } from '../../src/store/whatsNew';
import { reloadProgress } from '../../src/store/progress';
import { routeStack } from '../../src/ui/nav';
import { TorrServerClient } from '../../src/api/torrserver';
import { mockFetch } from '../helpers/fetchMock';
import type { PlayItem } from '../../src/player/types';

const CYR = /[А-Яа-яЁё]/;
const noRussian = (host: HTMLElement) => (host.textContent || '').replace(/Русский/g, '');
const flush = () => act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); });
let host: HTMLElement;

function mount(node: any) {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(node, host));
  return host;
}

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => undefined;
});
beforeEach(() => {
  localStorage.clear();
  reloadProgress();
  servers.value = [];
  activeServerId.value = null;
  torrents.value = [];
  routeStack.value = [{ name: 'library' }];
  mockFetch(() => ({ body: '[]' }));
  applyLanguageSetting('en');
});
afterEach(() => {
  Array.from(document.body.children).forEach((c) => act(() => render(null, c)));
  document.body.innerHTML = '';
  resetSettings();
  updatePrompt.value = null;
  latestUpdate.value = null;
  closeWhatsNew();
  applyLanguageSetting('ru');
  vi.restoreAllMocks();
});

describe('TV screens in English: no Cyrillic', () => {
  it('Home (no server: the connect screen)', async () => {
    mount(h(ConnectScreen, {}));
    await flush();
    expect(noRussian(host).length).toBeGreaterThan(0);
    expect(noRussian(host)).not.toMatch(CYR);
  });
  it('Settings', async () => {
    mount(h(SettingsScreen, {}));
    await flush();
    expect(noRussian(host)).toContain('Language');
    expect(noRussian(host)).not.toMatch(CYR);
  });
  it('Update', async () => {
    mount(h(UpdateScreen, {}));
    await flush();
    expect(noRussian(host).length).toBeGreaterThan(0);
    expect(noRussian(host)).not.toMatch(CYR);
  });
  it('Sources', async () => {
    mount(h(SourcesScreen, { now: Date.now }));
    await flush();
    expect(noRussian(host).length).toBeGreaterThan(0);
    expect(noRussian(host)).not.toMatch(CYR);
  });
  it('player overlay with a fake player', async () => {
    servers.value = [{ id: 's1', name: 's', url: 'http://srv:8090' }];
    activeServerId.value = 's1';
    vi.spyOn(TorrServerClient.prototype, 'probe').mockImplementation(() => Promise.resolve({ streams: [] } as any));
    const item: PlayItem = { url: 'http://srv:8090/stream/f1.mkv', title: 'Episode 1', hash: 'c'.repeat(40), fileIndex: 1 };
    mount(h('div', {}, h(PlayerScreen, { queue: [item], index: 0 }), h(DialogHost, {}), h(ToastHost, {})));
    for (let i = 0; i < 200 && !(host.querySelector('video') && host.querySelector('video')!.getAttribute('src')); i++) await new Promise((r) => setTimeout(r, 5));
    const video = host.querySelector('video') as HTMLVideoElement;
    expect(video).toBeTruthy();
    Object.defineProperty(video, 'duration', { configurable: true, get: () => 1000 });
    video.dispatchEvent(new Event('loadedmetadata'));
    video.dispatchEvent(new Event('playing'));
    // the menu opens once the player is ready: press again until it shows
    for (let i = 0; i < 200 && (host.textContent || '').indexOf('Player menu') < 0; i++) {
      dispatchKey('up', new KeyboardEvent('keydown'));
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(host.textContent).toContain('Player menu');
    expect(noRussian(host)).not.toMatch(CYR);
    dispatchKey('back', new KeyboardEvent('keydown'));
    for (let i = 0; i < 200 && (host.textContent || '').indexOf('Player menu') >= 0; i++) await new Promise((r) => setTimeout(r, 5));
  });
});

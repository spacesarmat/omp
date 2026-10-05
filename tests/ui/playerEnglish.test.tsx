import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';

vi.mock('../../src/store/journal', async (orig) => ({
  ...(await orig<typeof import('../../src/store/journal')>()),
  loadSkip: vi.fn(),
  saveSkip: vi.fn(),
  recordWatch: vi.fn(() => Promise.resolve()),
}));

import { PlayerScreen } from '../../src/screens/Player';
import { DialogHost } from '../../src/ui/dialog';
import { ToastHost } from '../../src/ui/toast';
import { dispatchKey } from '../../src/ui/keys';
import { servers, activeServerId } from '../../src/store/servers';
import { reloadProgress } from '../../src/store/progress';
import { TorrServerClient } from '../../src/api/torrserver';
import { loadSkip } from '../../src/store/journal';
import { applyLanguageSetting } from '../../src/i18n';
import type { PlayItem } from '../../src/player/types';

const H = 'c'.repeat(40);
const item: PlayItem = { url: 'http://srv:8090/stream/f1.mkv', title: 'Episode 1', hash: H, fileIndex: 1 };
const loadSkipMock = loadSkip as unknown as ReturnType<typeof vi.fn>;
let host: HTMLElement;

async function until(cond: () => boolean) {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(cond()).toBe(true);
}

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  vi.spyOn(TorrServerClient.prototype, 'probe').mockImplementation(() => Promise.resolve({ streams: [] } as any));
});
beforeEach(() => {
  localStorage.clear();
  reloadProgress();
  servers.value = [{ id: 's1', name: 's', url: 'http://srv:8090' }];
  activeServerId.value = 's1';
  loadSkipMock.mockReset();
  loadSkipMock.mockImplementation(() => Promise.resolve({ i: false, c: false }));
  applyLanguageSetting('en');
});
afterEach(async () => {
  dispatchKey('back', new KeyboardEvent('keydown'));
  render(null, host);
  await until(() => !host.querySelector('video'));
  document.body.innerHTML = '';
  applyLanguageSetting('ru');
});

describe('TV player in English', () => {
  it('the player menu shows English rows and no Russian', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    render(h('div', {}, h(PlayerScreen, { queue: [item], index: 0 }), h(DialogHost, {}), h(ToastHost, {})), host);
    await until(() => !!host.querySelector('video') && !!host.querySelector('video')!.getAttribute('src'));
    await until(() => loadSkipMock.mock.calls.length > 0);
    const video = host.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { configurable: true, get: () => 1000 });
    video.dispatchEvent(new Event('loadedmetadata'));
    video.dispatchEvent(new Event('playing'));
    // the menu opens once the player is ready: press again until it shows
    await until(() => {
      if (host.querySelectorAll('.dialog-option').length === 0) dispatchKey('up', new KeyboardEvent('keydown'));
      return host.querySelectorAll('.dialog-option').length > 0;
    });
    const options = Array.prototype.map.call(host.querySelectorAll('.dialog-option'), (o: Element) => (o.textContent || '').trim()) as string[];
    expect(options).toContain('Audio: default');
    expect(options.some((o) => o.indexOf('Subtitles: ') === 0)).toBe(true);
    expect(options.some((o) => o.indexOf('Subtitle size: ') === 0)).toBe(true);
    expect(options).toContain('Mark intro start: —');
    expect(options.some((o) => o.indexOf('Mark intro end: now ') === 0)).toBe(true);
    expect(options.some((o) => o.indexOf('Mark credits start: ') === 0)).toBe(true);
    expect(host.textContent).toContain('Player menu');
    expect(host.textContent).not.toMatch(/[А-Яа-яЁё]/);
  });
});

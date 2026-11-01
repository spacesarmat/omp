import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';

vi.mock('../../src/store/journal', async (orig) => ({
  ...(await orig<typeof import('../../src/store/journal')>()),
  loadSkip: vi.fn(() => Promise.resolve({ i: false, c: false })),
  saveSkip: vi.fn(),
  recordWatch: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../src/store/seriesTracks', async (orig) => ({
  ...(await orig<typeof import('../../src/store/seriesTracks')>()),
  rememberSeriesTracks: vi.fn(() => Promise.resolve()),
}));

import { PlayerScreen } from '../../src/screens/Player';
import { DialogHost } from '../../src/ui/dialog';
import { ToastHost } from '../../src/ui/toast';
import { dispatchKey } from '../../src/ui/keys';
import { servers, activeServerId } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { reloadProgress } from '../../src/store/progress';
import { reloadTrackPrefs } from '../../src/store/trackPrefs';
import { rememberSeriesTracks } from '../../src/store/seriesTracks';
import { TorrServerClient } from '../../src/api/torrserver';
import { applyLanguageSetting } from '../../src/i18n';
import type { FfprobeResult } from '../../src/api/types';
import type { PlayItem } from '../../src/player/types';

const H = 'e'.repeat(40);
const item: PlayItem = { url: 'http://srv:8090/stream/f1.mkv', title: 'Серия 1', hash: H, fileIndex: 1 };
const probe: FfprobeResult = {
  streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264' },
    { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2, tags: { language: 'rus', title: 'Дубляж' }, disposition: { default: 1 } },
  ],
} as any;
const files = [
  { id: 1, path: 'Show/Show.S01E01.mkv', length: 1000 },
  { id: 3, path: 'Show/Rus Sound/LostFilm/Show.S01E01.mka', length: 100 },
];

const hosts: HTMLElement[] = [];
function mount(node: any) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(node, host);
  hosts.push(host);
  return host;
}
async function until(cond: () => boolean) {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(cond()).toBe(true);
}
const options = () => Array.prototype.slice.call(document.querySelectorAll('.dialog-option')) as HTMLElement[];
const optionTexts = () => options().map((o) => (o.textContent || '').trim());
const title = () => (document.querySelector('.dialog-title') ? document.querySelector('.dialog-title')!.textContent : null);

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  vi.spyOn(TorrServerClient.prototype, 'probe').mockImplementation(() => Promise.resolve(probe));
  vi.spyOn(TorrServerClient.prototype, 'preload').mockImplementation(() => Promise.resolve());
});
beforeEach(() => {
  localStorage.clear();
  reloadProgress();
  reloadTrackPrefs();
  servers.value = [{ id: 's1', name: 's', url: 'http://srv:8090' }];
  activeServerId.value = 's1';
  torrents.value = [{ hash: H, title: 'Show', file_stats: files } as any];
  (rememberSeriesTracks as any).mockClear();
  (TorrServerClient.prototype.preload as any).mockClear();
});
afterEach(async () => {
  if (options().length) dispatchKey('back', new KeyboardEvent('keydown'));
  hosts.splice(0).forEach((x) => render(null, x));
  torrents.value = [];
  await new Promise((r) => setTimeout(r, 30));
  document.body.innerHTML = '';
  applyLanguageSetting('ru');
});

describe('webOS player external dub', () => {
  it('lists the dub next to the built-in track, mutes the video, and remembers it without a built-in index', async () => {
    const host = mount(h('div', {}, h(PlayerScreen, { queue: [item], index: 0 }), h(DialogHost, {}), h(ToastHost, {})));
    await until(() => !!host.querySelector('video') && !!host.querySelector('audio'));
    const video = host.querySelector('video') as HTMLVideoElement;
    const audio = host.querySelector('audio') as HTMLAudioElement;
    audio.play = (() => Promise.resolve()) as any;
    audio.pause = (() => undefined) as any;
    audio.load = (() => undefined) as any;
    Object.defineProperty(video, 'duration', { configurable: true, get: () => 1000 });
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
    video.play = (() => Promise.resolve()) as any;
    video.pause = (() => undefined) as any;
    video.dispatchEvent(new Event('loadedmetadata'));
    video.dispatchEvent(new Event('playing'));
    await new Promise((r) => setTimeout(r, 40));
    dispatchKey('red', new KeyboardEvent('keydown'));
    await until(() => title() === 'Аудио');
    expect(optionTexts()).toEqual(['RU · AAC 2.0 · Дубляж', 'RU · MKA · LostFilm']);
    options()[1].click();
    await until(() => video.muted === true);
    expect(audio.getAttribute('src')).toContain('index=3');
    expect(audio.getAttribute('src')).toContain('Show.S01E01.mka');
    const patch = (rememberSeriesTracks as any).mock.calls[0][2];
    expect(patch.l).toBe('LostFilm');
    expect(patch.g).toBe('ru');
    expect(patch.e).toBeUndefined();
    expect((TorrServerClient.prototype.preload as any).mock.calls.length).toBeGreaterThan(0);

    await until(() => title() === null);
    dispatchKey('red', new KeyboardEvent('keydown'));
    await until(() => title() === 'Аудио');
    options()[0].click();
    await until(() => video.muted === false);
    const back = (rememberSeriesTracks as any).mock.calls[1][2];
    expect(back.e).toBe(0);
    expect(back.l).toBe('Дубляж');
    expect(audio.getAttribute('src')).toBeNull();
  });
});

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
import { PlayerHints } from '../../src/player/Controls';
import { colorKeyCommand, colorKeyOverWindow } from '../../src/player/colorKeys';
import { DialogHost } from '../../src/ui/dialog';
import { ToastHost } from '../../src/ui/toast';
import { dispatchKey } from '../../src/ui/keys';
import { servers, activeServerId } from '../../src/store/servers';
import { reloadProgress } from '../../src/store/progress';
import { getTrackPref, reloadTrackPrefs } from '../../src/store/trackPrefs';
import { rememberSeriesTracks } from '../../src/store/seriesTracks';
import { TorrServerClient } from '../../src/api/torrserver';
import { applyLanguageSetting } from '../../src/i18n';
import { keyAction, type KeyAction } from '../../src/platform/keys';
import type { FfprobeResult } from '../../src/api/types';
import type { PlayItem } from '../../src/player/types';
// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';

const H = 'd'.repeat(40);
const item: PlayItem = { url: 'http://srv:8090/stream/f1.mkv', title: 'Серия 1', hash: H, fileIndex: 1 };
const probe: FfprobeResult = {
  streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264' },
    { index: 1, codec_type: 'audio', codec_name: 'ac3', channels: 6, tags: { language: 'rus', title: 'Дубляж' }, disposition: { default: 1 } },
    { index: 2, codec_type: 'audio', codec_name: 'aac', channels: 2, tags: { language: 'rus', title: 'LostFilm' } },
    { index: 3, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'rus', title: 'Надписи' } },
  ],
} as any;

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
const key = (a: KeyAction) => dispatchKey(a, new KeyboardEvent('keydown'));
const options = () => Array.prototype.slice.call(document.querySelectorAll('.dialog-option')) as HTMLElement[];
const optionTexts = () => options().map((o) => (o.textContent || '').trim());
const title = () => (document.querySelector('.dialog-title') ? document.querySelector('.dialog-title')!.textContent : null);

async function open() {
  const host = mount(h('div', {}, h(PlayerScreen, { queue: [item], index: 0 }), h(DialogHost, {}), h(ToastHost, {})));
  await until(() => !!host.querySelector('video') && !!host.querySelector('video')!.getAttribute('src'));
  await new Promise((r) => setTimeout(r, 80));
  const video = host.querySelector('video') as HTMLVideoElement;
  Object.defineProperty(video, 'duration', { configurable: true, get: () => 1000 });
  Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
  video.play = (() => Promise.resolve()) as any;
  video.pause = (() => undefined) as any;
  video.dispatchEvent(new Event('loadedmetadata'));
  video.dispatchEvent(new Event('playing'));
  await new Promise((r) => setTimeout(r, 40));
  return host;
}

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  vi.spyOn(TorrServerClient.prototype, 'probe').mockImplementation(() => Promise.resolve(probe));
});
beforeEach(() => {
  localStorage.clear();
  reloadProgress();
  reloadTrackPrefs();
  servers.value = [{ id: 's1', name: 's', url: 'http://srv:8090' }];
  activeServerId.value = 's1';
  (rememberSeriesTracks as any).mockClear();
});
afterEach(async () => {
  if (options().length) key('back');
  hosts.splice(0).forEach((x) => render(null, x));
  await new Promise((r) => setTimeout(r, 60));
  document.body.innerHTML = '';
  applyLanguageSetting('ru');
});

describe('colour keys of the TV player', () => {
  it('map like the Android TV player: red audio, green subtitles, yellow night sound or statistics, blue menu', () => {
    expect([403, 404, 405, 406].map((c) => keyAction({ keyCode: c }))).toEqual(['red', 'green', 'yellow', 'blue']);
    expect(colorKeyCommand('red', false)).toBe('audio');
    expect(colorKeyCommand('green', false)).toBe('subs');
    expect(colorKeyCommand('yellow', false)).toBe('stats');
    expect(colorKeyCommand('yellow', true)).toBe('night');
    expect(colorKeyCommand('blue', false)).toBe('menu');
    expect(colorKeyCommand('up', false)).toBeNull();
  });

  it('red opens the audio list of the menu; a pick is saved for the torrent and the series', async () => {
    await open();
    key('red');
    await until(() => title() === 'Аудио');
    expect(optionTexts()).toEqual(['RU · AC3 5.1 · Дубляж', 'RU · AAC 2.0 · LostFilm']);
    options()[1].click();
    await until(() => !!getTrackPref(H) && getTrackPref(H)!.audioLabel === 'RU · AAC 2.0 · LostFilm');
    expect(rememberSeriesTracks).toHaveBeenCalledWith(expect.anything(), H, expect.objectContaining({ l: 'LostFilm', g: 'ru' }));
  });

  it('green opens the subtitles list; a pick is saved for the series', async () => {
    await open();
    key('green');
    await until(() => title() === 'Субтитры');
    expect(optionTexts()).toEqual(['Выкл', 'RU · SUBRIP · Надписи']);
    options()[1].click();
    await until(() => (rememberSeriesTracks as any).mock.calls.length === 1);
    expect(rememberSeriesTracks).toHaveBeenCalledWith(expect.anything(), H, { s: { l: 'Надписи', g: 'ru' } });
  });

  it('a key over its own window closes it; another key closes it and opens its own', () => {
    expect(colorKeyOverWindow('audio', 'audio')).toBeNull();
    expect(colorKeyOverWindow('subs', 'subs')).toBeNull();
    expect(colorKeyOverWindow('menu', 'menu')).toBeNull();
    expect(colorKeyOverWindow('menu', 'audio')).toBeNull();
    expect(colorKeyOverWindow('audio', 'subs')).toBe('audio');
    expect(colorKeyOverWindow('subs', 'menu')).toBe('subs');
    expect(colorKeyOverWindow('stats', 'audio')).toBe('stats');
  });

  it('red closes the audio list it opened; red over the list opened from the menu closes it too', async () => {
    await open();
    key('red');
    await until(() => title() === 'Аудио');
    key('red');
    await until(() => title() === null);
    key('blue');
    await until(() => title() === 'Меню плеера');
    options()[0].click(); // «Аудио: …»
    await until(() => title() === 'Аудио');
    key('red');
    await until(() => title() === null);
    expect(rememberSeriesTracks).not.toHaveBeenCalled();
  });

  it('green closes the subtitles list; blue closes the menu; another key switches lists', async () => {
    const host = await open();
    key('green');
    await until(() => title() === 'Субтитры');
    key('green');
    await until(() => title() === null);
    key('blue');
    await until(() => title() === 'Меню плеера');
    key('blue');
    await until(() => title() === null);
    // red over the subtitles list: closes it and opens the audio list
    key('green');
    await until(() => title() === 'Субтитры');
    key('red');
    await until(() => title() === 'Аудио');
    // yellow over a list: closes it and toggles the statistics
    key('yellow');
    await until(() => title() === null && !!host.querySelector('.player-stats'));
  });

  it('yellow toggles the statistics (no night sound on LG), blue opens the player menu', async () => {
    const host = await open();
    expect(host.querySelector('.player-stats')).toBeNull();
    key('yellow');
    await until(() => !!host.querySelector('.player-stats'));
    key('yellow');
    await until(() => !host.querySelector('.player-stats'));
    key('blue');
    await until(() => title() === 'Меню плеера');
  });
});

describe('hint line', () => {
  const text = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim();

  it('shows the four colour keys and CH± in a short line', () => {
    const host = mount(h(PlayerHints, { chapters: false }));
    expect(host.querySelectorAll('.keydot circle').length).toBe(4);
    expect(Array.prototype.map.call(host.querySelectorAll('.keydot circle'), (c: Element) => c.getAttribute('fill')).length).toBe(4);
    expect(text(host)).toBe('АудиоСубтитрыСтатистикаМенюCH± — серии');
    const chapters = mount(h(PlayerHints, { chapters: true }));
    expect(text(chapters)).toContain('CH± — главы');
    // at most ~50 characters: fits one line at 1920 next to the buttons
    expect(text(host).length).toBeLessThan(50);
  });

  it('English', () => {
    applyLanguageSetting('en');
    const host = mount(h(PlayerHints, { chapters: true }));
    expect(text(host)).toBe('AudioSubtitlesStatsMenuCH± — chapters');
  });

  it('never wraps: one line, cut with an ellipsis at worst', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    expect(/\.player-hints \{[^}]*white-space: nowrap[^}]*overflow: hidden[^}]*text-overflow: ellipsis/.test(css)).toBe(true);
  });
});

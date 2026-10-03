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
import { updateSettings } from '../../src/store/settings';
import { reloadProgress } from '../../src/store/progress';
import { TorrServerClient } from '../../src/api/torrserver';
import { loadSkip, saveSkip } from '../../src/store/journal';
import type { KeyAction } from '../../src/platform/keys';
import type { FfprobeResult } from '../../src/api/types';
import type { PlayItem } from '../../src/player/types';

const H = 'c'.repeat(40);
const mk = (i: number): PlayItem => ({ url: 'http://srv:8090/stream/f' + i + '.mkv', title: 'Серия ' + i, hash: H, fileIndex: i });
const one = [mk(1)];
const two = [mk(1), mk(2)];

const ch = (s: number, e: number, title: string) => ({ start_time: String(s), end_time: String(e), tags: { title } });
const withChapters: FfprobeResult = {
  streams: [],
  chapters: [ch(0, 60, 'Пролог'), ch(60, 150, 'Заставка'), ch(150, 900, 'Серия'), ch(900, 1000, 'Титры')],
};
const noChapters: FfprobeResult = { streams: [] };

let probeResult: FfprobeResult | null = noChapters;
const hosts: HTMLElement[] = [];
const loadSkipMock = loadSkip as unknown as ReturnType<typeof vi.fn>;
const saveSkipMock = saveSkip as unknown as ReturnType<typeof vi.fn>;

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
const tick = () => new Promise((r) => setTimeout(r, 20));
/**
 * Plays up to `t` in 1 s steps: the player treats a jump of 5 s or more as a seek, so even if a loaded machine
 * makes it miss a step or two the last one it saw stays within the crossing window.
 */
async function playTo(at: (t: number) => void, t: number) {
  for (let s = t - 4; s <= t; s++) {
    at(s);
    await tick();
  }
}

/** Fake clock of the <video>: jsdom has no media pipeline. */
function drive(video: HTMLVideoElement, duration = 1000) {
  let time = 0;
  Object.defineProperty(video, 'duration', { configurable: true, get: () => duration });
  Object.defineProperty(video, 'currentTime', { configurable: true, get: () => time, set: (v: number) => { time = v; } });
  Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
  video.play = (() => Promise.resolve()) as any;
  video.pause = (() => undefined) as any;
  video.load = (() => undefined) as any;
  video.dispatchEvent(new Event('loadedmetadata'));
  video.dispatchEvent(new Event('playing'));
  return (t: number) => {
    time = t;
    video.dispatchEvent(new Event('timeupdate'));
  };
}

interface Opts {
  prefs?: { i: boolean; c: boolean; mi?: [number, number]; mc?: number };
  probe?: FfprobeResult | null;
}

async function open(queue: PlayItem[], opts: Opts = {}) {
  probeResult = opts.probe === undefined ? withChapters : opts.probe;
  loadSkipMock.mockImplementation(() => Promise.resolve(opts.prefs || { i: false, c: false }));
  const host = mount(h('div', {}, h(PlayerScreen, { queue, index: 0 }), h(DialogHost, {}), h(ToastHost, {})));
  await until(() => !!host.querySelector('video') && !!host.querySelector('video')!.getAttribute('src'));
  await new Promise((r) => setTimeout(r, 80)); // let the video-state hook attach its listeners (effects run after paint)
  const video = host.querySelector('video') as HTMLVideoElement;
  const at = drive(video);
  await until(() => loadSkipMock.mock.calls.length > 0);
  await tick();
  return { host, video, at };
}

const key = (a: KeyAction) => dispatchKey(a, new KeyboardEvent('keydown'));
const options = (host: HTMLElement) => Array.prototype.slice.call(host.querySelectorAll('.dialog-option')) as HTMLElement[];
const optionTexts = (host: HTMLElement) => options(host).map((o) => (o.textContent || '').trim());
const srcHas = (name: string) => () => (document.querySelector('video')!.getAttribute('src') || '').indexOf(name) >= 0;
const hasText = (host: HTMLElement, text: string) => () => (host.textContent || '').indexOf(text) >= 0;

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  vi.spyOn(TorrServerClient.prototype, 'probe').mockImplementation(() => Promise.resolve(probeResult));
});
beforeEach(async () => {
  await new Promise((r) => setTimeout(r, 0));
  localStorage.clear();
  reloadProgress();
  servers.value = [{ id: 's1', name: 's', url: 'http://srv:8090' }];
  activeServerId.value = 's1';
  updateSettings({ autoNext: true });
  loadSkipMock.mockReset();
  saveSkipMock.mockReset();
});
afterEach(async () => {
  if (options(document.body).length) key('back'); // an open dialog is global state
  hosts.splice(0).forEach((x) => render(null, x));
  await new Promise((r) => setTimeout(r, 60));
  document.body.innerHTML = '';
});

describe('player chapters (LG)', () => {
  it('ticks on the bar, current chapter in the title, «Главы» button', async () => {
    const { host, at } = await open(one);
    await until(() => host.querySelectorAll('.player-bar-tick').length === 3);
    at(100);
    await until(() => (host.querySelector('.player-title')!.textContent || '').indexOf('Глава 2 «Заставка»') >= 0);
    expect(host.textContent).toContain('Главы');
  });

  it('without chapters: no ticks, no «Главы»', async () => {
    const { host } = await open(one, { probe: noChapters });
    expect(host.querySelectorAll('.player-bar-tick').length).toBe(0);
    expect(host.querySelector('.player-chapter')).toBeNull();
    expect(host.textContent).not.toContain('Главы');
  });

  it('CH+ / CH− go to the next / previous chapter, CH− late in a chapter restarts it', async () => {
    const { host, video, at } = await open(one);
    await until(() => host.querySelectorAll('.player-bar-tick').length === 3);
    at(100);
    key('chup');
    expect(video.currentTime).toBe(150);
    at(152);
    key('chdown');
    expect(video.currentTime).toBe(60); // first 3 s: the previous chapter
    at(120);
    key('chdown');
    expect(video.currentTime).toBe(60); // later: the start of this one
    at(950);
    key('chup');
    expect(video.currentTime).toBe(950); // last chapter: nowhere to go
  });

  it('CH± switch episodes when the file has no chapters', async () => {
    const { video } = await open(two, { probe: noChapters });
    expect(video.getAttribute('src')).toContain('f1.mkv');
    key('chup');
    await until(srcHas('f2.mkv'));
  });

  it('the menu lists «Главы» and a chosen chapter is sought', async () => {
    const { host, video } = await open(one);
    await until(() => host.querySelectorAll('.player-bar-tick').length === 3);
    key('up');
    await until(() => options(host).length > 0);
    expect(optionTexts(host)).toContain('Главы: 4');
    options(host).filter((o) => (o.textContent || '').indexOf('Главы: 4') >= 0)[0].click();
    await until(() => optionTexts(host).indexOf('0:00 · Пролог') >= 0);
    expect(optionTexts(host)).toEqual(['0:00 · Пролог', '1:00 · Заставка', '2:30 · Серия', '15:00 · Титры']);
    expect(options(host).map((o) => o.className.indexOf('current') >= 0)).toEqual([true, false, false, false]);
    options(host)[2].click();
    await until(() => video.currentTime === 150);
  });
});

describe('skip intro / credits (LG)', () => {
  it('manual: «Пропустить заставку» while in the intro, OK seeks to its end', async () => {
    const { host, video, at } = await open(one);
    at(70);
    await until(hasText(host, 'Пропустить заставку'));
    expect(key('enter')).toBe(true);
    expect(video.currentTime).toBe(150);
  });

  it('manual marks work without chapters', async () => {
    const { host, video, at } = await open(one, { probe: noChapters, prefs: { i: false, c: false, mi: [30, 100] } });
    at(40);
    await until(hasText(host, 'Пропустить заставку'));
    key('enter');
    expect(video.currentTime).toBe(100);
  });

  it('a manual end past the duration is clamped', async () => {
    const { host, video, at } = await open(one, { probe: noChapters, prefs: { i: false, c: false, mi: [30, 5000] } });
    at(40);
    await until(hasText(host, 'Пропустить заставку'));
    key('enter');
    expect(video.currentTime).toBe(999);
  });

  it('auto skip: seeks at once, shows «Заставка пропущена · Вернуть», OK goes back and it never skips again', async () => {
    const { host, video, at } = await open(one, { prefs: { i: true, c: false } });
    at(61);
    await until(() => video.currentTime === 150);
    await until(hasText(host, 'Заставка пропущена · Вернуть'));
    expect(host.textContent).not.toContain('Пропустить заставку');
    expect(key('enter')).toBe(true);
    expect(video.currentTime).toBe(60);
    await until(() => (host.textContent || '').indexOf('Вернуть') < 0);
    at(70);
    await tick();
    expect(video.currentTime).toBe(70);
  });

  it('the «Вернуть» message disappears after 5 s', async () => {
    const { host, at } = await open(one, { prefs: { i: true, c: false } });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      at(61);
      await vi.waitFor(() => expect(host.textContent).toContain('Вернуть'));
      vi.advanceTimersByTime(4900);
      expect(host.textContent).toContain('Вернуть');
      vi.advanceTimersByTime(200);
      await vi.waitFor(() => expect(host.textContent).not.toContain('Вернуть'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto skip of the credits with a next item: next episode at once and «Титры пропущены»', async () => {
    const { host, at } = await open(two, { prefs: { i: false, c: true } });
    await playTo(at, 899);
    at(901);
    await until(srcHas('f2.mkv'));
    expect(host.textContent).toContain('Титры пропущены');
  });

  it('auto skip of the credits does nothing on the last item', async () => {
    const { host, video, at } = await open(one, { prefs: { i: false, c: true } });
    const before = host.querySelectorAll('.toast').length;
    await playTo(at, 899);
    at(901);
    await tick();
    expect(video.getAttribute('src')).toContain('f1.mkv');
    expect(host.querySelectorAll('.toast').length).toBe(before);
  });

  it('credits from the manual mark (last N seconds) skip too', async () => {
    const { at } = await open(two, { probe: noChapters, prefs: { i: false, c: true, mc: 100 } });
    at(850);
    await playTo(at, 899);
    await tick();
    expect(document.querySelector('video')!.getAttribute('src')).toContain('f1.mkv');
    at(901);
    await until(srcHas('f2.mkv'));
  });

  it('credits are skipped only when playback crosses their start, not after a seek into them', async () => {
    const { video, at } = await open(two, { prefs: { i: false, c: true } });
    at(950); // resume / seek into the credits
    await tick();
    expect(video.getAttribute('src')).toContain('f1.mkv');
    at(951);
    await tick();
    expect(video.getAttribute('src')).toContain('f1.mkv');
  });

  it('credits auto skip does not need «Автопереход»', async () => {
    updateSettings({ autoNext: false });
    const { at } = await open(two, { prefs: { i: false, c: true } });
    await playTo(at, 899);
    at(901);
    await until(srcHas('f2.mkv'));
  });

  it('«Назад» hides the «Вернуть» message', async () => {
    const { host, at } = await open(one, { prefs: { i: true, c: false } });
    at(61);
    await until(hasText(host, 'Вернуть'));
    expect(key('back')).toBe(true);
    await until(() => (host.textContent || '').indexOf('Вернуть') < 0);
  });

  it('«Назад» hides «Пропустить заставку» and it does not return in this intro', async () => {
    const { host, video, at } = await open(one);
    at(70);
    await until(hasText(host, 'Пропустить заставку'));
    expect(key('back')).toBe(true);
    await until(() => (host.textContent || '').indexOf('Пропустить заставку') < 0);
    at(80);
    await tick();
    expect(host.textContent).not.toContain('Пропустить заставку');
    expect(video.currentTime).toBe(80);
  });

  it('the «Следующая серия» countdown starts at the credits, not 30 s before the end', async () => {
    const { host, at } = await open(two);
    at(500);
    await tick();
    expect(host.textContent).not.toContain('Следующая серия через');
    at(901);
    await until(hasText(host, 'Следующая серия через'));
  });

  it('without credits the countdown is still the last 30 s', async () => {
    const { host, at } = await open(two, { probe: noChapters });
    at(901);
    await tick();
    expect(host.textContent).not.toContain('Следующая серия через');
    at(975);
    await until(hasText(host, 'Следующая серия через'));
  });

  it('skip prefs are loaded once per torrent', async () => {
    const { at } = await open(two);
    at(10);
    at(20);
    await tick();
    expect(loadSkipMock.mock.calls.length).toBe(1);
    expect(loadSkipMock.mock.calls[0][1]).toBe(H);
  });
});

async function pick(host: HTMLElement, text: string) {
  key('up');
  await until(() => options(host).length > 0);
  options(host).filter((o) => (o.textContent || '').indexOf(text) === 0)[0].click();
  await tick();
}

describe('chapter keys before ffprobe answers', () => {
  it('CH+ does not switch episodes until the probe has resolved', async () => {
    let release: (r: FfprobeResult | null) => void = () => undefined;
    const spy = vi.spyOn(TorrServerClient.prototype, 'probe').mockImplementation(() => new Promise((r) => { release = r; }));
    try {
      probeResult = withChapters;
      loadSkipMock.mockImplementation(() => Promise.resolve({ i: false, c: false }));
      const host = mount(h('div', {}, h(PlayerScreen, { queue: two, index: 0 }), h(DialogHost, {}), h(ToastHost, {})));
      await until(() => !!host.querySelector('video') && !!host.querySelector('video')!.getAttribute('src'));
      await new Promise((r) => setTimeout(r, 80));
      expect(key('chup')).toBe(true);
      await tick();
      expect(srcHas('f1.mkv')()).toBe(true);
      release(withChapters);
      await tick();
      key('chup'); // chapters now: no episode change either (no duration in this fake clock)
      await tick();
      expect(srcHas('f1.mkv')()).toBe(true);
    } finally {
      spy.mockImplementation(() => Promise.resolve(probeResult));
    }
  });
});

describe('marks from the menu (LG)', () => {
  it('the mark is the time the menu was opened, not the time of the selection', async () => {
    saveSkipMock.mockImplementation(() => Promise.resolve({ i: false, c: false, mi: [10, 135] }));
    const { host, at } = await open(one, { probe: noChapters, prefs: { i: false, c: false, mi: [10, 100] } });
    at(135);
    key('up');
    await until(() => options(host).length > 0);
    expect(optionTexts(host)).toContain('Отметить конец заставки: сейчас 2:15');
    at(141); // the video keeps playing while the menu is open
    options(host).filter((o) => (o.textContent || '').indexOf('Отметить конец заставки') === 0)[0].click();
    await until(() => saveSkipMock.mock.calls.length === 1);
    expect(saveSkipMock.mock.calls[0][2]).toEqual({ mi: [10, 135] });
  });

  it('a pending intro start is shown in the menu and survives reopening it', async () => {
    const { host, at } = await open(one, { probe: noChapters });
    at(45);
    await pick(host, 'Отметить начало заставки');
    expect(host.textContent).toContain('Начало заставки 0:45 · теперь отметьте конец');
    at(60);
    key('up');
    await until(() => options(host).length > 0);
    expect(optionTexts(host)).toContain('Отметить конец заставки: начало 0:45 · сейчас 1:00');
    expect(optionTexts(host)).toContain('Отметить начало заставки: 0:45');
  });

  it('intro start, then end: one write, toast, prefs updated', async () => {
    saveSkipMock.mockImplementation(() => Promise.resolve({ i: false, c: false, mi: [45, 135] }));
    const { host, at } = await open(one, { probe: noChapters });
    at(45);
    await pick(host, 'Отметить начало заставки');
    expect(saveSkipMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Начало заставки 0:45 · теперь отметьте конец');
    at(135);
    await pick(host, 'Отметить конец заставки');
    await until(() => saveSkipMock.mock.calls.length === 1);
    const call = saveSkipMock.mock.calls[0];
    expect(call[1]).toEqual({ hash: H });
    expect(call[2]).toEqual({ mi: [45, 135] });
    await until(hasText(host, 'Отмечено: заставка 0:45–2:15'));
    // the new mark is already in effect
    at(50);
    await until(hasText(host, 'Пропустить заставку'));
  });

  it('credits: the last N seconds, whole', async () => {
    saveSkipMock.mockImplementation(() => Promise.resolve({ i: false, c: false, mc: 100 }));
    const { host, at } = await open(one, { probe: noChapters });
    at(900.4);
    await pick(host, 'Отметить начало титров');
    await until(() => saveSkipMock.mock.calls.length === 1);
    expect(saveSkipMock.mock.calls[0][2]).toEqual({ mc: 100 });
    await until(hasText(host, 'Отмечено: титры с 15:00'));
  });

  it('a failed write shows an error', async () => {
    saveSkipMock.mockImplementation(() => Promise.reject(new Error('нет связи')));
    const { host, at } = await open(one, { probe: noChapters });
    at(900);
    await pick(host, 'Отметить начало титров');
    await until(hasText(host, 'Не удалось сохранить отметку: нет связи'));
  });

  it('the end before any start is refused', async () => {
    const { host, at } = await open(one, { probe: noChapters });
    at(30);
    await pick(host, 'Отметить конец заставки');
    expect(saveSkipMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Сначала отметьте начало заставки');
  });
});

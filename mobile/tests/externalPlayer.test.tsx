import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Torrent } from '../src/screens/Torrent';
import { setWatchActions } from '../src/watch';
import { externalPlayerResult, native, onlyAndroid } from '../src/platform/native';
import { resetTo, navigate } from '../src/nav';
import { reloadTvs } from '../src/tv/tvStore';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { getLocalProgress, isWatched, saveProgress, reloadProgress, serverViewed } from '../../src/store/progress';
import { TorrServerClient } from '../../src/api/torrserver';
import type { Torrent as T } from '../../src/api/types';

const EPS = ['Show.S02E01.mkv', 'Show.S02E02.mkv'];
const tor: T = {
  hash: 'abc',
  title: 'Starbound Frontier S02 1080p WEB-DL',
  category: 'tv',
  stat: 3,
  torrent_size: 4 * 1024 ** 3,
  file_stats: EPS.map((p, i) => ({ id: i + 1, path: p, length: 1900000000 })),
};
const URL1 = 'http://srv:8090/stream/Show.S02E01.mkv?link=abc&index=1&play';

async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

let el: HTMLElement;
const openPlayer = vi.fn();
const openExternal = vi.fn();
const record = vi.fn();
let setViewed: ReturnType<typeof vi.fn>;

function mount() {
  localStorage.setItem('tsp.ui.skipOpen', 'true');
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<Torrent hash="abc" />, el));
}

const byText = (text: string) => Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').includes(text));

async function watchPhone() {
  mount();
  await flush();
  act(() => byText('Смотреть на телефоне')!.click());
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  reloadTvs();
  reloadProgress();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  torrents.value = [tor];
  serverViewed.value = [];
  openPlayer.mockReset();
  openExternal.mockReset().mockResolvedValue(undefined);
  record.mockReset().mockResolvedValue(undefined);
  setWatchActions({ recordWatch: record, ompVersion: async () => null, reportUrl: async () => null, openPlayer, openExternal, remoteDelayMs: 0 });
  resetTo({ name: 'library' });
  navigate({ name: 'torrent', hash: 'abc' });
  vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'probe').mockResolvedValue(null);
  setViewed = vi.spyOn(TorrServerClient.prototype, 'setViewed').mockResolvedValue(undefined) as any;
});

afterEach(() => {
  act(() => render(null, el));
  vi.restoreAllMocks();
  setWatchActions(null);
});

describe('«Смотреть на телефоне» in another player', () => {
  it('opens the player at the saved position and saves the position it hands back', async () => {
    saveProgress('abc', 1, 754, 2400);
    openPlayer.mockResolvedValue({ returned: true, positionMs: 1_200_500, durationMs: 2_400_000, ended: false });
    await watchPhone();
    expect(openPlayer).toHaveBeenCalledTimes(1);
    const o = openPlayer.mock.calls[0][0];
    expect(o.url).toBe(URL1);
    expect(o.positionMs).toBe(754_000);
    expect(o.title).toContain('S02E01');
    expect(o.title).not.toContain('.mkv');
    expect(o.title).not.toContain('1080p');
    expect(openExternal).not.toHaveBeenCalled();
    expect(getLocalProgress('abc', 1)).toMatchObject({ time: 1200.5, duration: 2400 });
    expect(setViewed).toHaveBeenCalledWith('abc', 1, 1200);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][2]).toMatchObject({ f: 1, t: 1200, d: 2400, src: 'phone' });
  });

  it('from the start when nothing is saved; a position below MIN_RESUME is not saved', async () => {
    openPlayer.mockResolvedValue({ returned: true, positionMs: 4000, durationMs: 2_400_000, ended: false });
    await watchPhone();
    expect(openPlayer.mock.calls[0][0].positionMs).toBe(0);
    expect(getLocalProgress('abc', 1)).toBeNull();
    expect(setViewed).not.toHaveBeenCalled();
    expect(record.mock.calls[0][2]).toMatchObject({ f: 1, t: 0, d: 2400 });
  });

  it('playback to the end marks the file watched', async () => {
    saveProgress('abc', 1, 754, 2400);
    openPlayer.mockResolvedValue({ returned: true, positionMs: 2_399_000, durationMs: 2_400_000, ended: true });
    await watchPhone();
    expect(isWatched('abc', 1)).toBe(true);
    // the server: timecode 0 means watched
    expect(setViewed).toHaveBeenCalledWith('abc', 1, 0);
  });

  it('a player that hands nothing back: the journal keeps where it was started, progress is left alone', async () => {
    saveProgress('abc', 1, 754, 2400);
    openPlayer.mockResolvedValue({ returned: false });
    await watchPhone();
    expect(getLocalProgress('abc', 1)).toMatchObject({ time: 754, duration: 2400 });
    expect(setViewed).not.toHaveBeenCalled();
    expect(record.mock.calls[0][2]).toMatchObject({ f: 1, t: 754, d: 2400 });
  });

  it('an older app without openPlayer falls back to the plain chooser', async () => {
    openPlayer.mockResolvedValue(null);
    await watchPhone();
    expect(openExternal).toHaveBeenCalledWith(URL1, 'video/*');
    expect(record.mock.calls[0][2]).toMatchObject({ f: 1, t: 0 });
  });

  it('no player at all: the error is shown and nothing is recorded', async () => {
    openPlayer.mockRejectedValue(new Error('Нет приложения для просмотра видео'));
    await watchPhone();
    expect(record).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Нет приложения для просмотра видео');
  });

  it('the «На телефоне» option of an episode uses the same path', async () => {
    openPlayer.mockResolvedValue({ returned: true, positionMs: 60_000, durationMs: 2_400_000 });
    mount();
    await flush();
    act(() => (el.querySelectorAll('.m-ep')[1] as HTMLElement).click());
    act(() => (el.querySelectorAll('.m-opt')[1] as HTMLElement).click());
    await flush();
    expect(openPlayer.mock.calls[0][0].url).toBe('http://srv:8090/stream/Show.S02E02.mkv?link=abc&index=2&play');
    expect(getLocalProgress('abc', 2)).toMatchObject({ time: 60, duration: 2400 });
  });
});

describe('native.openPlayer', () => {
  it('rejects outside Android', async () => {
    await expect(native.openPlayer({ url: URL1, title: 't', positionMs: 0 })).rejects.toThrow(onlyAndroid());
  });

  it('keeps only the well-typed fields of the answer', () => {
    expect(externalPlayerResult(null)).toEqual({ returned: false });
    expect(externalPlayerResult({ returned: false, positionMs: 5 })).toEqual({ returned: false });
    expect(externalPlayerResult({ returned: true, positionMs: 5000, durationMs: -1, ended: 'yes' })).toEqual({ returned: true, positionMs: 5000, ended: false });
    expect(externalPlayerResult({ returned: true, positionMs: 1, durationMs: 2, ended: true })).toEqual({ returned: true, positionMs: 1, durationMs: 2, ended: true });
  });
});

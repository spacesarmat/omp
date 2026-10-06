import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { TorrentScreen } from '../../src/screens/Torrent';
import { ToastHost } from '../../src/ui/toast';
import { servers, addServer, setActiveServer, removeServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { TorrServerClient } from '../../src/api/torrserver';
import { getLocalProgress, reloadProgress, saveProgress, serverViewed, isWatched } from '../../src/store/progress';
import { sanitizeExternalResult, externalPlayerBusy } from '../../src/player/externalPlayer';
import type { Torrent } from '../../src/api/types';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const H = 'f'.repeat(40);
const tor: Torrent = {
  hash: H,
  title: 'Starbound Frontier S02 1080p',
  stat: 3,
  file_stats: [1, 2, 3].map((i) => ({ id: i, path: 'Show.S02E0' + i + '.mkv', length: 1e9 })),
};
const flush = () => act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); });
let host: HTMLElement;
const btn = (label: string) =>
  (Array.prototype.slice.call(host.querySelectorAll('.button')) as HTMLElement[]).filter((b) => (b.textContent || '').trim() === label)[0];
const click = (el: Element) => act(async () => { (el as HTMLElement).click(); });
const openPlayer = vi.fn();
let setViewed: ReturnType<typeof vi.fn>;

function android(on: boolean) {
  const w = window as any;
  if (!on) {
    delete w.Capacitor;
    return;
  }
  const plugin = { localIpv4: vi.fn(), openPlayer, addListener: vi.fn(() => ({ remove: () => undefined })) };
  w.Capacitor = { getPlatform: () => 'android', Plugins: { OmpNative: plugin } };
}

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(h('div', {}, h(TorrentScreen, { hash: H }), h(ToastHost, {})), host));
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  reloadProgress();
  serverViewed.value = [];
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090', user: 'u', password: 'p' } as any).id);
  torrents.value = [tor];
  openPlayer.mockReset();
  vi.spyOn(TorrServerClient.prototype, 'get').mockResolvedValue(tor);
  vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
  setViewed = vi.spyOn(TorrServerClient.prototype, 'setViewed').mockResolvedValue(undefined) as any;
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  android(false);
  vi.restoreAllMocks();
});

describe('TV torrent screen · in another player', () => {
  it('no button on LG', async () => {
    android(false);
    await mount();
    expect(btn('Смотреть S02E01')).toBeTruthy();
    expect(btn('В другом плеере')).toBeUndefined();
  });

  it('on Android TV the button follows Watch', async () => {
    android(true);
    await mount();
    const labels = (Array.prototype.slice.call(host.querySelectorAll('.torrent-actions-row .button')) as HTMLElement[]).map((b) => (b.textContent || '').trim());
    expect(labels.indexOf('В другом плеере')).toBe(labels.indexOf('Смотреть S02E01') + 1);
  });

  it('opens the in-progress episode at its resume position and saves the position that comes back', async () => {
    saveProgress(H, 2, 600, 2400);
    android(true);
    openPlayer.mockResolvedValue({ returned: true, positionMs: 1_200_000, durationMs: 2_400_000, ended: false });
    await mount();
    await click(btn('В другом плеере'));
    await flush();
    expect(openPlayer).toHaveBeenCalledTimes(1);
    const o = openPlayer.mock.calls[0][0];
    expect(o.url).toBe('http://u:p@srv:8090/stream/Show.S02E02.mkv?link=' + H + '&index=2&play');
    expect(o.positionMs).toBe(600_000);
    expect(o.title).toContain('S02E02');
    expect(o.title).not.toContain('.mkv');
    expect(getLocalProgress(H, 2)!.time).toBe(1200);
    expect(setViewed).toHaveBeenCalledWith(H, 2, 1200);
  });

  it('a series without progress opens the first unwatched episode from the start; the end marks it watched', async () => {
    saveProgress(H, 1, 2400, 2400);
    android(true);
    openPlayer.mockResolvedValue({ returned: true, positionMs: 2_399_000, durationMs: 2_400_000, ended: true });
    await mount();
    await click(btn('В другом плеере'));
    await flush();
    const o = openPlayer.mock.calls[0][0];
    expect(o.url).toContain('index=2');
    expect(o.positionMs).toBe(0);
    expect(isWatched(H, 2)).toBe(true);
    expect(setViewed).toHaveBeenCalledWith(H, 2, 0);
  });

  it('a player that hands nothing back leaves the progress alone; an error is shown', async () => {
    saveProgress(H, 2, 600, 2400);
    android(true);
    openPlayer.mockResolvedValue({ returned: false });
    await mount();
    await click(btn('В другом плеере'));
    await flush();
    expect(getLocalProgress(H, 2)!.time).toBe(600);
    expect(setViewed).not.toHaveBeenCalled();
    openPlayer.mockRejectedValue(new Error('Нет приложения для просмотра видео'));
    await click(btn('В другом плеере'));
    await flush();
    expect(host.textContent).toContain('Нет приложения для просмотра видео');
    expect(externalPlayerBusy()).toBe(false);
  });

  it('a second press while the player is open starts nothing', async () => {
    android(true);
    let finish: (v: unknown) => void = () => undefined;
    openPlayer.mockImplementation(() => new Promise((r) => { finish = r; }));
    await mount();
    await click(btn('В другом плеере'));
    await click(btn('В другом плеере'));
    await flush();
    expect(openPlayer).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ returned: false }); });
    await flush();
    expect(externalPlayerBusy()).toBe(false);
  });

  it('keeps only the well-typed fields of the answer', () => {
    expect(sanitizeExternalResult(null)).toEqual({ returned: false });
    expect(sanitizeExternalResult({ returned: true, positionMs: 'x', durationMs: -1, ended: 1 })).toEqual({ returned: true, ended: false });
    expect(sanitizeExternalResult({ returned: true, positionMs: 5, durationMs: 9, ended: true })).toEqual({ returned: true, positionMs: 5, durationMs: 9, ended: true });
  });
});

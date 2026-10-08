import { describe, it, expect, vi } from 'vitest';
import { lanServerUrl, tvServerUrl, noWifi, setWatchActions, watchOnTvParams, streamUrlFor, isNoOmp, openInstallGuide, OMP_INSTALL_URL, recordPhoneWatch, watchOnPhone } from '../src/watch';
import { updateSettings } from '../../src/store/settings';
import { getLocalProgress, reloadProgress } from '../../src/store/progress';
import { tvNoOmp } from '../src/tv/tvClient';
import { TorrServerClient } from '../../src/api/torrserver';

describe('watchOnTvParams', () => {
  it('builds the full launch params', () => {
    expect(watchOnTvParams('http://h:8090', 'abc', 3, 1394)).toEqual({ server: 'http://h:8090', torrent: 'abc', file: 3, t: 1394 });
  });
  it('omits file and t when absent', () => {
    const p = watchOnTvParams('http://h:8090', 'abc');
    expect(p).toEqual({ server: 'http://h:8090', torrent: 'abc' });
    expect('file' in p).toBe(false);
    expect('t' in p).toBe(false);
  });
  it('floors t', () => {
    expect(watchOnTvParams('http://h:8090', 'abc', 0, 12.9)).toMatchObject({ file: 0, t: 12 });
  });
  it('keeps t: 0 when a file is set', () => {
    expect(watchOnTvParams('http://h:8090', 'abc', 1, 0)).toEqual({ server: 'http://h:8090', torrent: 'abc', file: 1, t: 0 });
  });
  it('adds report when set', () => {
    expect(watchOnTvParams('http://h:8090', 'abc', 1, 5, 'http://10.0.0.2:7777/p')).toMatchObject({ t: 5, report: 'http://10.0.0.2:7777/p' });
    expect('report' in watchOnTvParams('http://h:8090', 'abc', 1, 5)).toBe(false);
  });
});

describe('watchOnTvParams without file', () => {
  it('drops t when file is undefined', () => {
    expect(watchOnTvParams('http://h:8090', 'abc', undefined, 50)).toEqual({ server: 'http://h:8090', torrent: 'abc' });
  });
});

describe('streamUrlFor', () => {
  it('points at the file stream', () => {
    const c = new TorrServerClient({ url: 'http://h:8090' });
    const url = streamUrlFor(c, { hash: 'abc' } as any, { id: 4, path: 'S/ep 4.mkv', length: 1 });
    expect(url).toBe('http://h:8090/stream/ep%204.mkv?link=abc&index=4&play');
  });
  it('can omit credentials', () => {
    const c = new TorrServerClient({ url: 'http://h:8090', user: 'u', password: 'p' });
    expect(streamUrlFor(c, { hash: 'abc' } as any, { id: 1, path: 'a.mkv', length: 1 }, false)).toBe('http://h:8090/stream/a.mkv?link=abc&index=1&play');
  });
  it('embeds credentials for external players', () => {
    const c = new TorrServerClient({ url: 'http://h:8090', user: 'u', password: 'p' });
    expect(streamUrlFor(c, { hash: 'abc' } as any, { id: 1, path: 'a.mkv', length: 1 })).toContain('http://u:p@h:8090/');
  });
});

describe('install guide', () => {
  it('recognises the no-OMP error only', () => {
    expect(isNoOmp(tvNoOmp())).toBe(true);
    expect(isNoOmp('Нет связи')).toBe(false);
  });
  it('opens the readme in the external browser', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openInstallGuide();
    expect(open).toHaveBeenCalledWith(OMP_INSTALL_URL, '_system');
    expect(OMP_INSTALL_URL).toBe('https://github.com/spacesarmat/omp#readme');
    open.mockRestore();
  });
});

describe('lanServerUrl', () => {
  it('swaps the local host for the phone address, keeping scheme, port and credentials', () => {
    expect(lanServerUrl('http://127.0.0.1:8090', '192.168.1.5')).toBe('http://192.168.1.5:8090');
    expect(lanServerUrl('http://localhost:8090/stream/a.mkv?link=x', '10.0.0.2')).toBe('http://10.0.0.2:8090/stream/a.mkv?link=x');
    expect(lanServerUrl('http://u:p@127.0.0.1:8090/x', '10.0.0.2')).toBe('http://u:p@10.0.0.2:8090/x');
  });
  it('leaves other hosts alone, even without an address', () => {
    expect(lanServerUrl('http://192.168.1.9:8090', '10.0.0.2')).toBe('http://192.168.1.9:8090');
    expect(lanServerUrl('http://192.168.1.9:8090', null)).toBe('http://192.168.1.9:8090');
    expect(lanServerUrl('http://localhost.example.com:8090', '10.0.0.2')).toBe('http://localhost.example.com:8090');
  });
  it('returns null for a local host with no address', () => {
    expect(lanServerUrl('http://127.0.0.1:8090', null)).toBeNull();
  });
});

describe('tvServerUrl', () => {
  it('uses the phone address, or throws the Wi-Fi error', async () => {
    setWatchActions({ localIpv4: async () => '192.168.1.5' });
    expect(await tvServerUrl('http://127.0.0.1:8090')).toBe('http://192.168.1.5:8090');
    setWatchActions({ localIpv4: async () => null });
    await expect(tvServerUrl('http://127.0.0.1:8090')).rejects.toThrow(noWifi());
    expect(await tvServerUrl('http://tv-side:8090')).toBe('http://tv-side:8090');
    setWatchActions(null);
  });
});

describe('watch journal from the phone', () => {
  it('sends the phone name to the TV only with a file', () => {
    expect(watchOnTvParams('http://h:8090', 'abc', 1, 5, undefined, 'Pixel 7')).toEqual({ server: 'http://h:8090', torrent: 'abc', file: 1, t: 5, from: 'Pixel 7' });
    expect('from' in watchOnTvParams('http://h:8090', 'abc', undefined, undefined, undefined, 'Pixel 7')).toBe(false);
  });

  it('records with the phone name, floors the position, never rejects', async () => {
    const c = new TorrServerClient({ url: 'http://h:8090' });
    const rec = vi.fn().mockResolvedValue(undefined);
    setWatchActions({ phoneName: async () => ' Pixel 7 ', recordWatch: rec });
    await recordPhoneWatch(c, 'abc', 2, 125.8, 2900.4);
    expect(rec).toHaveBeenCalledWith(c, 'abc', { f: 2, t: 125, d: 2900, src: 'phone', name: 'Pixel 7' });
    setWatchActions({ phoneName: async () => { throw new Error('x'); }, recordWatch: rec });
    await recordPhoneWatch(c, 'abc', 2, 0, 0);
    expect(rec.mock.calls[1][2].name).toBe('Телефон');
    setWatchActions({ phoneName: async () => 'P', recordWatch: () => Promise.reject(new Error('down')) });
    await expect(recordPhoneWatch(c, 'abc', 2, 0, 0)).resolves.toBeUndefined();
    await expect(recordPhoneWatch(null, 'abc', 2, 0, 0)).resolves.toBeUndefined();
    setWatchActions(null);
  });
});

describe('watchOnPhone', () => {
  const c = new TorrServerClient({ url: 'http://h:8090' });
  const tor = { hash: 'abc', title: 'Show S01', file_stats: [1, 2, 3].map((i) => ({ id: i, path: 'Show.S01E0' + i + '.mkv', length: 1e9 })) };
  const w = (id: number, at = 0) => ({ hash: 'abc', file: tor.file_stats[id - 1], title: 'S01E0' + id, at, duration: 0 });
  const mk = () => ({
    open2160: vi.fn().mockResolvedValue({ returned: false }),
    embedded2160: vi.fn().mockResolvedValue(true),
    playEmbedded2160: vi.fn().mockResolvedValue({ returned: false }),
    openExternal: vi.fn().mockResolvedValue(undefined),
    player2160: vi.fn().mockResolvedValue('pkg'),
    recordWatch: vi.fn().mockResolvedValue(undefined),
    phoneName: async () => 'P',
  });
  const reset = () => {
    localStorage.clear();
    reloadProgress();
    vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
    vi.spyOn(TorrServerClient.prototype, 'setViewed').mockResolvedValue(undefined);
  };
  const done = () => {
    setWatchActions(null);
    updateSettings({ phonePlayer: 'embedded' });
    vi.restoreAllMocks();
  };

  it('«Встроенный» (the default): the queue goes to the embedded 2160 screen; the stop is saved like with the app', async () => {
    reset();
    const a = mk();
    setWatchActions(a);
    updateSettings({ phonePlayer: 'embedded' });
    a.playEmbedded2160.mockResolvedValue({ returned: true, positionMs: 600000, durationMs: 2400000, url: 'http://h:8090/stream/Show.S01E03.mkv?link=abc&index=3&play' });
    await watchOnPhone(c, tor as any, w(2, 125.7));
    const o = a.playEmbedded2160.mock.calls[0][0];
    expect(o.items).toHaveLength(3);
    expect(o.start).toBe(1);
    expect(o).toMatchObject({ positionMs: 125000, fromStart: false, background: false });
    expect(a.open2160).not.toHaveBeenCalled();
    expect(a.player2160).not.toHaveBeenCalled();
    expect(a.openExternal).not.toHaveBeenCalled();
    expect(getLocalProgress('abc', 3)).toMatchObject({ time: 600, duration: 2400 });
    expect(a.recordWatch.mock.calls[0][2]).toMatchObject({ f: 2, t: 125, src: 'phone' });
    done();
  });

  it('«Звук в фоне» goes with the embedded queue', async () => {
    reset();
    const a = mk();
    setWatchActions(a);
    updateSettings({ phonePlayer: 'embedded', backgroundAudio: true });
    await watchOnPhone(c, tor as any, w(2, 0));
    expect(a.playEmbedded2160.mock.calls[0][0]).toMatchObject({ background: true });
    updateSettings({ backgroundAudio: false });
    done();
  });

  it('«Встроенный» in an app without the embedded screen falls back to the chooser', async () => {
    reset();
    const a = mk();
    a.embedded2160.mockResolvedValue(false);
    setWatchActions(a);
    await watchOnPhone(c, tor as any, w(1, 300));
    expect(a.playEmbedded2160).not.toHaveBeenCalled();
    expect(a.openExternal).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(a.recordWatch).toHaveBeenCalledTimes(1));
    expect(a.recordWatch.mock.calls[0][2]).toMatchObject({ f: 1, t: 0 });
    a.embedded2160.mockRejectedValue(new Error('x'));
    await watchOnPhone(c, tor as any, w(1));
    expect(a.openExternal).toHaveBeenCalledTimes(2);
    done();
  });

  it('«Встроенный» off-device (no plugin method): the real actions fall back to the chooser', async () => {
    reset();
    const openExternal = vi.fn().mockResolvedValue(undefined);
    setWatchActions({ openExternal, recordWatch: vi.fn().mockResolvedValue(undefined), phoneName: async () => 'P' });
    await watchOnPhone(c, tor as any, w(1));
    expect(openExternal).toHaveBeenCalledTimes(1);
    done();
  });

  it('2160 Player (app): queue, start index, resume position; the stop on another item is saved for it', async () => {
    reset();
    const a = mk();
    setWatchActions(a);
    updateSettings({ phonePlayer: 'p2160' });
    a.open2160.mockResolvedValue({ returned: true, positionMs: 600000, durationMs: 2400000, url: 'http://h:8090/stream/Show.S01E03.mkv?link=abc&index=3&play' });
    await watchOnPhone(c, tor as any, w(2, 125.7));
    const o = a.open2160.mock.calls[0][0];
    expect(o.items).toHaveLength(3);
    expect(o.start).toBe(1);
    expect(o).toMatchObject({ positionMs: 125000, fromStart: false });
    expect(a.openExternal).not.toHaveBeenCalled();
    expect(a.playEmbedded2160).not.toHaveBeenCalled();
    expect(getLocalProgress('abc', 3)).toMatchObject({ time: 600, duration: 2400 });
    expect(getLocalProgress('abc', 2)).toBeNull();
    expect(a.recordWatch.mock.calls[0][2]).toMatchObject({ f: 2, t: 125, src: 'phone' });
    done();
  });

  it('the plugin rejection reaches the caller', async () => {
    reset();
    const a = mk();
    setWatchActions(a);
    updateSettings({ phonePlayer: 'p2160' });
    a.open2160.mockRejectedValue(new Error('нет ссылки'));
    await expect(watchOnPhone(c, tor as any, w(1))).rejects.toThrow('нет ссылки');
    updateSettings({ phonePlayer: 'embedded' });
    a.playEmbedded2160.mockRejectedValue(new Error('не открылся'));
    await expect(watchOnPhone(c, tor as any, w(1))).rejects.toThrow('не открылся');
    done();
  });

  it('«Выбор Android» or a missing 2160 Player app goes through openExternal', async () => {
    reset();
    const a = mk();
    setWatchActions(a);
    updateSettings({ phonePlayer: 'chooser' });
    await watchOnPhone(c, tor as any, w(1));
    expect(a.open2160).not.toHaveBeenCalled();
    expect(a.playEmbedded2160).not.toHaveBeenCalled();
    expect(a.openExternal).toHaveBeenCalledTimes(1);
    updateSettings({ phonePlayer: 'p2160' });
    a.player2160.mockResolvedValue(null);
    await watchOnPhone(c, tor as any, w(1));
    expect(a.open2160).not.toHaveBeenCalled();
    expect(a.playEmbedded2160).not.toHaveBeenCalled();
    expect(a.openExternal).toHaveBeenCalledTimes(2);
    done();
  });
});

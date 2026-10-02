import { describe, it, expect, vi } from 'vitest';
import { lanServerUrl, tvServerUrl, NO_WIFI, setWatchActions, watchOnTvParams, streamUrlFor, isNoOmp, openInstallGuide, OMP_INSTALL_URL, recordPhoneWatch } from '../src/watch';
import { TV_NO_OMP } from '../src/tv/tvClient';
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
    expect(isNoOmp(TV_NO_OMP)).toBe(true);
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
    await expect(tvServerUrl('http://127.0.0.1:8090')).rejects.toThrow(NO_WIFI);
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

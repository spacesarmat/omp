import { describe, it, expect, vi } from 'vitest';
import { watchOnTvParams, streamUrlFor, isNoOmp, openInstallGuide, OMP_INSTALL_URL } from '../src/watch';
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
  it('omits a non-positive t', () => {
    expect('t' in watchOnTvParams('http://h:8090', 'abc', 1, 0)).toBe(false);
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

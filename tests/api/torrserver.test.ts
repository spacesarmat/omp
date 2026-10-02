import { describe, it, expect, vi, afterEach } from 'vitest';
import { TorrServerClient, normalizeServerUrl, parseTorrentData } from '../../src/api/torrserver';
import { mockFetch } from '../helpers/fetchMock';

afterEach(() => vi.unstubAllGlobals());

const HASH = 'c4c4bd6a4618e1042aa89649d629f85951eff546';

describe('normalizeServerUrl', () => {
  it('adds scheme and default port', () => {
    expect(normalizeServerUrl(' 192.168.1.191 ')).toBe('http://192.168.1.191:8090');
    expect(normalizeServerUrl('192.168.1.191:5665')).toBe('http://192.168.1.191:5665');
    expect(normalizeServerUrl('http://192.168.1.191:5665/')).toBe('http://192.168.1.191:5665');
    expect(normalizeServerUrl('https://ts.local')).toBe('https://ts.local');
  });
});

describe('parseTorrentData', () => {
  it('reads files from data json', () => {
    const data = JSON.stringify({ TorrServer: { Files: [{ id: 1, path: 'a/b.mkv', length: 5 }] } });
    expect(parseTorrentData(data)).toEqual([{ id: 1, path: 'a/b.mkv', length: 5 }]);
    expect(parseTorrentData('')).toEqual([]);
    expect(parseTorrentData('garbage')).toEqual([]);
    expect(parseTorrentData(undefined)).toEqual([]);
  });
});

describe('TorrServerClient', () => {
  const c = new TorrServerClient({ url: '192.168.1.191:5665' });

  it('lists torrents', async () => {
    const fn = mockFetch(() => ({ body: JSON.stringify([{ hash: HASH, title: 'T', stat: 5 }]) }));
    const list = await c.list();
    expect(list[0].hash).toBe(HASH);
    expect(fn.mock.calls[0][0]).toBe('http://192.168.1.191:5665/torrents');
    expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ action: 'list' });
  });

  it('list returns [] for null', async () => {
    mockFetch(() => ({ body: 'null' }));
    expect(await c.list()).toEqual([]);
  });

  it('sends auth header when configured', async () => {
    const fn = mockFetch(() => ({ body: 'MatriX.145.1' }));
    const ac = new TorrServerClient({ url: 'h:1', user: 'u', password: 'p' });
    expect(await ac.echo()).toBe('MatriX.145.1');
    expect(fn.mock.calls[0][1].headers.Authorization).toBe('Basic ' + btoa('u:p'));
  });

  it('adds torrent', async () => {
    const fn = mockFetch(() => ({ body: JSON.stringify({ hash: HASH, title: 'X', stat: 1 }) }));
    await c.add({ link: 'magnet:?xt=urn:btih:' + HASH, title: 'X', category: 'movie' });
    expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({
      action: 'add', link: 'magnet:?xt=urn:btih:' + HASH, title: 'X', poster: '', category: 'movie', save_to_db: true,
    });
  });

  it('files() prefers file_stats then data', () => {
    expect(c.files({ hash: HASH, title: 'T', stat: 3, file_stats: [{ id: 2, path: 'x.mkv', length: 1 }] })[0].id).toBe(2);
    const data = JSON.stringify({ TorrServer: { Files: [{ id: 7, path: 'y.mkv', length: 1 }] } });
    expect(c.files({ hash: HASH, title: 'T', stat: 5, data })[0].id).toBe(7);
  });

  it('builds stream urls', () => {
    expect(c.streamUrl(HASH, 2, 'Ep 01.mkv')).toBe(`http://192.168.1.191:5665/stream/Ep%2001.mkv?link=${HASH}&index=2&play`);
    expect(c.playlistUrl(HASH)).toBe(`http://192.168.1.191:5665/playlist?hash=${HASH}`);
    expect(c.allPlaylistUrl()).toBe('http://192.168.1.191:5665/playlistall/all.m3u');
  });

  it('videoSrc injects credentials only for own server', () => {
    const ac = new TorrServerClient({ url: 'http://h:1', user: 'u', password: 'p w' });
    expect(ac.videoSrc('http://h:1/stream/a?link=x')).toBe('http://u:p%20w@h:1/stream/a?link=x');
    expect(ac.videoSrc('http://other/a.mp4')).toBe('http://other/a.mp4');
    expect(c.videoSrc('http://192.168.1.191:5665/x')).toBe('http://192.168.1.191:5665/x');
  });

  it('videoSrc does NOT inject credentials for prefix-match false positives', () => {
    const ac = new TorrServerClient({ url: 'http://h:1', user: 'u', password: 'p' });
    expect(ac.videoSrc('http://h:10/x')).toBe('http://h:10/x');
    expect(ac.videoSrc('http://h:1.evil.example/x')).toBe('http://h:1.evil.example/x');
  });

  it('fetchText sends Authorization for own-server URL only', async () => {
    const fn = mockFetch(() => ({ body: 'data' }));
    const ac = new TorrServerClient({ url: 'http://h:1', user: 'u', password: 'p' });
    await ac.fetchText('http://h:1/x');
    expect(fn.mock.calls[0][1].headers.Authorization).toBe('Basic ' + btoa('u:p'));
    await ac.fetchText('http://h:10/x');
    expect(fn.mock.calls[1][1].headers.Authorization).toBeUndefined();
  });

  it('searches with trailing slash path', async () => {
    const fn = mockFetch(() => ({ body: '[]' }));
    await c.search('matrix x', 'rutor');
    await c.search('matrix', 'torznab');
    expect(fn.mock.calls[0][0]).toBe('http://192.168.1.191:5665/search/?query=matrix%20x');
    expect(fn.mock.calls[1][0]).toBe('http://192.168.1.191:5665/torznab/search/?query=matrix');
  });

  it('sets viewed with timecode', async () => {
    const fn = mockFetch(() => ({ body: '' }));
    await c.setViewed(HASH, 3, 125);
    expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ action: 'set', hash: HASH, file_index: 3, timecode: 125 });
  });

  it('probe returns null on failure', async () => {
    mockFetch(() => ({ status: 500, body: '' }));
    expect(await c.probe(HASH, 1)).toBeNull();
  });

  it('fetchBytes returns ArrayBuffer', async () => {
    mockFetch(() => ({ body: 'abc' }));
    const b = await c.fetchBytes('http://192.168.1.191:5665/stream/s.srt?link=x&index=1&play');
    expect(b.byteLength).toBe(3);
  });
});

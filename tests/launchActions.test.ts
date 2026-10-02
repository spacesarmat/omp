import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detachPhone, phoneAttached } from '../src/phone/link';
import { mockFetch } from './helpers/fetchMock';
import { runLaunchParams } from '../src/launchActions';
import { servers, activeServerId, addServer, setActiveServer } from '../src/store/servers';
import { routeStack } from '../src/ui/nav';

const HASH = 'abcdef0123456789abcdef0123456789abcdef01';
const top = () => routeStack.value[routeStack.value.length - 1];

beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  activeServerId.value = null;
  routeStack.value = [{ name: 'connect' }];
});

describe('runLaunchParams', () => {
  it('open=update opens the update screen and checks the feed', () => {
    const seen: string[] = [];
    mockFetch((u) => {
      seen.push(String(u));
      return { body: '{}' };
    });
    routeStack.value = [{ name: 'library' }];
    runLaunchParams({ open: 'update' });
    expect(top()).toEqual({ name: 'update' });
    expect(seen.some((u) => u.indexOf('update') >= 0)).toBe(true);
  });
  it('does nothing for empty params', () => {
    runLaunchParams(null);
    runLaunchParams('{}');
    expect(routeStack.value).toEqual([{ name: 'connect' }]);
  });
  it('selects a server and opens the library', () => {
    runLaunchParams('{"server":"192.168.1.10:8090"}');
    expect(servers.value[0].url).toBe('http://192.168.1.10:8090');
    expect(activeServerId.value).toBe(servers.value[0].id);
    expect(routeStack.value).toEqual([{ name: 'library' }]);
  });
  it('plays a URL directly', () => {
    runLaunchParams({ play: 'https://cdn.example/a.mp4', title: 'A' });
    expect(top()).toEqual({ name: 'player', queue: [{ url: 'https://cdn.example/a.mp4', title: 'A' }], index: 0 });
  });
  it('needs a server for torrent and magnet', () => {
    runLaunchParams({ torrent: HASH });
    expect(routeStack.value).toEqual([{ name: 'connect' }]);
  });
  it('opens a torrent on the active server', () => {
    setActiveServer(addServer({ url: 'h:1' }).id);
    routeStack.value = [{ name: 'library' }];
    runLaunchParams({ torrent: HASH });
    expect(top()).toEqual({ name: 'torrent', hash: HASH });
  });
  it('adds a magnet and opens the new torrent', async () => {
    mockFetch(() => ({ body: JSON.stringify({ hash: HASH, title: 'T', stat: 1 }) }));
    runLaunchParams({ server: 'h:2', magnet: 'magnet:?xt=urn:btih:' + HASH });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(top()).toEqual({ name: 'torrent', hash: HASH });
  });
  it('ignores invalid params without navigating', () => {
    runLaunchParams({ play: 'file:///x' });
    expect(routeStack.value).toEqual([{ name: 'connect' }]);
  });
  it('plays a file of a torrent from a position', async () => {
    setActiveServer(addServer({ url: 'h:1' }).id);
    routeStack.value = [{ name: 'library' }];
    mockFetch(() => ({ body: JSON.stringify({ hash: HASH, title: 'T', stat: 3, file_stats: [{ id: 1, path: 'S/a.S01E01.mkv', length: 10 }, { id: 3, path: 'S/a.S01E03.mkv', length: 10 }] }) }));
    runLaunchParams({ torrent: HASH, file: 3, t: 1394 });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const top = routeStack.value[routeStack.value.length - 1] as any;
    expect(top.name).toBe('player');
    expect(top.queue[top.index].fileIndex).toBe(3);
    expect(top.startAt).toBe(1394);
    expect('from' in top).toBe(false);
  });
  it('passes the launching phone to the player (watch journal source)', async () => {
    setActiveServer(addServer({ url: 'h:1' }).id);
    routeStack.value = [{ name: 'library' }];
    mockFetch(() => ({ body: JSON.stringify({ hash: HASH, title: 'T', stat: 3, file_stats: [{ id: 3, path: 'S/a.S01E03.mkv', length: 10 }] }) }));
    runLaunchParams({ torrent: HASH, file: 3, t: 0, from: 'Pixel 7' });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const top = routeStack.value[routeStack.value.length - 1] as any;
    expect(top.name).toBe('player');
    expect(top.from).toBe('Pixel 7');
  });
  it('replaces a player already on top (the old player is never remounted)', async () => {
    setActiveServer(addServer({ url: 'h:1' }).id);
    routeStack.value = [{ name: 'library' }, { name: 'player', queue: [{ url: 'http://x/old.mkv', title: 'old' }], index: 0 }];
    runLaunchParams({ play: 'https://cdn.example/a.mp4', title: 'A' });
    expect(routeStack.value.map((r) => r.name)).toEqual(['library', 'player']);
    expect((top() as any).queue[0].title).toBe('A');
    mockFetch(() => ({ body: JSON.stringify({ hash: HASH, title: 'T', stat: 3, file_stats: [{ id: 3, path: 'S/a.S01E03.mkv', length: 10 }] }) }));
    runLaunchParams({ torrent: HASH, file: 3, t: 5 });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(routeStack.value.map((r) => r.name)).toEqual(['library', 'player']);
    expect((top() as any).startAt).toBe(5);
  });
});

describe('report launch param', () => {
  afterEach(() => detachPhone());
  it('attaches the phone and does nothing else for a report-only plan', () => {
    runLaunchParams({ report: 'http://192.168.1.5:8765/r' });
    expect(phoneAttached.value).toBe(true);
    expect(routeStack.value).toEqual([{ name: 'connect' }]);
  });
  it('attaches and still plays', () => {
    runLaunchParams({ report: 'http://192.168.1.5:8765/r', play: 'https://cdn.example/a.mp4', title: 'A' });
    expect(phoneAttached.value).toBe(true);
    expect(top().name).toBe('player');
  });
});

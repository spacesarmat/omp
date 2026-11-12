import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectServerMock = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, server: { id: 's1' }, version: '1' })));
const sendCmdMock = vi.hoisted(() => vi.fn());
const watchOnPhoneMock = vi.hoisted(() => vi.fn(async (_c: unknown, _t: unknown, _w: unknown) => ({})));
const searchAllMock = vi.hoisted(() => {
  let failed: string[] = [];
  const mock = vi.fn((_query: string, _options: unknown) => ({
    results: () => [],
    pending: () => [],
    failed: () => failed,
    done: Promise.resolve(),
  }));
  return Object.assign(mock, {
    __setFailed: (ids: string[]) => {
      failed = ids;
    },
  });
});
const buildTorrentQueueMock = vi.hoisted(() => vi.fn((_c: unknown, _t: unknown, _files: unknown) => [{ url: 'u', title: 't', hash: 'h', fileIndex: 0 }]));

vi.mock('../mobile/src/connect/connectServer', () => ({ connectServer: connectServerMock }));
vi.mock('../mobile/src/tv/playerLink', async () => {
  const { signal } = await import('@preact/signals');
  return { nowPlaying: signal(null as import('../src/phone/protocol').PlayerState | null), sendCmd: sendCmdMock };
});
vi.mock('../mobile/src/watch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../mobile/src/watch')>();
  return { ...actual, watchOnPhone: watchOnPhoneMock };
});
vi.mock('../src/sources/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/sources/search')>();
  return { ...actual, searchAll: searchAllMock };
});
vi.mock('../src/player/queue', () => ({ buildTorrentQueue: buildTorrentQueueMock }));

import { nowPlaying } from '../mobile/src/tv/playerLink';
import { torrents } from '../src/store/library';
import { clearHealth, setHealth } from '../src/sources/store';
import type { Torrent } from '../src/api/types';

import { createTvFlowDispatcher } from '../src/productionFlowDispatcher';
import { createPhoneFlowDispatcher } from '../mobile/src/productionFlowDispatcher';
import { createDesktopFlowDispatcher } from '../desktop/src/productionFlowDispatcher';
import { unavailableProductionAction } from '../design/production-flow';
import { currentRoute as tvRoute, routeKey, routeStack as tvStack } from '../src/ui/nav';
import { currentRoute as phoneRoute, routeStack as phoneStack } from '../mobile/src/nav';
import { activeServerId, addServer, servers } from '../src/store/servers';

function playing(patch: Partial<import('../src/phone/protocol').PlayerState> = {}): import('../src/phone/protocol').PlayerState {
  return {
    hash: 'h',
    file: 1,
    title: 'T',
    subtitle: '',
    time: 10,
    duration: 100,
    paused: false,
    buffering: false,
    audio: { list: [], sel: 0 },
    subs: { list: [], sel: '' },
    next: null,
    ...patch,
  };
}

beforeEach(() => {
  servers.value = [];
  activeServerId.value = null;
  nowPlaying.value = null;
  torrents.value = [];
  connectServerMock.mockClear();
  sendCmdMock.mockClear();
  watchOnPhoneMock.mockClear();
  searchAllMock.mockClear();
  searchAllMock.__setFailed([]);
  clearHealth('ts-rutor');
  clearHealth('ts-torznab');
  buildTorrentQueueMock.mockClear();
  tvStack.value = [{ name: 'connect' }];
  phoneStack.value = [{ name: 'connect' }];
  vi.restoreAllMocks();
});

describe('unavailableProductionAction', () => {
  it('returns a documented platform validation error', () => {
    expect(unavailableProductionAction('playback.stop', 'phone', 'no stop command')).toEqual({
      ok: false,
      error: 'playback.stop is unavailable on phone: no stop command',
    });
  });
});

describe('tv flow dispatcher', () => {
  it('navigates, opens screens, goes back and shows toasts through the shell APIs', () => {
    const dispatcher = createTvFlowDispatcher();
    expect(dispatcher.navigate('library')).toEqual({ ok: true });
    expect(tvRoute.value.name).toBe('library');
    expect(dispatcher.openScreen('settings')).toEqual({ ok: true });
    expect(tvRoute.value.name).toBe('settings');
    expect(dispatcher.back()).toEqual({ ok: true });
    expect(tvRoute.value.name).toBe('library');
    expect(dispatcher.toast('hi')).toEqual({ ok: true });
    expect(dispatcher.dialog('T', 'M')).toEqual({ ok: true });
  });

  it('connects the active server through the existing connect helper', async () => {
    const dispatcher = createTvFlowDispatcher();
    expect(dispatcher.serverConnect()).toMatchObject({ ok: false, error: expect.stringContaining('no active server') });
    addServer({ url: 'http://192.168.1.5:8090' });
    const server = servers.value[0];
    activeServerId.value = server.id;
    expect(dispatcher.serverRetry()).toEqual({ ok: true });
    expect(dispatcher.serverReconnect()).toEqual({ ok: true });
    expect(connectServerMock).toHaveBeenCalledTimes(2);
    expect(connectServerMock).toHaveBeenCalledWith({ url: server.url });
  });

  it('reports documented errors for player-owned actions', () => {
    const dispatcher = createTvFlowDispatcher();
    for (const call of [
      () => dispatcher.playbackPlayPause(),
      () => dispatcher.playbackNextEpisode(),
    ]) {
      const outcome = call();
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toContain('tv');
    }
    expect(sendCmdMock).not.toHaveBeenCalled();
  });

  it('stops playback by leaving the player route', () => {
    const dispatcher = createTvFlowDispatcher();
    expect(dispatcher.playbackStop()).toMatchObject({ ok: false, error: expect.stringContaining('player screen') });
    tvStack.value = [{ name: 'library' }, { name: 'player', queue: [], index: 0 }];
    expect(dispatcher.playbackStop()).toEqual({ ok: true });
    expect(tvRoute.value.name).toBe('library');
  });

  it('replaces the queue from the active torrent screen', () => {
    const dispatcher = createTvFlowDispatcher();
    expect(dispatcher.queueReplace()).toMatchObject({ ok: false, error: expect.stringContaining('torrent screen') });
    torrents.value = [{ hash: 'abc', title: 'T', stat: 5, stat_string: 'Done', torrent_size: 10, loaded_size: 10, file_stats: [{ id: 1, path: '/T.mkv', length: 5 }] }];
    tvStack.value = [{ name: 'library' }, { name: 'torrent', hash: 'abc' }];
    addServer({ url: 'http://192.168.1.9:8090' });
    activeServerId.value = servers.value[0].id;
    expect(dispatcher.queueReplace()).toEqual({ ok: true });
    expect(buildTorrentQueueMock).toHaveBeenCalledOnce();
    expect(tvRoute.value.name).toBe('player');
  });

  it('appends the active torrent to the open player queue without touching playback', () => {
    const dispatcher = createTvFlowDispatcher();
    expect(dispatcher.queueAdd()).toMatchObject({ ok: false, error: expect.stringContaining('torrent screen') });
    torrents.value = [{ hash: 'abc', title: 'T', stat: 5, stat_string: 'Done', torrent_size: 10, loaded_size: 10, file_stats: [{ id: 1, path: '/T.mkv', length: 5 }] }];
    addServer({ url: 'http://192.168.1.9:8090' });
    activeServerId.value = servers.value[0].id;
    tvStack.value = [{ name: 'library' }, { name: 'torrent', hash: 'abc' }];
    expect(dispatcher.queueAdd()).toMatchObject({ ok: false, error: expect.stringContaining('no open player queue') });
    const existing = { url: 'old', title: 'old', hash: 'old', fileIndex: 0 };
    tvStack.value = [{ name: 'library' }, { name: 'player', queue: [existing], index: 0 }, { name: 'torrent', hash: 'abc' }];
    const playerBefore = tvStack.value[1];
    const keyBefore = routeKey(playerBefore);
    expect(dispatcher.queueAdd()).toEqual({ ok: true });
    // The player route keeps its object identity (and screen key), so rendering it again does
    // not remount PlayerScreen: the current index and item stay, playback is not restarted.
    const player = tvStack.value[1];
    expect(player).toBe(playerBefore);
    expect(routeKey(player)).toBe(keyBefore);
    expect(player.name).toBe('player');
    if (player.name !== 'player') throw new Error('player route expected');
    expect(player.queue[0]).toBe(existing);
    expect(player.queue).toHaveLength(2);
    expect(player.index).toBe(0);
    expect(tvRoute.value.name).toBe('torrent');
  });

  it('retries the failed sources of the current search and rotates to the next available one', async () => {
    const dispatcher = createTvFlowDispatcher({ sourceContext: () => ({}) as never });
    expect(dispatcher.sourceRetry()).toMatchObject({ ok: false, error: expect.stringContaining('query') });
    tvStack.value = [{ name: 'library' }, { name: 'add', query: 'terminator' }];
    searchAllMock.__setFailed(['ts-rutor']);
    expect(dispatcher.sourceRetry()).toEqual({ ok: true });
    expect(searchAllMock).toHaveBeenLastCalledWith('terminator', expect.not.objectContaining({ sources: expect.anything() }));
    await Promise.resolve();
    searchAllMock.mockClear();
    expect(dispatcher.sourceRetry()).toEqual({ ok: true });
    expect(searchAllMock).toHaveBeenLastCalledWith('terminator', expect.objectContaining({ sources: ['ts-rutor'] }));
    searchAllMock.mockClear();
    setHealth('ts-rutor', { state: 'error', at: Date.now() });
    expect(dispatcher.sourceNext()).toEqual({ ok: true });
    expect(searchAllMock).toHaveBeenLastCalledWith('terminator', expect.objectContaining({ sources: ['ts-torznab'] }));
    setHealth('ts-torznab', { state: 'login', at: Date.now() });
    expect(dispatcher.sourceNext()).toMatchObject({ ok: false, error: expect.stringContaining('unavailable') });
  });
});

describe('phone flow dispatcher', () => {
  it('navigates through the phone nav and opens links with the injected opener', () => {
    const openUrl = vi.fn();
    const dispatcher = createPhoneFlowDispatcher({ openUrl });
    expect(dispatcher.navigate('library')).toEqual({ ok: true });
    expect(phoneRoute.value.name).toBe('library');
    expect(dispatcher.back()).toEqual({ ok: true });
    expect(phoneRoute.value.name).toBe('connect');
    expect(dispatcher.toast('hi')).toEqual({ ok: true });
    expect(dispatcher.dialog('T', 'M')).toEqual({ ok: true });
    expect(dispatcher.linkOpen('https://t.me/ompplyaer')).toEqual({ ok: true });
    expect(openUrl).toHaveBeenCalledWith('https://t.me/ompplyaer');
    expect(dispatcher.telegramOpen('billing-bot')).toEqual({ ok: true });
    expect(openUrl).toHaveBeenLastCalledWith(expect.stringContaining('t.me/'));
  });

  it('reconnects the active server through the existing connect helper', () => {
    const dispatcher = createPhoneFlowDispatcher({ openUrl: vi.fn() });
    addServer({ url: 'http://192.168.1.7:8090' });
    activeServerId.value = servers.value[0].id;
    expect(dispatcher.serverConnect()).toEqual({ ok: true });
    expect(connectServerMock).toHaveBeenCalledWith({ url: 'http://192.168.1.7:8090' });
  });

  it('toggles playback and advances episodes through the player command channel', () => {
    const dispatcher = createPhoneFlowDispatcher({ openUrl: vi.fn() });
    expect(dispatcher.playbackPlayPause()).toMatchObject({ ok: false, error: expect.stringContaining('no active playback') });
    nowPlaying.value = playing({ paused: true });
    expect(dispatcher.playbackPlayPause()).toEqual({ ok: true });
    expect(sendCmdMock).toHaveBeenLastCalledWith({ type: 'play' });
    nowPlaying.value = playing({ paused: false });
    expect(dispatcher.playbackPlayPause()).toEqual({ ok: true });
    expect(sendCmdMock).toHaveBeenLastCalledWith({ type: 'pause' });
    expect(dispatcher.playbackNextEpisode()).toMatchObject({ ok: false, error: expect.stringContaining('no next episode') });
    nowPlaying.value = playing({ next: { title: 'E2' } });
    expect(dispatcher.playbackNextEpisode()).toEqual({ ok: true });
    expect(sendCmdMock).toHaveBeenLastCalledWith({ type: 'next' });
  });

  it('ends playback with the player end-of-item semantics (pause, seek to end)', () => {
    const dispatcher = createPhoneFlowDispatcher({ openUrl: vi.fn() });
    expect(dispatcher.playbackStop()).toMatchObject({ ok: false, error: expect.stringContaining('no active playback') });
    nowPlaying.value = playing({ duration: 100, time: 10 });
    expect(dispatcher.playbackStop()).toEqual({ ok: true });
    expect(sendCmdMock).toHaveBeenCalledWith({ type: 'pause' });
    expect(sendCmdMock).toHaveBeenCalledWith({ type: 'seek', t: 100 });
  });

  it('replaces the queue with the first unwatched file of the active torrent', () => {
    const dispatcher = createPhoneFlowDispatcher({ openUrl: vi.fn() });
    expect(dispatcher.queueReplace()).toMatchObject({ ok: false, error: expect.stringContaining('torrent screen') });
    torrents.value = [{ hash: 'abc', title: 'T', stat: 0, torrent_size: 100, loaded_size: 10, file_stats: [{ id: 1, path: '/T/E01.mkv', length: 5 }, { id: 2, path: '/T/E02.mkv', length: 5 }] }];
    phoneStack.value = [{ name: 'library' }, { name: 'torrent', hash: 'abc' }];
    addServer({ url: 'http://192.168.1.7:8090' });
    activeServerId.value = servers.value[0].id;
    expect(dispatcher.queueReplace()).toEqual({ ok: true });
    expect(watchOnPhoneMock).toHaveBeenCalledOnce();
    const [, torrent, watch] = watchOnPhoneMock.mock.calls[0] as [unknown, { hash: string }, { hash: string; file: { id: number }; title: string }];
    expect(torrent.hash).toBe('abc');
    expect(watch.hash).toBe('abc');
    expect(watch.file.id).toBe(1);
    expect(watch.title).toBe('E01.mkv');
  });

  it('retries the search query and rotates to the next enabled source', () => {
    const dispatcher = createPhoneFlowDispatcher({ openUrl: vi.fn(), sourceContext: () => ({}) as never });
    expect(dispatcher.sourceRetry()).toMatchObject({ ok: false, error: expect.stringContaining('query') });
    phoneStack.value = [{ name: 'library' }, { name: 'add', query: 'matrix' }];
    expect(dispatcher.sourceRetry()).toEqual({ ok: true });
    expect(searchAllMock).toHaveBeenLastCalledWith('matrix', expect.objectContaining({ ctx: expect.anything() }));
    const first = searchAllMock.mock.calls.length;
    expect(dispatcher.sourceNext()).toEqual({ ok: true });
    expect(searchAllMock).toHaveBeenCalledTimes(first + 1);
    expect(searchAllMock.mock.calls[first][1]).toHaveProperty('sources');
  });

  it('reports documented errors for actions the phone cannot perform', () => {
    const dispatcher = createPhoneFlowDispatcher({ openUrl: vi.fn() });
    for (const call of [
      () => dispatcher.queueAdd(),
    ]) {
      const outcome = call();
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toContain('phone');
    }
  });
});

describe('desktop flow dispatcher', () => {
  it('reuses the phone dispatcher with a desktop link opener', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const dispatcher = createDesktopFlowDispatcher();
    expect(dispatcher.linkOpen('https://example.invalid')).toEqual({ ok: true });
    expect(openSpy).toHaveBeenCalledWith('https://example.invalid', '_blank', 'noopener');
  });
});

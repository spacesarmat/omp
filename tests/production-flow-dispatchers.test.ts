import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectServerMock = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, server: { id: 's1' }, version: '1' })));
const sendCmdMock = vi.hoisted(() => vi.fn());

vi.mock('../mobile/src/connect/connectServer', () => ({ connectServer: connectServerMock }));
vi.mock('../mobile/src/tv/playerLink', async () => {
  const { signal } = await import('@preact/signals');
  return { nowPlaying: signal(null as import('../src/phone/protocol').PlayerState | null), sendCmd: sendCmdMock };
});

import { nowPlaying } from '../mobile/src/tv/playerLink';

import { createTvFlowDispatcher } from '../src/productionFlowDispatcher';
import { createPhoneFlowDispatcher } from '../mobile/src/productionFlowDispatcher';
import { createDesktopFlowDispatcher } from '../desktop/src/productionFlowDispatcher';
import { unavailableProductionAction } from '../design/production-flow';
import { currentRoute as tvRoute, routeStack as tvStack } from '../src/ui/nav';
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
  connectServerMock.mockClear();
  sendCmdMock.mockClear();
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

  it('reports documented errors for player-owned and context-free actions', () => {
    const dispatcher = createTvFlowDispatcher();
    for (const call of [
      () => dispatcher.playbackPlayPause(),
      () => dispatcher.playbackStop(),
      () => dispatcher.playbackNextEpisode(),
      () => dispatcher.queueAdd(),
      () => dispatcher.queueReplace(),
      () => dispatcher.sourceRetry(),
      () => dispatcher.sourceNext(),
    ]) {
      const outcome = call();
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toContain('tv');
    }
    expect(sendCmdMock).not.toHaveBeenCalled();
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

  it('reports documented errors for actions the phone cannot perform', () => {
    const dispatcher = createPhoneFlowDispatcher({ openUrl: vi.fn() });
    for (const call of [
      () => dispatcher.playbackStop(),
      () => dispatcher.queueAdd(),
      () => dispatcher.queueReplace(),
      () => dispatcher.sourceRetry(),
      () => dispatcher.sourceNext(),
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

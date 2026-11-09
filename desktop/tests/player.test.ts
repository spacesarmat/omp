import { describe, expect, it, vi } from 'vitest';
import { createBridge } from '../src/platform/bridge';
import { createDesktopNative } from '../src/platform/native';
import { createPlayerApi, PlayerStatus } from '../src/platform/player';

const playing: PlayerStatus = { state: 'playing', positionMs: 1000, durationMs: 2000 };

describe('desktop player API', () => {
  it('forwards open, pause, stop and status through typed IPC', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const api = createPlayerApi(createBridge(async (command, args) => {
      calls.push({ command, args });
      return playing;
    }));

    await api.playerOpen({ url: 'http://127.0.0.1:8090/stream/file', title: 'Video', startMs: 12500 });
    await api.playerPause();
    await api.playerStop();
    await api.playerStatus();

    expect(calls).toEqual([
      { command: 'player_open', args: { request: { url: 'http://127.0.0.1:8090/stream/file', title: 'Video', startMs: 12500 } } },
      { command: 'player_pause', args: undefined },
      { command: 'player_stop', args: undefined },
      { command: 'player_status', args: undefined },
    ]);
  });

  it('opens the existing video fallback in mpv instead of a browser', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const browserOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
    const desktop = createDesktopNative(createBridge(async (command, args) => {
      calls.push({ command, args });
      return playing;
    }));
    const url = 'http://127.0.0.1:8090/stream/file';

    await desktop.native.openExternal(url, 'video/*');

    expect(calls).toEqual([{ command: 'player_open', args: { request: { url } } }]);
    expect(browserOpen).not.toHaveBeenCalled();
    browserOpen.mockRestore();
  });

  it('surfaces a sanitized mpv launch error', async () => {
    const browserOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
    const desktop = createDesktopNative(createBridge(async () => ({
      state: 'error',
      positionMs: 0,
      durationMs: 0,
      error: 'player launch failed',
    })));

    await expect(desktop.native.openExternal('http://127.0.0.1:8090/stream/file', 'video/*'))
      .rejects.toThrow('player launch failed');
    expect(browserOpen).not.toHaveBeenCalled();
    browserOpen.mockRestore();
  });
});

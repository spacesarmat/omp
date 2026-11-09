import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBridge, type BridgeTransport } from '../src/platform/bridge';
import { createDesktopNative, rawPlugin } from '../src/platform/native';

function transportWith(calls: Array<{ command: string; args?: Record<string, unknown> }>, handler?: BridgeTransport): BridgeTransport {
  return async (command, args) => {
    calls.push({ command, args });
    if (handler) return handler(command, args);
    return { status: 'ready' };
  };
}

describe('desktop native catalog adapter', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('provides the shared catalog dependencies without Capacitor', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const desktop = createDesktopNative(createBridge(transportWith(calls, async (command) => {
      if (command === 'server_status') return { mode: 'embedded', origin: 'http://127.0.0.1:8090', status: 'ready' };
      return { mode: 'embedded', origin: 'http://127.0.0.1:8090', status: 'ready' };
    })));

    expect(desktop.nativeBilling).toBeNull();
    expect(rawPlugin()).toBeNull();
    expect(typeof desktop.sourceHttp.get).toBe('function');
    expect(typeof desktop.secrets.get).toBe('function');
    await expect(desktop.native.localServerInfo()).resolves.toMatchObject({ supported: true, running: true });
  });

  it('uses loopback for embedded and preserves an external origin', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const desktop = createDesktopNative(createBridge(transportWith(calls, async (command) => {
      if (command === 'server_start') return { mode: 'embedded', origin: 'http://127.0.0.1:8090', status: 'ready' };
      return { mode: 'external', origin: 'https://example.com', status: 'ready' };
    })));

    await desktop.native.startLocalServer();
    await desktop.serverApi.serverStart({ mode: 'external', origin: 'https://example.com/settings?token=secret' });

    expect(calls[0].args).toEqual({ request: { mode: 'embedded', origin: 'http://127.0.0.1:8090' } });
    expect(calls[1].args).toEqual({ request: { mode: 'external', origin: 'https://example.com' } });
  });

  it('returns native HTTP errors without exposing request secrets', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const desktop = createDesktopNative(createBridge(transportWith(calls, async () => ({
      status: 401,
      url: 'https://example.com/private',
      text: 'denied',
    }))));

    const response = await desktop.sourceHttp.get('https://example.com/private', {
      headers: { Authorization: 'Basic secret-value' },
    });

    expect(response.status).toBe(401);
    expect(response.text).toBe('denied');
    expect(calls[0].command).toBe('native_http');

    const failing = createDesktopNative(createBridge(async () => {
      throw new Error('HTTP request failed');
    }));
    const error = await failing.sourceHttp.get('https://example.com/private', {
      headers: { Authorization: 'Basic secret-value' },
    }).catch((reason: unknown) => reason as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('secret-value');
  });

  it('stores source secrets without logging their values', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const desktop = createDesktopNative(createBridge(async () => ({})));

    await desktop.secrets.set('tracker', 'secret-value');
    await expect(desktop.secrets.get('tracker')).resolves.toBe('secret-value');
    await desktop.secrets.delete('tracker');
    await expect(desktop.secrets.get('tracker')).resolves.toBeNull();

    const output = [...log.mock.calls, ...error.mock.calls].flat().join(' ');
    expect(output).not.toContain('secret-value');
  });
});

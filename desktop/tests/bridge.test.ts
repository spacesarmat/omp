import { describe, expect, it } from 'vitest';
import { createBridge } from '../src/platform/bridge';

describe('desktop bridge', () => {
  it('passes a typed command and arguments', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const bridge = createBridge(async (command, args) => {
      calls.push({ command, args });
      return { status: 'ready' };
    });

    await expect(bridge.invoke('serverStatus', { mode: 'embedded' })).resolves.toEqual({ status: 'ready' });
    expect(calls).toEqual([{ command: 'serverStatus', args: { mode: 'embedded' } }]);
  });

  it('explains how to install WebView2 when the desktop runtime is missing', async () => {
    const bridge = createBridge();
    await expect(bridge.invoke('playerOpen', { url: 'https://example.test/video' })).rejects.toThrow('WebView2');
  });
});

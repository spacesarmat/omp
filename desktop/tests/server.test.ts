import { describe, expect, it } from 'vitest';
import { createBridge } from '../src/platform/bridge';
import { createServerApi, ServerHandle } from '../src/platform/server';

const ready: ServerHandle = {
  mode: 'external',
  origin: 'http://127.0.0.1:8090',
  status: 'ready',
};

function apiWithCalls() {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const api = createServerApi(createBridge(async (command, args) => {
    calls.push({ command, args });
    return ready;
  }));
  return { api, calls };
}

describe('desktop server API', () => {
  it('normalizes an external URL to its origin without query or credentials', async () => {
    const { api, calls } = apiWithCalls();

    await api.serverStart({ mode: 'external', origin: 'http://user:pass@127.0.0.1:8090/path?token=secret' });

    expect(calls).toEqual([{
      command: 'server_start',
      args: { request: { mode: 'external', origin: 'http://127.0.0.1:8090' } },
    }]);
  });

  it('rejects non-HTTP external origins before IPC', async () => {
    const { api, calls } = apiWithCalls();

    await expect(api.serverStart({ mode: 'external', origin: 'file:///tmp/server' })).rejects.toThrow('HTTP');
    expect(calls).toEqual([]);
  });

  it('pins embedded mode to loopback even when another origin is supplied', async () => {
    const { api, calls } = apiWithCalls();

    await api.serverStart({ mode: 'embedded', origin: 'https://example.com' });

    expect(calls[0].args).toEqual({ request: { mode: 'embedded', origin: 'http://127.0.0.1:8090' } });
  });

  it('forwards stop, status and update through the typed bridge', async () => {
    const { api, calls } = apiWithCalls();

    await api.serverStop();
    await api.serverStatus();
    await api.serverUpdate();

    expect(calls.map((call) => call.command)).toEqual(['server_stop', 'server_status', 'server_update']);
  });
});

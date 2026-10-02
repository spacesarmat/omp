import { describe, it, expect, vi, afterEach } from 'vitest';
import { native, ONLY_ANDROID } from '../src/platform/native';

describe('native plugin wrapper outside Android', () => {
  it('is not available', () => {
    expect(native.available).toBe(false);
  });

  it('finds no TVs', async () => {
    expect(await native.discoverTvs(500)).toEqual([]);
  });

  it('rejects tvSend with a clear message', async () => {
    await expect(native.tvSend({ type: 'request' })).rejects.toThrow('Доступно только в приложении Android');
  });

  it('rejects openExternal and the other actions', async () => {
    await expect(native.openExternal('http://x/v.mkv', 'video/*')).rejects.toThrow(ONLY_ANDROID);
    await expect(native.tvConnect('192.168.1.5', {})).rejects.toThrow(ONLY_ANDROID);
    await expect(native.pointerSend('type:click\n\n')).rejects.toThrow(ONLY_ANDROID);
    await expect(native.wakeOnLan('aa:bb:cc:dd:ee:ff', '192.168.1.5')).rejects.toThrow(ONLY_ANDROID);
    await expect(native.takePendingMagnet()).rejects.toThrow(ONLY_ANDROID);
    await expect(native.downloadAndInstallApk('https://x/a.apk', 'ab', () => {})).rejects.toThrow(ONLY_ANDROID);
  });

  it('rejects the player server actions', async () => {
    await expect(native.startPlayerServer('192.168.1.5')).rejects.toThrow(ONLY_ANDROID);
    await expect(native.stopPlayerServer()).rejects.toThrow(ONLY_ANDROID);
    await expect(native.queuePlayerCommands([{ id: 1, type: 'play' }])).rejects.toThrow(ONLY_ANDROID);
  });

  it('player message listener is a no-op', () => {
    const off = native.onPlayerMessage(() => {});
    expect(() => off()).not.toThrow();
  });

  it('listeners are no-ops', () => {
    const off = native.onTvMessage(() => {});
    expect(() => off()).not.toThrow();
  });
});

describe('native plugin wrapper on Android', () => {
  afterEach(() => {
    vi.doUnmock('@capacitor/core');
    vi.resetModules();
  });

  async function load() {
    const listeners = new Map<string, (e: any) => void>();
    const removed: string[] = [];
    let releaseAdd: () => void = () => {};
    const gate = new Promise<void>((r) => (releaseAdd = r));
    const fake = {
      tvSend: vi.fn(async () => {}),
      tvConnect: vi.fn(async () => ({ port: 3001 })),
      discoverTvs: vi.fn(async () => ({ tvs: [{ ip: '10.0.0.2', name: 'TV' }] })),
      takePendingMagnet: vi.fn(async () => ({ link: null })),
      startPlayerServer: vi.fn(async () => ({ url: 'http://10.0.0.3:41234/omp/abc' })),
      stopPlayerServer: vi.fn(async () => {}),
      wakeOnLan: vi.fn(async () => {}),
      queuePlayerCommands: vi.fn(async () => {}),
      addListener: vi.fn(async (event: string, cb: (e: any) => void) => {
        await gate;
        listeners.set(event, cb);
        return { remove: async () => void removed.push(event) };
      }),
    };
    vi.resetModules();
    vi.doMock('@capacitor/core', () => ({
      Capacitor: { isNativePlatform: () => true },
      registerPlugin: () => fake,
    }));
    const mod = await import('../src/platform/native');
    return { native: mod.native, fake, listeners, removed, releaseAdd };
  }

  it('sends SSAP messages as JSON strings and maps results', async () => {
    const { native: n, fake } = await load();
    expect(n.available).toBe(true);
    await n.tvSend({ type: 'request', id: '1' });
    expect(fake.tvSend).toHaveBeenCalledWith({ json: '{"type":"request","id":"1"}' });
    expect(await n.discoverTvs(1000)).toEqual([{ ip: '10.0.0.2', name: 'TV' }]);
    expect(await n.takePendingMagnet()).toBeNull();
  });

  it('tvConnect passes preferPort and returns the port that opened', async () => {
    const { native: n, fake } = await load();
    expect(await n.tvConnect('10.0.0.2', { type: 'register' }, 3001)).toEqual({ port: 3001 });
    expect(fake.tvConnect).toHaveBeenCalledWith({ ip: '10.0.0.2', register: '{"type":"register"}', preferPort: 3001 });
    await n.tvConnect('10.0.0.2', {});
    expect(fake.tvConnect).toHaveBeenLastCalledWith({ ip: '10.0.0.2', register: '{}' });
  });

  it('wakeOnLan passes mac and ip', async () => {
    const { native: n, fake } = await load();
    await n.wakeOnLan('aa:bb:cc:dd:ee:ff', '192.168.1.5');
    expect(fake.wakeOnLan).toHaveBeenCalledWith({ mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.5' });
  });

  it('parses incoming TV messages', async () => {
    const { native: n, listeners, releaseAdd } = await load();
    const got: any[] = [];
    n.onTvMessage((m) => got.push(m));
    releaseAdd();
    await vi.waitFor(() => expect(listeners.has('tvMessage')).toBe(true));
    listeners.get('tvMessage')!({ json: '{"type":"registered"}' });
    listeners.get('tvMessage')!({ json: 'not json' });
    expect(got).toEqual([{ type: 'registered' }]);
  });

  it('unsubscribe before addListener settles still removes the listener', async () => {
    const { native: n, removed, releaseAdd } = await load();
    const off = n.onMagnet(() => {});
    off();
    releaseAdd();
    await vi.waitFor(() => expect(removed).toEqual(['magnetReceived']));
  });

  it('player server wrappers pass plain values and JSON strings', async () => {
    const { native: n, fake } = await load();
    expect(await n.startPlayerServer('10.0.0.2')).toBe('http://10.0.0.3:41234/omp/abc');
    expect(fake.startPlayerServer).toHaveBeenCalledWith({ tvIp: '10.0.0.2' });
    await n.queuePlayerCommands([{ id: 1, type: 'seek', t: 30 }]);
    expect(fake.queuePlayerCommands).toHaveBeenCalledWith({ json: '[{"id":1,"type":"seek","t":30}]' });
    await n.stopPlayerServer();
    expect(fake.stopPlayerServer).toHaveBeenCalled();
  });

  it('delivers raw player message bodies', async () => {
    const { native: n, listeners, releaseAdd } = await load();
    const got: string[] = [];
    const off = n.onPlayerMessage((b) => got.push(b));
    releaseAdd();
    await vi.waitFor(() => expect(listeners.has('playerMessage')).toBe(true));
    listeners.get('playerMessage')!({ body: '{"v":1}' });
    listeners.get('playerMessage')!({ body: 'raw' });
    expect(got).toEqual(['{"v":1}', 'raw']);
    off();
  });
});

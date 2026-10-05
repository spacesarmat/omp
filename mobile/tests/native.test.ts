import { describe, it, expect, vi, afterEach } from 'vitest';
import { native, onlyAndroid, sourceHttp, secrets } from '../src/platform/native';

describe('native plugin wrapper outside Android', () => {
  it('is not available', () => {
    expect(native.available).toBe(false);
  });

  it('finds no TVs', async () => {
    expect(await native.discoverTvs(500)).toEqual([]);
    expect(await native.discoverOmpTvs(500)).toEqual([]);
    expect(await native.discoverCastTvs(500)).toEqual([]);
    expect(await native.probePorts('192.168.1.5', [9922], 500)).toEqual([]);
  });

  it('names the phone «Телефон»', async () => {
    expect(await native.phoneName()).toBe('Телефон');
  });

  it('rejects tvSend with a clear message', async () => {
    await expect(native.tvSend({ type: 'request' })).rejects.toThrow('Доступно только в приложении Android');
  });

  it('rejects openExternal and the other actions', async () => {
    await expect(native.openExternal('http://x/v.mkv', 'video/*')).rejects.toThrow(onlyAndroid());
    await expect(native.tvConnect('192.168.1.5', {})).rejects.toThrow(onlyAndroid());
    await expect(native.pointerSend('type:click\n\n')).rejects.toThrow(onlyAndroid());
    await expect(native.wakeOnLan('aa:bb:cc:dd:ee:ff', '192.168.1.5')).rejects.toThrow(onlyAndroid());
    await expect(native.takePendingMagnet()).rejects.toThrow(onlyAndroid());
    await expect(native.downloadAndInstallApk('https://x/a.apk', 'ab', () => {})).rejects.toThrow(onlyAndroid());
  });

  it('rejects the player server actions', async () => {
    await expect(native.startPlayerServer('192.168.1.5')).rejects.toThrow(onlyAndroid());
    await expect(native.stopPlayerServer()).rejects.toThrow(onlyAndroid());
    await expect(native.queuePlayerCommands([{ id: 1, type: 'play' }])).rejects.toThrow(onlyAndroid());
  });

  it('player message listener is a no-op', () => {
    const off = native.onPlayerMessage(() => {});
    expect(() => off()).not.toThrow();
  });

  it('listeners are no-ops', () => {
    const off = native.onTvMessage(() => {});
    expect(() => off()).not.toThrow();
  });

  it('reports the local server as unsupported and has no Wi-Fi IP', async () => {
    expect(await native.localServerInfo()).toEqual({ supported: false, running: false });
    expect(await native.localIpv4()).toBeNull();
    const off = native.onLocalServerState(() => {});
    expect(() => off()).not.toThrow();
  });

  it('rejects the local server actions', async () => {
    await expect(native.startLocalServer()).rejects.toThrow(onlyAndroid());
    await expect(native.stopLocalServer()).rejects.toThrow(onlyAndroid());
    await expect(native.localServerCache()).rejects.toThrow(onlyAndroid());
    await expect(native.clearLocalServerCache()).rejects.toThrow(onlyAndroid());
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
      discoverOmpTvs: vi.fn(async (): Promise<any> => ({
        tvs: [
          { ip: '192.168.1.40', port: 8095, name: 'Гостиная', version: '0.10.0' },
          { ip: '192.168.1.40', port: 8095, name: 'dup', version: '0.10.0' },
          { ip: '192.168.1.41', port: 'x', name: '', version: 5 },
          { ip: 'fe80::1', port: 8095, name: 'v6' },
          'junk',
        ],
      })),
      discoverCastTvs: vi.fn(async (): Promise<any> => ({
        tvs: [
          { ip: '192.168.1.9', name: 'Спальня', model: 'Chromecast HD' },
          { ip: '192.168.1.9', name: 'dup' },
          { ip: '192.168.1.10', name: '', model: 7 },
          { ip: 'bad', name: 'x' },
          null,
        ],
      })),
      probePorts: vi.fn(async (): Promise<any> => ({ open: [9922, 'x', 22] })),
      phoneName: vi.fn(async (): Promise<any> => ({ name: ' Pixel 7 ' })),
      takePendingMagnet: vi.fn(async () => ({ link: null })),
      startPlayerServer: vi.fn(async () => ({ url: 'http://10.0.0.3:41234/omp/abc' })),
      stopPlayerServer: vi.fn(async () => {}),
      wakeOnLan: vi.fn(async () => {}),
      downloadAndInstallApk: vi.fn(async () => {}),
      deviceAbiKey: vi.fn(async (): Promise<any> => ({ key: 'arm64' })),
      queuePlayerCommands: vi.fn(async () => {}),
      localServerInfo: vi.fn(async (): Promise<any> => ({ supported: true, running: false, error: '' })),
      startLocalServer: vi.fn(async (): Promise<any> => ({
        supported: true,
        running: true,
        version: 'MatriX.145.1',
        ip: '192.168.1.50',
        extra: 1,
      })),
      stopLocalServer: vi.fn(async () => {}),
      downloadLocalServer: vi.fn(async (): Promise<any> => ({
        supported: true,
        running: false,
        binary: 'ready',
        downloadBytes: 64174032,
        pinVersion: 'MatriX.145.1',
      })),
      cancelLocalServerDownload: vi.fn(async () => {}),
      localServerCache: vi.fn(async (): Promise<any> => ({ usedBytes: 524288000 })),
      clearLocalServerCache: vi.fn(async () => ({ usedBytes: 0 })),
      localIpv4: vi.fn(async (): Promise<any> => ({ ip: '192.168.1.50' })),
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

  it('discoverOmpTvs passes the timeout and keeps well-formed IPv4 entries', async () => {
    const { native: n, fake } = await load();
    expect(await n.discoverOmpTvs(4000)).toEqual([
      { ip: '192.168.1.40', port: 8095, name: 'Гостиная', version: '0.10.0' },
      { ip: '192.168.1.41', port: 8095, name: 'Android TV', version: '' },
    ]);
    expect(fake.discoverOmpTvs).toHaveBeenCalledWith({ timeoutMs: 4000 });
    await n.discoverOmpTvs(4000, 'g1');
    expect(fake.discoverOmpTvs).toHaveBeenLastCalledWith({ timeoutMs: 4000, group: 'g1' });
    await n.discoverCastTvs(4000, 'g1');
    expect(fake.discoverCastTvs).toHaveBeenLastCalledWith({ timeoutMs: 4000, group: 'g1' });
    fake.discoverOmpTvs.mockResolvedValueOnce({});
    expect(await n.discoverOmpTvs(4000)).toEqual([]);
  });

  it('discoverCastTvs keeps well-formed entries; probePorts only asked ports', async () => {
    const { native: n, fake } = await load();
    expect(await n.discoverCastTvs(4000)).toEqual([
      { ip: '192.168.1.9', name: 'Спальня', model: 'Chromecast HD' },
      { ip: '192.168.1.10', name: 'Android TV' },
    ]);
    expect(fake.discoverCastTvs).toHaveBeenCalledWith({ timeoutMs: 4000 });
    expect(await n.probePorts('192.168.1.5', [9922, 9991], 1500)).toEqual([9922]);
    expect(fake.probePorts).toHaveBeenCalledWith({ ip: '192.168.1.5', ports: [9922, 9991], timeoutMs: 1500 });
  });

  it('phoneName trims the model and falls back to «Телефон»', async () => {
    const { native: n, fake } = await load();
    expect(await n.phoneName()).toBe('Pixel 7');
    fake.phoneName.mockResolvedValueOnce({ name: '' });
    expect(await n.phoneName()).toBe('Телефон');
    fake.phoneName.mockRejectedValueOnce(new Error('x'));
    expect(await n.phoneName()).toBe('Телефон');
  });

  it('tvConnect passes preferPort and returns the port that opened', async () => {
    const { native: n, fake } = await load();
    expect(await n.tvConnect('10.0.0.2', { type: 'register' }, 3001)).toEqual({ port: 3001 });
    expect(fake.tvConnect).toHaveBeenCalledWith({ ip: '10.0.0.2', register: '{"type":"register"}', preferPort: 3001 });
    await n.tvConnect('10.0.0.2', {});
    expect(fake.tvConnect).toHaveBeenLastCalledWith({ ip: '10.0.0.2', register: '{}' });
  });

  it('downloadAndInstallApk passes apks only when the feed has them', async () => {
    const { native: n, fake, releaseAdd } = await load();
    releaseAdd();
    const apks = { arm64: { url: 'https://x/a64.apk', sha256: 'b'.repeat(64), size: 1 } };
    await n.downloadAndInstallApk('https://x/a.apk', 'a'.repeat(64), () => {}, apks);
    expect(fake.downloadAndInstallApk).toHaveBeenLastCalledWith({ url: 'https://x/a.apk', sha256: 'a'.repeat(64), apks });
    await n.downloadAndInstallApk('https://x/a.apk', 'a'.repeat(64), () => {});
    expect(fake.downloadAndInstallApk).toHaveBeenLastCalledWith({ url: 'https://x/a.apk', sha256: 'a'.repeat(64) });
  });

  it('deviceAbiKey keeps only known keys', async () => {
    const { native: n, fake } = await load();
    fake.deviceAbiKey.mockResolvedValueOnce({ key: 'armv7' });
    expect(await n.deviceAbiKey()).toBe('armv7');
    fake.deviceAbiKey.mockResolvedValueOnce({ key: '' });
    expect(await n.deviceAbiKey()).toBeNull();
    fake.deviceAbiKey.mockResolvedValueOnce({ key: 'x86' });
    expect(await n.deviceAbiKey()).toBeNull();
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

  it('local server wrappers map plugin results', async () => {
    const { native: n, fake } = await load();
    expect(await n.localServerInfo()).toEqual({ supported: true, running: false });
    expect(await n.startLocalServer()).toEqual({
      supported: true,
      running: true,
      version: 'MatriX.145.1',
      ip: '192.168.1.50',
    });
    await n.stopLocalServer();
    expect(fake.stopLocalServer).toHaveBeenCalled();
    expect(await n.localServerCache()).toBe(524288000);
    fake.localServerCache.mockResolvedValueOnce({});
    expect(await n.localServerCache()).toBe(0);
    await expect(n.clearLocalServerCache()).resolves.toBeUndefined();
    expect(fake.clearLocalServerCache).toHaveBeenCalled();
    expect(await n.localIpv4()).toBe('192.168.1.50');
    fake.localIpv4.mockResolvedValueOnce({ ip: null });
    expect(await n.localIpv4()).toBeNull();
  });

  it('downloads the local server with progress and maps the binary state', async () => {
    const { native: n, fake, listeners, removed, releaseAdd } = await load();
    fake.localServerInfo.mockResolvedValueOnce({ supported: true, running: false, binary: 'missing', downloadBytes: 64174032, pinVersion: 'MatriX.145.1' });
    expect(await n.localServerInfo()).toEqual({
      supported: true,
      running: false,
      binary: 'missing',
      downloadBytes: 64174032,
      pinVersion: 'MatriX.145.1',
    });
    fake.localServerInfo.mockResolvedValueOnce({ supported: true, running: false, binary: 'missing', downloading: true, downloadPercent: 41.6, mobileData: true });
    expect(await n.localServerInfo()).toEqual({ supported: true, running: false, binary: 'missing', downloading: true, downloadPercent: 42, mobileData: true });
    fake.localServerInfo.mockResolvedValueOnce({ supported: true, running: false, binary: 'weird', downloadBytes: -1, downloading: 'yes', downloadPercent: 300 });
    expect(await n.localServerInfo()).toEqual({ supported: true, running: false });
    const got: any[] = [];
    fake.downloadLocalServer.mockImplementationOnce(async () => {
      listeners.get('localServerDownload')!({ phase: 'download', percent: 42.4 });
      listeners.get('localServerDownload')!({ phase: 'download', percent: 140 });
      listeners.get('localServerDownload')!({ phase: 'download' });
      listeners.get('localServerDownload')!({ phase: 'verify' });
      return { supported: true, running: false, binary: 'ready' };
    });
    const p = n.downloadLocalServer((e) => got.push(e));
    releaseAdd();
    expect(await p).toEqual({ supported: true, running: false, binary: 'ready' });
    expect(got).toEqual([{ phase: 'download', percent: 42 }, { phase: 'download', percent: 100 }, { phase: 'verify' }]);
    expect(removed).toContain('localServerDownload');
    await n.cancelLocalServerDownload();
    expect(fake.cancelLocalServerDownload).toHaveBeenCalled();
  });

  it('passes plugin rejections of the local server through', async () => {
    const { native: n, fake } = await load();
    fake.startLocalServer.mockRejectedValueOnce(new Error('TorrServer не ответил за 15 секунд'));
    await expect(n.startLocalServer()).rejects.toThrow('TorrServer не ответил за 15 секунд');
  });

  it('delivers local server state events', async () => {
    const { native: n, listeners, releaseAdd } = await load();
    const got: any[] = [];
    const off = n.onLocalServerState((st) => got.push(st));
    releaseAdd();
    await vi.waitFor(() => expect(listeners.has('localServerState')).toBe(true));
    listeners.get('localServerState')!({ running: true });
    listeners.get('localServerState')!({ running: false, error: 'Сервер остановился с ошибкой' });
    expect(got).toEqual([{ running: true }, { running: false, error: 'Сервер остановился с ошибкой' }]);
    off();
  });
});

describe('sources http and secrets outside Android', () => {
  it('reject with a clear message', async () => {
    await expect(native.http({ url: 'https://rutor.info/', method: 'GET' })).rejects.toThrow(onlyAndroid());
    await expect(sourceHttp.get('https://rutor.info/')).rejects.toThrow(onlyAndroid());
    await expect(sourceHttp.clearCookies('https://rutor.info/')).rejects.toThrow(onlyAndroid());
    await expect(secrets.get('k')).rejects.toThrow(onlyAndroid());
    await expect(secrets.set('k', 'v')).rejects.toThrow(onlyAndroid());
    await expect(secrets.delete('k')).rejects.toThrow(onlyAndroid());
  });
});

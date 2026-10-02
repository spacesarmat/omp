import { describe, it, expect, vi, afterEach } from 'vitest';
import { nativePlugin, nativeLocalIp, installApk, describeApkError } from '../../src/platform/androidNative';

const w = window as unknown as { Capacitor?: unknown };
afterEach(() => { delete w.Capacitor; });

/** Capacitor's injected native-bridge.js without @capacitor/core: nativePromise + addListener only. */
function bridgeOnly(impl: { [method: string]: (o: any) => Promise<any> }) {
  const listeners: { [event: string]: ((d: any) => void)[] } = {};
  const removed: string[] = [];
  const nativePromise = vi.fn((plugin: string, method: string, o: any) => {
    if (plugin !== 'OmpNative' || !impl[method]) return Promise.reject({ message: 'not implemented' });
    return impl[method](o);
  });
  w.Capacitor = {
    getPlatform: () => 'android',
    Plugins: {},
    nativePromise,
    addListener: (plugin: string, event: string, cb: (d: any) => void) => {
      (listeners[event] = listeners[event] || []).push(cb);
      return { remove: () => { removed.push(plugin + ':' + event); listeners[event] = listeners[event].filter((x) => x !== cb); } };
    },
  };
  return { nativePromise, emit: (event: string, d: any) => (listeners[event] || []).forEach((cb) => cb(d)), removed, listeners };
}

describe('nativePlugin', () => {
  it('is null outside the Android APK', async () => {
    expect(nativePlugin()).toBeNull();
    expect(await nativeLocalIp()).toBeNull();
    w.Capacitor = { getPlatform: () => 'android' };
    expect(nativePlugin()).toBeNull();
  });
  it('prefers a registered Plugins.OmpNative', async () => {
    const plugin = { localIpv4: vi.fn(() => Promise.resolve({ ip: '10.0.0.7' })), downloadAndInstallApk: vi.fn(), addListener: vi.fn() };
    w.Capacitor = { getPlatform: () => 'android', Plugins: { OmpNative: plugin }, nativePromise: vi.fn() };
    expect(nativePlugin()).toBe(plugin);
    expect(await nativeLocalIp()).toBe('10.0.0.7');
  });
  it('falls back to the bare native bridge', async () => {
    const b = bridgeOnly({ localIpv4: () => Promise.resolve({ ip: '192.168.5.20' }) });
    expect(await nativeLocalIp()).toBe('192.168.5.20');
    expect(b.nativePromise).toHaveBeenCalledWith('OmpNative', 'localIpv4', {});
  });
  it('bridges the phone remote methods', async () => {
    const b = bridgeOnly({
      pairingCode: () => Promise.resolve({ code: '1234', expiresAt: 5 }),
      tvName: () => Promise.resolve({ name: 'Гостиная' }),
      clearPairingCode: () => Promise.resolve(),
    });
    const p = nativePlugin()!;
    expect(await p.pairingCode()).toEqual({ code: '1234', expiresAt: 5 });
    expect(await p.tvName()).toEqual({ name: 'Гостиная' });
    expect(b.nativePromise).toHaveBeenCalledWith('OmpNative', 'pairingCode', {});
    expect(b.nativePromise).toHaveBeenCalledWith('OmpNative', 'tvName', {});
    await p.clearPairingCode();
    expect(b.nativePromise).toHaveBeenCalledWith('OmpNative', 'clearPairingCode', {});
  });
  it('localIpv4: null ip or a failure → null', async () => {
    bridgeOnly({ localIpv4: () => Promise.resolve({ ip: null }) });
    expect(await nativeLocalIp()).toBeNull();
    bridgeOnly({ localIpv4: () => Promise.reject({ message: 'x' }) });
    expect(await nativeLocalIp()).toBeNull();
  });
  it('uses registerPlugin when only @capacitor/core is present', () => {
    const proxy = { localIpv4: vi.fn() };
    const registerPlugin = vi.fn(() => proxy);
    w.Capacitor = { getPlatform: () => 'android', registerPlugin };
    expect(nativePlugin()).toBe(proxy);
    expect(registerPlugin).toHaveBeenCalledWith('OmpNative');
  });
});

describe('installApk', () => {
  it('reports clamped progress, passes url/sha256 and removes the listener', async () => {
    let finish: () => void = () => undefined;
    const b = bridgeOnly({
      downloadAndInstallApk: () => new Promise<void>((r) => { finish = r; }),
    });
    const seen: number[] = [];
    const p = installApk('https://x/omp.apk', 'a'.repeat(64), (v) => seen.push(v));
    await Promise.resolve();
    await Promise.resolve();
    expect(b.nativePromise).toHaveBeenCalledWith('OmpNative', 'downloadAndInstallApk', { url: 'https://x/omp.apk', sha256: 'a'.repeat(64) });
    b.emit('apkProgress', { percent: 41.6 });
    b.emit('apkProgress', { percent: 140 });
    b.emit('apkProgress', { percent: 'x' });
    finish();
    await p;
    expect(seen).toEqual([42, 100]);
    expect(b.removed).toEqual(['OmpNative:apkProgress']);
  });
  it('rejects with the native Russian message and removes the listener', async () => {
    const b = bridgeOnly({ downloadAndInstallApk: () => Promise.reject({ message: 'Обновление уже скачивается' }) });
    await expect(installApk('https://x/a.apk', 'b'.repeat(64), () => undefined)).rejects.toThrow('Обновление уже скачивается');
    expect(b.removed).toHaveLength(1);
  });
  it('rejects in Russian without the plugin', async () => {
    await expect(installApk('https://x/a.apk', 'b'.repeat(64), () => undefined)).rejects.toThrow('Установка обновлений недоступна на этом устройстве');
  });
  it('describeApkError wraps non-Russian messages', () => {
    expect(describeApkError({ message: 'boom' })).toBe('Не удалось установить обновление: boom');
    expect(describeApkError(undefined)).toBe('Не удалось установить обновление');
    expect(describeApkError('Нет места')).toBe('Нет места');
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { nativePlugin, nativeLocalIp, installApk, describeApkError, nativeSourceHttp, nativeSecrets, nativeSetLanguage, syncNativeLanguage } from '../../src/platform/androidNative';
import { applyLanguageSetting } from '../../src/i18n';

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
  it('passes the per-ABI APKs to the plugin when the feed has them', async () => {
    const b = bridgeOnly({ downloadAndInstallApk: () => Promise.resolve() });
    const apks = { arm64: { url: 'https://x/omp-arm64.apk', sha256: 'c'.repeat(64), size: 5 } };
    await installApk('https://x/omp.apk', 'a'.repeat(64), () => undefined, apks);
    expect(b.nativePromise).toHaveBeenCalledWith('OmpNative', 'downloadAndInstallApk', { url: 'https://x/omp.apk', sha256: 'a'.repeat(64), apks });
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

describe('sources: http and secrets on Android TV', () => {
  it('are null outside the APK', () => {
    expect(nativeSourceHttp()).toBeNull();
    expect(nativeSecrets()).toBeNull();
  });
  it('http goes through OmpNative.http and clearCookies through httpClearCookies', async () => {
    const b = bridgeOnly({
      http: () => Promise.resolve({ status: 200, url: 'https://rutor.info/x', text: 'ок' }),
      httpClearCookies: () => Promise.resolve(),
    });
    const http = nativeSourceHttp()!;
    expect(await http.get('https://rutor.info/search')).toEqual({ status: 200, url: 'https://rutor.info/x', text: 'ок' });
    expect(b.nativePromise).toHaveBeenCalledWith('OmpNative', 'http', { url: 'https://rutor.info/search', method: 'GET' });
    await http.post('https://rutor.info/login', { a: '1' });
    expect(b.nativePromise).toHaveBeenCalledWith('OmpNative', 'http', { url: 'https://rutor.info/login', method: 'POST', form: { a: '1' } });
    await http.clearCookies('https://rutor.info/');
    expect(b.nativePromise).toHaveBeenCalledWith('OmpNative', 'httpClearCookies', { url: 'https://rutor.info/' });
  });
  it('secrets go through secretGet / secretSet / secretDelete', async () => {
    const b = bridgeOnly({
      secretGet: () => Promise.resolve({ value: 's' }),
      secretSet: () => Promise.resolve(),
      secretDelete: () => Promise.resolve(),
    });
    const s = nativeSecrets()!;
    expect(await s.get('k')).toBe('s');
    await s.set('k', 'v');
    await s.delete('k');
    expect(b.nativePromise).toHaveBeenCalledWith('OmpNative', 'secretGet', { key: 'k' });
    expect(b.nativePromise).toHaveBeenCalledWith('OmpNative', 'secretSet', { key: 'k', value: 'v' });
    expect(b.nativePromise).toHaveBeenCalledWith('OmpNative', 'secretDelete', { key: 'k' });
  });
});

describe('nativeSetLanguage', () => {
  it('is a no-op outside the APK (webOS) and never throws', async () => {
    await expect(nativeSetLanguage('en')).resolves.toBeUndefined();
  });
  it('sends { lang } to the plugin; a failing or older plugin is ignored', async () => {
    const seen: any[] = [];
    bridgeOnly({ localIpv4: () => Promise.resolve({ ip: null }), setLanguage: (o) => { seen.push(o); return Promise.resolve(); } });
    await nativeSetLanguage('en');
    expect(seen).toEqual([{ lang: 'en' }]);
    bridgeOnly({ localIpv4: () => Promise.resolve({ ip: null }) });
    await expect(nativeSetLanguage('ru')).resolves.toBeUndefined();
  });
});

describe('syncNativeLanguage', () => {
  it('sends the resolved language on start and on every change', () => {
    const sent: string[] = [];
    const stop = syncNativeLanguage((l) => { sent.push(l); return Promise.resolve(); });
    expect(sent).toEqual(['ru']);
    applyLanguageSetting('en');
    expect(sent).toEqual(['ru', 'en']);
    stop();
    applyLanguageSetting('ru');
    expect(sent).toEqual(['ru', 'en']);
  });
});

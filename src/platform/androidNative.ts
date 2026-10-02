// Android TV: access to the native plugin OmpNative (android/.../OmpNativePlugin.kt) WITHOUT @capacitor/core,
// so the webOS bundle does not grow. Capacitor's injected native-bridge.js sets window.Capacitor with
// nativePromise / addListener; when @capacitor/core is also present, Plugins.OmpNative is the registered proxy.

import { createSecretStore, createSourceHttp } from '../sources/http';
import type { NativeHttpRequest } from '../sources/http';
import type { SecretStore, SourceHttp } from '../sources/types';

export interface ListenerHandle {
  remove: () => unknown;
}

export interface OmpNativeTvPlugin {
  localIpv4(): Promise<{ ip?: string | null }>;
  downloadAndInstallApk(o: { url: string; sha256: string }): Promise<unknown>;
  /** Starts the native Media3 player (PlayerActivity); resolves once it is launched. */
  playNative(o: object): Promise<unknown>;
  /** A phone command (src/phone/protocol.ts Cmd) for the open native player. */
  nativePlayerCommand(o: { cmd: object }): Promise<unknown>;
  /** Phone remote: a new 4-digit pairing code (the previous one stops working), expiresAt in epoch ms. */
  pairingCode(): Promise<{ code: string; expiresAt: number }>;
  /** Phone remote: the pairing screen closed, the code shown there stops working. */
  clearPairingCode(): Promise<unknown>;
  /** Phone remote: the TV name the phone sees (the registered NSD name). */
  tvName(): Promise<{ name: string }>;
  /** Search sources: HTTP without CORS, cookies per site, body decoded by charset. */
  http(o: NativeHttpRequest): Promise<{ status: number; url: string; text: string }>;
  /** Forgets the cookies of the site of url. */
  httpClearCookies(o: { url: string }): Promise<unknown>;
  /** Keystore-encrypted storage (tracker logins). */
  secretGet(o: { key: string }): Promise<{ value?: string | null }>;
  secretSet(o: { key: string; value: string }): Promise<unknown>;
  secretDelete(o: { key: string }): Promise<unknown>;
  addListener(event: string, cb: (data: any) => void): Promise<ListenerHandle>;
}

interface CapacitorBridge {
  Plugins?: { [name: string]: any };
  registerPlugin?: (name: string) => any;
  nativePromise?: (plugin: string, method: string, options?: object) => Promise<any>;
  addListener?: (plugin: string, event: string, cb: (data: any) => void) => ListenerHandle | Promise<ListenerHandle>;
}

const NAME = 'OmpNative';

function capacitor(): CapacitorBridge | null {
  try {
    const cap = (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor;
    return cap && typeof cap === 'object' ? cap : null;
  } catch (e) {
    return null;
  }
}

function fromBridge(cap: CapacitorBridge): OmpNativeTvPlugin | null {
  const np = cap.nativePromise;
  const al = cap.addListener;
  if (typeof np !== 'function' || typeof al !== 'function') return null;
  return {
    localIpv4: () => np.call(cap, NAME, 'localIpv4', {}),
    downloadAndInstallApk: (o) => np.call(cap, NAME, 'downloadAndInstallApk', o),
    playNative: (o) => np.call(cap, NAME, 'playNative', o),
    nativePlayerCommand: (o) => np.call(cap, NAME, 'nativePlayerCommand', o),
    pairingCode: () => np.call(cap, NAME, 'pairingCode', {}),
    tvName: () => np.call(cap, NAME, 'tvName', {}),
    clearPairingCode: () => np.call(cap, NAME, 'clearPairingCode', {}),
    http: (o) => np.call(cap, NAME, 'http', o),
    httpClearCookies: (o) => np.call(cap, NAME, 'httpClearCookies', o),
    secretGet: (o) => np.call(cap, NAME, 'secretGet', o),
    secretSet: (o) => np.call(cap, NAME, 'secretSet', o),
    secretDelete: (o) => np.call(cap, NAME, 'secretDelete', o),
    addListener: (event, cb) => Promise.resolve(al.call(cap, NAME, event, cb)),
  };
}

/** The native plugin, or null outside the Android APK (webOS, tests, browser). */
export function nativePlugin(): OmpNativeTvPlugin | null {
  const cap = capacitor();
  if (!cap) return null;
  try {
    const p = cap.Plugins && cap.Plugins[NAME];
    if (p && typeof p.localIpv4 === 'function') return p as OmpNativeTvPlugin;
    const bridged = fromBridge(cap);
    if (bridged) return bridged;
    if (typeof cap.registerPlugin === 'function') {
      const r = cap.registerPlugin(NAME);
      if (r) return r as OmpNativeTvPlugin;
    }
  } catch (e) {
    /* unavailable */
  }
  return null;
}

/** Wi-Fi/Ethernet IPv4 of the device; null when unknown or the plugin is missing. */
export function nativeLocalIp(): Promise<string | null> {
  const p = nativePlugin();
  if (!p) return Promise.resolve(null);
  return p.localIpv4().then(
    (r) => (r && typeof r.ip === 'string' && r.ip ? r.ip : null),
    () => null,
  );
}

/** HTTP for the built-in search sources on Android TV; null outside the APK. */
export function nativeSourceHttp(): SourceHttp | null {
  const p = nativePlugin();
  if (!p) return null;
  return createSourceHttp(
    (req) => p.http(req),
    (url) => p.httpClearCookies({ url }),
  );
}

/** Keystore-encrypted storage on Android TV; null outside the APK. */
export function nativeSecrets(): SecretStore | null {
  const p = nativePlugin();
  if (!p) return null;
  return createSecretStore({
    get: (key) => p.secretGet({ key }),
    set: (key, value) => p.secretSet({ key, value }),
    delete: (key) => p.secretDelete({ key }),
  });
}

function errorText(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') return (e as { message: string }).message;
  return '';
}

/** Russian message for an APK install failure (the native side already rejects in Russian). */
export function describeApkError(e: unknown): string {
  const msg = errorText(e);
  if (/[А-Яа-яЁё]/.test(msg)) return msg;
  return 'Не удалось установить обновление' + (msg ? ': ' + msg : '');
}

/**
 * Downloads the APK, verifies sha256 and opens the system installer. onProgress gets 0..100.
 * Rejects with an Error whose message is in Russian.
 */
export function installApk(url: string, sha256: string, onProgress: (percent: number) => void): Promise<void> {
  const p = nativePlugin();
  if (!p) return Promise.reject(new Error('Установка обновлений недоступна на этом устройстве'));
  let handle: ListenerHandle | null = null;
  const release = () => {
    if (handle) {
      try { handle.remove(); } catch (e) { /* ignore */ }
      handle = null;
    }
  };
  // the listener is registered before the call so that no early progress event is missed
  return p
    .addListener('apkProgress', (d: { percent?: unknown }) => {
      const v = d && typeof d.percent === 'number' && isFinite(d.percent) ? d.percent : null;
      if (v !== null) onProgress(Math.max(0, Math.min(100, Math.round(v))));
    })
    .then((h) => {
      handle = h;
      return p.downloadAndInstallApk({ url, sha256 });
    })
    .then(
      () => { release(); },
      (e) => {
        release();
        throw new Error(describeApkError(e));
      },
    );
}

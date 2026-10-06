// Android TV: access to the native plugin OmpNative (android/.../OmpNativePlugin.kt) WITHOUT @capacitor/core,
// so the webOS bundle does not grow. Capacitor's injected native-bridge.js sets window.Capacitor with
// nativePromise / addListener; when @capacitor/core is also present, Plugins.OmpNative is the registered proxy.

import { createSecretStore, createSourceHttp } from '../sources/http';
import type { NativeHttpRequest } from '../sources/http';
import type { SecretStore, SourceHttp } from '../sources/types';
import type { UpdateInfo } from '../lib/updateInfo';
import type { CloudflareVisibleRequest } from '../sources/cloudflareCheck';
import type { BrowserCheck, BrowserLoginRequest } from '../sources/browserLogin';
import { effect } from '@preact/signals';
import { lang, t, type Lang } from '../i18n';

type ApkFiles = NonNullable<UpdateInfo['apks']>;

export interface ListenerHandle {
  remove: () => unknown;
}

export interface OmpNativeTvPlugin {
  localIpv4(): Promise<{ ip?: string | null }>;
  /** apks: the feed's per-ABI APKs; the plugin picks the device's one, url/sha256 (universal) otherwise. */
  downloadAndInstallApk(o: { url: string; sha256: string; apks?: ApkFiles }): Promise<unknown>;
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
  /** «Передать на телевизор»: the page applied remoteSources { id } (rutracker = the login result when one came) or failed. */
  /**
   * stored = false: the verified rutracker login could not be written (the TV has no new login); sitesNotStored: the
   * other sites (logins = their results) in that state.
   */
  remoteSourcesDone(o: {
    id: string;
    rutracker?: string;
    failed?: boolean;
    indexers?: number;
    logins?: { [site: string]: string };
    /** Browser sessions: ok (verified, promoted natively) | error. */
    sessions?: { [site: string]: string };
  }): Promise<{ stored?: boolean; sitesNotStored?: string[] } | undefined>;
  /** The transfer still waiting for the page (events are not retained): { event } or { event: null }. */
  remoteSourcesPending(): Promise<{ event?: unknown }>;
  /** Whether libVLC runs on this device (the «VLC» player choice). */
  vlcAvailable(): Promise<{ available?: boolean }>;
  /** Hosts of the device's /24 open on allowed ports (FlareSolverr 8191 on the TV); lan false off a home network. */
  scanLan(o: { ports: number[]; timeoutMs?: number }): Promise<{ hits?: unknown; lan?: unknown }>;
  /**
   * The visible Cloudflare check (a native dialog with the site under the remote, «Пройти на телефоне»): every text comes
   * from src/sources/cloudflareCheck.ts. Cookies never come back: { result: solved | cancelled | busy | failed, via? }.
   */
  cloudflareVisible(o: CloudflareVisibleRequest): Promise<{ result?: string; via?: string; sent?: boolean }>;
  /** When the stored Cloudflare clearance of the site of url ends (epoch ms), null without one. */
  cloudflareClearance(o: { url: string }): Promise<{ until?: number | null }>;
  /**
   * «Войти через браузер» (a native dialog with the site's login page under the remote, «Войти на телефоне»): every text
   * comes from src/sources/browserLogin.ts. Cookies never come back: { result: ok | cancelled | busy | failed, host?, via? }.
   */
  siteBrowserLogin(o: BrowserLoginRequest): Promise<{ result?: string; host?: string; via?: string }>;
  /** The browser session the phone sent for the site (staged) opens its check page signed in: { ok, host? }. */
  siteSessionPending(o: { site: string; check: BrowserCheck }): Promise<{ ok?: boolean; host?: string }>;
  /** The page's resolved UI language for the native copy (SharedPreferences `omp.lang`); missing in an older APK. */
  setLanguage?(o: { lang: string }): Promise<unknown>;
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
    remoteSourcesDone: (o) => np.call(cap, NAME, 'remoteSourcesDone', o),
    remoteSourcesPending: () => np.call(cap, NAME, 'remoteSourcesPending', {}),
    vlcAvailable: () => np.call(cap, NAME, 'vlcAvailable', {}),
    scanLan: (o) => np.call(cap, NAME, 'scanLan', o),
    cloudflareVisible: (o) => np.call(cap, NAME, 'cloudflareVisible', o),
    cloudflareClearance: (o) => np.call(cap, NAME, 'cloudflareClearance', o),
    siteBrowserLogin: (o) => np.call(cap, NAME, 'siteBrowserLogin', o),
    siteSessionPending: (o) => np.call(cap, NAME, 'siteSessionPending', o),
    setLanguage: (o) => np.call(cap, NAME, 'setLanguage', o),
    addListener: (event, cb) => Promise.resolve(al.call(cap, NAME, event, cb)),
  };
}

/** The native plugin, or null outside the Android APK (webOS, tests, browser). */
export function nativePlugin(): OmpNativeTvPlugin | null {
  const cap = capacitor();
  if (!cap) return null;
  try {
    const p = cap.Plugins && cap.Plugins[NAME];
    if (p && typeof p.localIpv4 === 'function') {
      // an old system WebView (Dune HD, WebView 66) gets a listener handle back, not a promise
      const w = Object.create(p) as OmpNativeTvPlugin;
      w.addListener = (event, cb) => Promise.resolve(p.addListener(event, cb));
      return w;
    }
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

/**
 * Native LAN scan on Android TV: open ports of the device's /24 (only the ports the native side allows). null off a
 * home network, outside the APK or when the scan fails.
 */
export function nativeScanLan(ports: number[]): Promise<{ ip: string; port: number }[] | null> {
  const p = nativePlugin();
  if (!p || typeof p.scanLan !== 'function') return Promise.resolve(null);
  return p.scanLan({ ports }).then(
    (r) => {
      if (!r || r.lan === false || !Array.isArray(r.hits)) return null;
      const out: { ip: string; port: number }[] = [];
      (r.hits as unknown[]).forEach((h) => {
        const o = h && typeof h === 'object' ? (h as { ip?: unknown; port?: unknown }) : {};
        if (typeof o.ip === 'string' && typeof o.port === 'number' && ports.indexOf(o.port) >= 0) out.push({ ip: o.ip, port: o.port });
      });
      return out;
    },
    () => null,
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

/** Message for an APK install failure: OMP's own native messages (code 'omp', or Cyrillic from an older native) pass as they are. */
export function describeApkError(e: unknown): string {
  const msg = errorText(e);
  if (e && typeof e === 'object' && (e as { code?: unknown }).code === 'omp' && msg) return msg;
  if (/[А-Яа-яЁё]/.test(msg)) return msg;
  return t('update.installFailed') + (msg ? ': ' + msg : '');
}

/**
 * Downloads the APK, verifies sha256 and opens the system installer. onProgress gets 0..100. With apks (the feed's
 * per-ABI APKs) the plugin installs the one for the device's ABI; url/sha256 is the universal fallback.
 * Rejects with an Error whose message is in Russian.
 */
export function installApk(url: string, sha256: string, onProgress: (percent: number) => void, apks?: ApkFiles): Promise<void> {
  const p = nativePlugin();
  if (!p) return Promise.reject(new Error(t('update.installUnavailable')));
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
      return p.downloadAndInstallApk(apks ? { url, sha256, apks } : { url, sha256 });
    })
    .then(
      () => { release(); },
      (e) => {
        release();
        throw new Error(describeApkError(e));
      },
    );
}

/** When the stored Cloudflare clearance of the site at url ends; null without one, outside the APK or on a failure. */
export function nativeClearance(url: string): Promise<number | null> {
  const p = nativePlugin();
  if (!p || typeof p.cloudflareClearance !== 'function') return Promise.resolve(null);
  return p.cloudflareClearance({ url }).then(
    (r) => (r && typeof r.until === 'number' && isFinite(r.until) ? r.until : null),
    () => null,
  );
}

/** Android TV: the resolved UI language to the native side; a no-op on webOS (no plugin), never rejects. */
export function nativeSetLanguage(l: Lang): Promise<void> {
  const p = nativePlugin();
  if (!p || typeof p.setLanguage !== 'function') return Promise.resolve();
  try {
    return p.setLanguage({ lang: l }).then(() => undefined, () => undefined);
  } catch (e) {
    return Promise.resolve();
  }
}

/** Sends the resolved UI language to the native side now and on every change; returns the stopper. */
export function syncNativeLanguage(set: (l: Lang) => Promise<void> = nativeSetLanguage): () => void {
  return effect(() => {
    void set(lang.value);
  });
}

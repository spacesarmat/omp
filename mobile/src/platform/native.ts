// Wrapper over the native Android plugin OmpNative (android/.../OmpNativePlugin.kt).
// The plugin is transport only: SSDP, TV sockets, intents, APK install, player server, embedded TorrServer.
// SSAP lives in src/tv.
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { createSecretStore, createSourceHttp, type NativeHttpRequest } from '../../../src/sources/http';
import { log } from '../../../src/lib/log';
import type { HttpResponse, SecretStore, SourceHttp } from '../../../src/sources/types';
import type { ApkAbi, UpdateInfo } from '../../../src/lib/updateInfo';
import type { CloudflareVisibleRequest } from '../../../src/sources/cloudflareCheck';
import type { BrowserLoginRequest } from '../../../src/sources/browserLogin';

type ApkFiles = NonNullable<UpdateInfo['apks']>;

export interface FoundTv {
  ip: string;
  name: string;
  model?: string;
}

/** Android TV with OMP found by NSD (`_omp._tcp`): control server address, NSD name, OMP version (TXT `v`). */
export interface FoundOmpTv {
  ip: string;
  port: number;
  name: string;
  version: string;
}

/** Google Cast device found by NSD (`_googlecast._tcp`): Android TV / Google TV boxes, also speakers and Chromecasts. */
export interface FoundCastTv {
  ip: string;
  name: string;
  /** TXT `md`, e.g. «Chromecast HD». */
  model?: string;
}

/** The embedded TorrServer binary on the phone: the pinned one, an older one (still runs) or none. */
export type LocalBinaryState = 'ready' | 'outdated' | 'missing';

/** The embedded TorrServer (arm64 only), port 8090. Not in the APK: downloaded on demand. */
export interface LocalServerInfo {
  supported: boolean;
  running: boolean;
  /** Absent off-device and on unsupported phones. */
  binary?: LocalBinaryState;
  /** Size of the pinned download in bytes. */
  downloadBytes?: number;
  /** The pinned TorrServer release. */
  pinVersion?: string;
  /** A download is running (started by an earlier screen or page load). */
  downloading?: boolean;
  /** Its last percent. */
  downloadPercent?: number;
  /** The phone is on mobile data (not Wi-Fi): ask before the download. */
  mobileData?: boolean;
  version?: string;
  /** Wi-Fi IPv4 of the phone. */
  ip?: string;
  /** A VPN is active: other devices may not reach the phone. */
  vpn?: boolean;
  error?: string;
}

export interface LocalServerState {
  running: boolean;
  error?: string;
}

/** Download progress: `percent` while downloading, then the checksum check. */
export interface LocalDownloadProgress {
  phase: 'download' | 'verify';
  percent?: number;
}

export interface OmpNativeApi {
  available: boolean;
  discoverTvs(timeoutMs: number): Promise<FoundTv[]>;
  /** NSD search for Android TVs with OMP; stops after `timeoutMs`. */
  discoverOmpTvs(timeoutMs: number, group?: string): Promise<FoundOmpTv[]>;
  /** Install assistant: NSD search for Google Cast devices; stops after `timeoutMs`. */
  discoverCastTvs(timeoutMs: number, group?: string): Promise<FoundCastTv[]>;
  /** Stops running NSD searches early (the screen that started them has gone). */
  stopDiscovery(group?: string): Promise<void>;
  /** Install assistant: which install ports (9922, 9991, 5555, 8095) accept TCP on a home-network IP. */
  probePorts(ip: string, ports: number[], timeoutMs: number): Promise<number[]>;
  /** Hosts of the phone's /24 that accept a connection on the Jackett / Prowlarr ports; null without Wi-Fi (rejects off-device). */
  scanLan(ports: number[], timeoutMs?: number): Promise<{ ip: string; port: number }[] | null>;
  /** Phone model for the TV's list of paired phones; «Телефон» when unknown. */
  phoneName(): Promise<string>;
  /**
   * Opens the socket and sends `register`; resolves once open with the port that worked.
   * Both ports (ws:3000, wss:3001) are raced; `preferPort` is tried alone first (2 s).
   */
  tvConnect(ip: string, register: object, preferPort?: 3000 | 3001): Promise<{ port: 3000 | 3001 }>;
  /** Any SSAP message (JSON). */
  tvSend(message: object): Promise<void>;
  /** Every incoming message of the main socket. */
  onTvMessage(cb: (msg: any) => void): () => void;
  onTvClosed(cb: (reason: string) => void): () => void;
  /** ws/wss address from getPointerInputSocket; must point to the connected TV. */
  pointerConnect(socketPath: string): Promise<void>;
  /** 'type:button\nname:UP\n\n' etc. */
  pointerSend(frame: string): Promise<void>;
  tvDisconnect(): Promise<void>;
  /** Wake-on-LAN magic packet (broadcast + the /24 broadcast of `ip`), repeated 3 times. */
  wakeOnLan(mac: string, ip: string): Promise<void>;
  openExternal(url: string, mime: string): Promise<void>;
  /** apks: the feed's per-ABI APKs, the plugin installs the device's one (url/sha256 = universal fallback). */
  downloadAndInstallApk(url: string, sha256: string, onProgress: (percent: number) => void, apks?: ApkFiles): Promise<void>;
  /** Feed key of this device's APK (Build.SUPPORTED_ABIS[0]: arm64 / armv7); null = universal. */
  deviceAbiKey(): Promise<ApkAbi | null>;
  takePendingMagnet(): Promise<string | null>;
  onMagnet(cb: (link: string) => void): () => void;
  /** Starts the server (idempotent) on the interface that reaches tvIp; resolves the report URL. */
  startPlayerServer(tvIp: string): Promise<string>;
  stopPlayerServer(): Promise<void>;
  /** Commands the TV gets in its next response (in order, delivered once). */
  queuePlayerCommands(cmds: object[]): Promise<void>;
  /** Raw body of every TV message. */
  onPlayerMessage(cb: (body: string) => void): () => void;
  /** Off-device: not supported, not running. */
  localServerInfo(): Promise<LocalServerInfo>;
  /** Starts the foreground service; resolves once the server answers (rejects after 15 s). */
  startLocalServer(): Promise<LocalServerInfo>;
  stopLocalServer(): Promise<void>;
  /**
   * Downloads the pinned TorrServer binary from its GitHub release (sha256 and size checked; a broken download
   * resumes). A call while a download runs joins it. Rejects with Russian text that says what to do next; `code`
   * 'cancelled' after cancelLocalServerDownload.
   */
  downloadLocalServer(onProgress: (p: LocalDownloadProgress) => void): Promise<LocalServerInfo>;
  cancelLocalServerDownload(): Promise<void>;
  /** Bytes used by the server's disk cache. */
  localServerCache(): Promise<number>;
  /** Stops the server if running, empties the cache, starts it again. */
  clearLocalServerCache(): Promise<void>;
  /** Wi-Fi IPv4 of the phone; null without Wi-Fi or off-device. */
  localIpv4(): Promise<string | null>;
  onLocalServerState(cb: (state: LocalServerState) => void): () => void;
  /** Search sources: HTTP without CORS, browser User-Agent, cookies per site, body decoded by charset. */
  http(req: NativeHttpRequest): Promise<HttpResponse>;
  /** Forgets the cookies of the site of `url`. */
  httpClearCookies(url: string): Promise<void>;
  /** Keystore-encrypted storage for tracker logins; null when the key is not set. */
  secretGet(key: string): Promise<string | null>;
  secretSet(key: string, value: string): Promise<void>;
  secretDelete(key: string): Promise<void>;
  /** Writes `text` to a file `name` and opens the system «Поделиться». */
  shareText(o: { name: string; text: string; title?: string }): Promise<void>;
  /** The visible Cloudflare check (native sheet); cookies never come back. */
  cloudflareVisible(req: CloudflareVisibleRequest): Promise<{ result?: string; sent?: boolean; via?: string }>;
  /** When the stored Cloudflare clearance of the site of url ends; null without one (or off-device). */
  cloudflareClearance(url: string): Promise<number | null>;
  /** Polls the paired Android TV for «Пройти на телефоне» / «Войти на телефоне» (null stops). */
  cloudflareWatch(target: { url: string; token: string; notify: string; notifyLogin?: string } | null): Promise<void>;
  /** The TV's check still waiting for the person (the app was opened from the notification). */
  cloudflarePending(): Promise<TvCloudflareRequest | null>;
  onCloudflareRequest(cb: (r: TvCloudflareRequest) => void): () => void;
  /** Refuses the TV's request without a sheet (the TV hears «failed»). */
  cloudflareDecline(id: string): Promise<void>;
  /** «Войти через браузер» (native sheet with the site's login page); cookies never come back. */
  siteBrowserLogin(req: BrowserLoginRequest): Promise<{ result?: string; host?: string; via?: string; sent?: boolean }>;
  /**
   * «Передать вход на телевизор» with browser sessions: the native side adds each site's session cookies and User-Agent
   * to `payload` and posts it to the paired TV (they never pass through the page). Resolves the TV's answer.
   */
  siteSessionSend(o: {
    url: string;
    token: string;
    payload: unknown;
    sessions: { [id: string]: string[] };
    timeoutMs?: number;
  }): Promise<{ status: number; data: { [k: string]: unknown } | null; missing: string[] }>;
}

/**
 * «Пройти на телефоне»: the TV asks the phone to pass the check of a site (its root only); kind 'login' («Войти на
 * телефоне»): to sign in to the site `source` in the browser and send the session.
 */
export interface TvCloudflareRequest {
  id: string;
  site: string;
  url: string;
  kind?: 'login';
  source?: string;
}

function tvRequest(v: unknown): TvCloudflareRequest | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { id?: unknown; site?: unknown; url?: unknown };
  if (typeof o.id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(o.id)) return null;
  if (typeof o.site !== 'string' || !o.site || o.site.length > 60) return null;
  if (typeof o.url !== 'string' || !/^https?:\/\/[^/?#@\s]+\/$/i.test(o.url)) return null;
  const r: TvCloudflareRequest = { id: o.id, site: o.site, url: o.url };
  const x = v as { kind?: unknown; source?: unknown };
  if (x.kind === 'login') {
    if (typeof x.source !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(x.source)) return null;
    r.kind = 'login';
    r.source = x.source;
  } else if (x.kind !== undefined && x.kind !== 'check') return null;
  return r;
}

interface OmpNativePlugin {
  discoverTvs(o: { timeoutMs: number }): Promise<{ tvs: FoundTv[] }>;
  discoverOmpTvs(o: { timeoutMs: number; group?: string }): Promise<{ tvs?: unknown }>;
  discoverCastTvs(o: { timeoutMs: number; group?: string }): Promise<{ tvs?: unknown }>;
  probePorts(o: { ip: string; ports: number[]; timeoutMs: number }): Promise<{ open?: unknown }>;
  scanLan(o: { ports: number[]; timeoutMs?: number }): Promise<{ hits?: unknown; lan?: unknown }>;
  stopDiscovery(o: { group?: string }): Promise<void>;
  phoneName(): Promise<{ name?: string | null }>;
  tvConnect(o: { ip: string; register: string; preferPort?: number }): Promise<{ port: 3000 | 3001 }>;
  tvSend(o: { json: string }): Promise<void>;
  tvDisconnect(): Promise<void>;
  pointerConnect(o: { url: string }): Promise<void>;
  pointerSend(o: { frame: string }): Promise<void>;
  wakeOnLan(o: { mac: string; ip: string }): Promise<void>;
  openExternal(o: { url: string; mime: string }): Promise<void>;
  downloadAndInstallApk(o: { url: string; sha256: string; apks?: ApkFiles }): Promise<void>;
  deviceAbiKey(): Promise<{ key?: unknown }>;
  takePendingMagnet(): Promise<{ link?: string | null }>;
  startPlayerServer(o: { tvIp: string }): Promise<{ url: string }>;
  stopPlayerServer(): Promise<void>;
  queuePlayerCommands(o: { json: string }): Promise<void>;
  localServerInfo(): Promise<Partial<LocalServerInfo>>;
  startLocalServer(): Promise<Partial<LocalServerInfo>>;
  stopLocalServer(): Promise<void>;
  downloadLocalServer(): Promise<Partial<LocalServerInfo>>;
  cancelLocalServerDownload(): Promise<void>;
  localServerCache(): Promise<{ usedBytes?: number }>;
  clearLocalServerCache(): Promise<{ usedBytes?: number }>;
  localIpv4(): Promise<{ ip?: string | null }>;
  http(o: NativeHttpRequest): Promise<Partial<HttpResponse>>;
  httpClearCookies(o: { url: string }): Promise<void>;
  secretGet(o: { key: string }): Promise<{ value?: string | null }>;
  secretSet(o: { key: string; value: string }): Promise<void>;
  secretDelete(o: { key: string }): Promise<void>;
  shareText(o: { name: string; text: string; title?: string }): Promise<void>;
  cloudflareVisible(o: CloudflareVisibleRequest): Promise<{ result?: string; sent?: boolean; via?: string }>;
  cloudflareClearance(o: { url: string }): Promise<{ until?: number | null }>;
  cloudflareWatch(o: { url?: string; token?: string; notify?: string; notifyLogin?: string }): Promise<void>;
  siteBrowserLogin(o: BrowserLoginRequest): Promise<{ result?: string; host?: string; via?: string; sent?: boolean }>;
  siteSessionSend(o: { url: string; token: string; payload: unknown; sessions: { [id: string]: string[] }; timeoutMs?: number }): Promise<{
    status?: unknown;
    data?: unknown;
    missing?: unknown;
  }>;
  cloudflarePending(): Promise<{ request?: unknown }>;
  cloudflareDecline(o: { id: string }): Promise<void>;
  addListener(event: 'cloudflareRequest', cb: (e: unknown) => void): Promise<PluginListenerHandle>;
  addListener(event: 'tvMessage', cb: (e: { json: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'tvClosed', cb: (e: { reason: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'apkProgress', cb: (e: { percent: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'magnetReceived', cb: (e: { link: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'playerMessage', cb: (e: { body: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'localServerState', cb: (e: Partial<LocalServerState>) => void): Promise<PluginListenerHandle>;
  addListener(event: 'localServerDownload', cb: (e: Partial<LocalDownloadProgress>) => void): Promise<PluginListenerHandle>;
}

export const ONLY_ANDROID = 'Доступно только в приложении Android';

const available = Capacitor.isNativePlatform();
const plugin = available ? registerPlugin<OmpNativePlugin>('OmpNative') : null;

/** The registered plugin proxy for wrappers of other plugin methods (monitor/native.ts); null outside Android. */
export function rawPlugin(): unknown {
  return plugin;
}

function unavailable(): Promise<never> {
  return Promise.reject(new Error(ONLY_ANDROID));
}

/** Subscribes via the async addListener; the returned sync unsubscribe works before it settles too. */
function listen(add: () => Promise<PluginListenerHandle>): () => void {
  let removed = false;
  let handle: PluginListenerHandle | null = null;
  add().then(
    (h) => {
      if (removed) void h.remove();
      else handle = h;
    },
    () => {},
  );
  return () => {
    if (removed) return;
    removed = true;
    if (handle) void handle.remove();
  };
}

const noop = () => {};

/** Logs a failed native call (method name and message only) and passes the rejection on. */
function logged<T>(name: string, p: Promise<T>): Promise<T> {
  return p.then(
    (v) => v,
    (e) => {
      log('error', 'app', 'Нативный вызов ' + name + ': ' + (e && typeof e.message === 'string' ? e.message : 'ошибка'));
      throw e;
    },
  );
}

function parse(json: string): any {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function text(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function serverInfo(r: Partial<LocalServerInfo> | null | undefined): LocalServerInfo {
  const info: LocalServerInfo = { supported: r?.supported === true, running: r?.running === true };
  const version = text(r?.version);
  const ip = text(r?.ip);
  const error = text(r?.error);
  if (version) info.version = version;
  if (ip) info.ip = ip;
  if (r?.vpn === true) info.vpn = true;
  if (error) info.error = error;
  if (r?.binary === 'ready' || r?.binary === 'outdated' || r?.binary === 'missing') info.binary = r.binary;
  if (typeof r?.downloadBytes === 'number' && r.downloadBytes > 0) info.downloadBytes = r.downloadBytes;
  const pin = text(r?.pinVersion);
  if (pin) info.pinVersion = pin;
  if (r?.downloading === true) info.downloading = true;
  if (typeof r?.downloadPercent === 'number' && r.downloadPercent >= 0 && r.downloadPercent <= 100) info.downloadPercent = Math.round(r.downloadPercent);
  if (r?.mobileData === true) info.mobileData = true;
  return info;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const ATV_PORT = 8095;
const PHONE = 'Телефон';

/** Well-formed entries only, one per IP. */
function ompTvs(v: unknown): FoundOmpTv[] {
  const out: FoundOmpTv[] = [];
  if (!Array.isArray(v)) return out;
  for (const t of v) {
    if (!t || typeof t !== 'object' || typeof t.ip !== 'string' || !IPV4.test(t.ip)) continue;
    if (out.some((o) => o.ip === t.ip)) continue;
    const port = Number.isInteger(t.port) && t.port > 0 && t.port < 65536 ? t.port : ATV_PORT;
    out.push({ ip: t.ip, port, name: text(t.name) ?? 'Android TV', version: text(t.version) ?? '' });
  }
  return out;
}

/** Well-formed cast entries only, one per IP. */
function castTvs(v: unknown): FoundCastTv[] {
  const out: FoundCastTv[] = [];
  if (!Array.isArray(v)) return out;
  for (const t of v) {
    if (!t || typeof t !== 'object' || typeof t.ip !== 'string' || !IPV4.test(t.ip)) continue;
    if (out.some((o) => o.ip === t.ip)) continue;
    const tv: FoundCastTv = { ip: t.ip, name: text(t.name) ?? 'Android TV' };
    const model = text(t.model);
    if (model) tv.model = model;
    out.push(tv);
  }
  return out;
}

export const native: OmpNativeApi = {
  available,

  async discoverTvs(timeoutMs) {
    if (!plugin) return [];
    const r = await plugin.discoverTvs({ timeoutMs });
    return r.tvs ?? [];
  },

  async discoverOmpTvs(timeoutMs, group) {
    if (!plugin) return [];
    const r = await plugin.discoverOmpTvs(group ? { timeoutMs, group } : { timeoutMs });
    return ompTvs(r?.tvs);
  },

  async discoverCastTvs(timeoutMs, group) {
    if (!plugin) return [];
    const r = await plugin.discoverCastTvs(group ? { timeoutMs, group } : { timeoutMs });
    return castTvs(r?.tvs);
  },

  async stopDiscovery(group) {
    if (!plugin || !group) return;
    await plugin.stopDiscovery({ group }).catch(() => {});
  },

  async probePorts(ip, ports, timeoutMs) {
    if (!plugin) return [];
    const r = await plugin.probePorts({ ip, ports, timeoutMs });
    return Array.isArray(r?.open) ? r.open.filter((p): p is number => typeof p === 'number' && ports.indexOf(p) >= 0) : [];
  },

  async scanLan(ports, timeoutMs) {
    if (!plugin) return unavailable();
    const r = await plugin.scanLan(timeoutMs ? { ports, timeoutMs } : { ports });
    if (r?.lan === false) return null;
    const out: { ip: string; port: number }[] = [];
    if (Array.isArray(r?.hits)) {
      r.hits.forEach((h: unknown) => {
        const o = h && typeof h === 'object' ? (h as { ip?: unknown; port?: unknown }) : {};
        if (typeof o.ip === 'string' && typeof o.port === 'number' && ports.indexOf(o.port) >= 0) out.push({ ip: o.ip, port: o.port });
      });
    }
    return out;
  },

  async phoneName() {
    if (!plugin) return PHONE;
    try {
      const r = await plugin.phoneName();
      return text(r?.name?.trim()) ?? PHONE;
    } catch {
      return PHONE;
    }
  },

  tvConnect(ip, register, preferPort) {
    if (!plugin) return unavailable();
    const o: { ip: string; register: string; preferPort?: number } = { ip, register: JSON.stringify(register) };
    if (preferPort) o.preferPort = preferPort;
    return plugin.tvConnect(o);
  },

  tvSend(message) {
    if (!plugin) return unavailable();
    return plugin.tvSend({ json: JSON.stringify(message) });
  },

  onTvMessage(cb) {
    if (!plugin) return noop;
    return listen(() =>
      plugin.addListener('tvMessage', (e) => {
        const msg = parse(e.json);
        if (msg !== null) cb(msg);
      }),
    );
  },

  onTvClosed(cb) {
    if (!plugin) return noop;
    return listen(() => plugin.addListener('tvClosed', (e) => cb(e.reason)));
  },

  pointerConnect(socketPath) {
    if (!plugin) return unavailable();
    return plugin.pointerConnect({ url: socketPath });
  },

  pointerSend(frame) {
    if (!plugin) return unavailable();
    return plugin.pointerSend({ frame });
  },

  tvDisconnect() {
    if (!plugin) return unavailable();
    return plugin.tvDisconnect();
  },

  wakeOnLan(mac, ip) {
    if (!plugin) return unavailable();
    return logged('wakeOnLan', plugin.wakeOnLan({ mac, ip }));
  },

  openExternal(url, mime) {
    if (!plugin) return unavailable();
    return logged('openExternal', plugin.openExternal({ url, mime }));
  },

  async downloadAndInstallApk(url, sha256, onProgress, apks) {
    if (!plugin) return unavailable();
    // awaited so that no early progress event is missed
    const handle = await plugin.addListener('apkProgress', (e) => onProgress(e.percent));
    try {
      await logged('downloadAndInstallApk', plugin.downloadAndInstallApk(apks ? { url, sha256, apks } : { url, sha256 }));
    } finally {
      void handle.remove();
    }
  },

  async deviceAbiKey() {
    if (!plugin) return unavailable();
    const r = await plugin.deviceAbiKey();
    return r && (r.key === 'arm64' || r.key === 'armv7') ? r.key : null;
  },

  async takePendingMagnet() {
    if (!plugin) return unavailable();
    const r = await plugin.takePendingMagnet();
    return r.link ?? null;
  },

  onMagnet(cb) {
    if (!plugin) return noop;
    return listen(() => plugin.addListener('magnetReceived', (e) => cb(e.link)));
  },

  async startPlayerServer(tvIp) {
    if (!plugin) return unavailable();
    const r = await plugin.startPlayerServer({ tvIp });
    return r.url;
  },

  stopPlayerServer() {
    if (!plugin) return unavailable();
    return plugin.stopPlayerServer();
  },

  queuePlayerCommands(cmds) {
    if (!plugin) return unavailable();
    return plugin.queuePlayerCommands({ json: JSON.stringify(cmds) });
  },

  onPlayerMessage(cb) {
    if (!plugin) return noop;
    return listen(() => plugin.addListener('playerMessage', (e) => cb(e.body)));
  },

  async localServerInfo() {
    if (!plugin) return { supported: false, running: false };
    return serverInfo(await plugin.localServerInfo());
  },

  async startLocalServer() {
    if (!plugin) return unavailable();
    return serverInfo(await logged('startLocalServer', plugin.startLocalServer()));
  },

  stopLocalServer() {
    if (!plugin) return unavailable();
    return plugin.stopLocalServer();
  },

  async downloadLocalServer(onProgress) {
    if (!plugin) return unavailable();
    // awaited so that no early progress event is missed
    const handle = await plugin.addListener('localServerDownload', (e) => {
      if (e.phase === 'verify') onProgress({ phase: 'verify' });
      else if (typeof e.percent === 'number') onProgress({ phase: 'download', percent: Math.max(0, Math.min(100, Math.round(e.percent))) });
    });
    try {
      return serverInfo(await plugin.downloadLocalServer());
    } finally {
      void handle.remove();
    }
  },

  cancelLocalServerDownload() {
    if (!plugin) return unavailable();
    return plugin.cancelLocalServerDownload();
  },

  async localServerCache() {
    if (!plugin) return unavailable();
    const r = await plugin.localServerCache();
    return typeof r.usedBytes === 'number' && r.usedBytes > 0 ? r.usedBytes : 0;
  },

  async clearLocalServerCache() {
    if (!plugin) return unavailable();
    await plugin.clearLocalServerCache();
  },

  async localIpv4() {
    if (!plugin) return null;
    const r = await plugin.localIpv4();
    return text(r.ip) ?? null;
  },

  onLocalServerState(cb) {
    if (!plugin) return noop;
    return listen(() =>
      plugin.addListener('localServerState', (e) => {
        const state: LocalServerState = { running: e.running === true };
        const error = text(e.error);
        if (error) state.error = error;
        cb(state);
      }),
    );
  },

  async http(req) {
    if (!plugin) return unavailable();
    const r = await plugin.http(req);
    return {
      status: typeof r?.status === 'number' ? r.status : 0,
      url: text(r?.url) ?? req.url,
      text: typeof r?.text === 'string' ? r.text : '',
      // a passed Cloudflare check ('browser' | 'flaresolverr'): src/sources/http.ts logs it
      ...((r as { cloudflare?: unknown } | undefined)?.cloudflare ? { cloudflare: (r as { cloudflare?: unknown }).cloudflare } : {}),
    } as HttpResponse;
  },

  httpClearCookies(url) {
    if (!plugin) return unavailable();
    return plugin.httpClearCookies({ url });
  },

  async secretGet(key) {
    if (!plugin) return unavailable();
    const r = await plugin.secretGet({ key });
    return typeof r?.value === 'string' ? r.value : null;
  },

  secretSet(key, value) {
    if (!plugin) return unavailable();
    return plugin.secretSet({ key, value });
  },

  secretDelete(key) {
    if (!plugin) return unavailable();
    return plugin.secretDelete({ key });
  },

  shareText(o) {
    if (!plugin) return unavailable();
    return logged('shareText', plugin.shareText(o));
  },

  cloudflareVisible(req) {
    if (!plugin) return unavailable();
    return plugin.cloudflareVisible(req);
  },

  async cloudflareClearance(url) {
    if (!plugin) return null;
    const r = await plugin.cloudflareClearance({ url });
    return r && typeof r.until === 'number' && isFinite(r.until) ? r.until : null;
  },

  async cloudflareWatch(target) {
    if (!plugin) return;
    await plugin.cloudflareWatch(
      target ? { url: target.url, token: target.token, notify: target.notify, ...(target.notifyLogin ? { notifyLogin: target.notifyLogin } : {}) } : {},
    );
  },

  siteBrowserLogin(req) {
    if (!plugin) return unavailable();
    return plugin.siteBrowserLogin(req);
  },

  async siteSessionSend(o) {
    if (!plugin) return unavailable();
    const r = await plugin.siteSessionSend(o);
    const status = r && typeof r.status === 'number' ? r.status : 0;
    const data = r && r.data && typeof r.data === 'object' ? (r.data as { [k: string]: unknown }) : null;
    const missing = r && Array.isArray(r.missing) ? r.missing.filter((x): x is string => typeof x === 'string') : [];
    return { status, data, missing };
  },

  async cloudflarePending() {
    if (!plugin) return null;
    const r = await plugin.cloudflarePending();
    return tvRequest(r && r.request);
  },

  async cloudflareDecline(id) {
    if (!plugin) return;
    await plugin.cloudflareDecline({ id });
  },

  onCloudflareRequest(cb) {
    if (!plugin) return noop;
    return listen(() =>
      plugin.addListener('cloudflareRequest', (e) => {
        const r = tvRequest(e);
        if (r) cb(r);
      }),
    );
  },
};

/** HTTP for the built-in search sources (src/sources); rejects off-device. */
export const sourceHttp: SourceHttp = createSourceHttp(
  (req) => native.http(req),
  (url) => native.httpClearCookies(url),
);

/** Keystore-encrypted storage for tracker logins; rejects off-device. */
export const secrets: SecretStore = createSecretStore({
  get: (key) => native.secretGet(key).then((value) => ({ value })),
  set: (key, value) => native.secretSet(key, value),
  delete: (key) => native.secretDelete(key),
});

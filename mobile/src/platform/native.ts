// Wrapper over the native Android plugin OmpNative (android/.../OmpNativePlugin.kt).
// The plugin is transport only: SSDP, TV sockets, intents, APK install, player server, embedded TorrServer.
// SSAP lives in src/tv.
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { createSecretStore, createSourceHttp, type NativeHttpRequest } from '../../../src/sources/http';
import { log } from '../../../src/lib/log';
import type { HttpResponse, SecretStore, SourceHttp } from '../../../src/sources/types';

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

/** The embedded TorrServer (arm64 only), port 8090. */
export interface LocalServerInfo {
  supported: boolean;
  running: boolean;
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

export interface OmpNativeApi {
  available: boolean;
  discoverTvs(timeoutMs: number): Promise<FoundTv[]>;
  /** NSD search for Android TVs with OMP; stops after `timeoutMs`. */
  discoverOmpTvs(timeoutMs: number): Promise<FoundOmpTv[]>;
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
  downloadAndInstallApk(url: string, sha256: string, onProgress: (percent: number) => void): Promise<void>;
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
  shareText(o: { name: string; text: string }): Promise<void>;
}

interface OmpNativePlugin {
  discoverTvs(o: { timeoutMs: number }): Promise<{ tvs: FoundTv[] }>;
  discoverOmpTvs(o: { timeoutMs: number }): Promise<{ tvs?: unknown }>;
  phoneName(): Promise<{ name?: string | null }>;
  tvConnect(o: { ip: string; register: string; preferPort?: number }): Promise<{ port: 3000 | 3001 }>;
  tvSend(o: { json: string }): Promise<void>;
  tvDisconnect(): Promise<void>;
  pointerConnect(o: { url: string }): Promise<void>;
  pointerSend(o: { frame: string }): Promise<void>;
  wakeOnLan(o: { mac: string; ip: string }): Promise<void>;
  openExternal(o: { url: string; mime: string }): Promise<void>;
  downloadAndInstallApk(o: { url: string; sha256: string }): Promise<void>;
  takePendingMagnet(): Promise<{ link?: string | null }>;
  startPlayerServer(o: { tvIp: string }): Promise<{ url: string }>;
  stopPlayerServer(): Promise<void>;
  queuePlayerCommands(o: { json: string }): Promise<void>;
  localServerInfo(): Promise<Partial<LocalServerInfo>>;
  startLocalServer(): Promise<Partial<LocalServerInfo>>;
  stopLocalServer(): Promise<void>;
  localServerCache(): Promise<{ usedBytes?: number }>;
  clearLocalServerCache(): Promise<{ usedBytes?: number }>;
  localIpv4(): Promise<{ ip?: string | null }>;
  http(o: NativeHttpRequest): Promise<Partial<HttpResponse>>;
  httpClearCookies(o: { url: string }): Promise<void>;
  secretGet(o: { key: string }): Promise<{ value?: string | null }>;
  secretSet(o: { key: string; value: string }): Promise<void>;
  secretDelete(o: { key: string }): Promise<void>;
  shareText(o: { name: string; text: string }): Promise<void>;
  addListener(event: 'tvMessage', cb: (e: { json: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'tvClosed', cb: (e: { reason: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'apkProgress', cb: (e: { percent: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'magnetReceived', cb: (e: { link: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'playerMessage', cb: (e: { body: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'localServerState', cb: (e: Partial<LocalServerState>) => void): Promise<PluginListenerHandle>;
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

export const native: OmpNativeApi = {
  available,

  async discoverTvs(timeoutMs) {
    if (!plugin) return [];
    const r = await plugin.discoverTvs({ timeoutMs });
    return r.tvs ?? [];
  },

  async discoverOmpTvs(timeoutMs) {
    if (!plugin) return [];
    const r = await plugin.discoverOmpTvs({ timeoutMs });
    return ompTvs(r?.tvs);
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

  async downloadAndInstallApk(url, sha256, onProgress) {
    if (!plugin) return unavailable();
    // awaited so that no early progress event is missed
    const handle = await plugin.addListener('apkProgress', (e) => onProgress(e.percent));
    try {
      await logged('downloadAndInstallApk', plugin.downloadAndInstallApk({ url, sha256 }));
    } finally {
      void handle.remove();
    }
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
    };
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

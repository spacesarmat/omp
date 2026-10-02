// Wrapper over the native Android plugin OmpNative (android/.../OmpNativePlugin.kt).
// The plugin is transport only: SSDP, TV sockets, intents, APK install, player server. SSAP lives in src/tv.
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface FoundTv {
  ip: string;
  name: string;
  model?: string;
}

export interface OmpNativeApi {
  available: boolean;
  discoverTvs(timeoutMs: number): Promise<FoundTv[]>;
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
}

interface OmpNativePlugin {
  discoverTvs(o: { timeoutMs: number }): Promise<{ tvs: FoundTv[] }>;
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
  addListener(event: 'tvMessage', cb: (e: { json: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'tvClosed', cb: (e: { reason: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'apkProgress', cb: (e: { percent: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'magnetReceived', cb: (e: { link: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'playerMessage', cb: (e: { body: string }) => void): Promise<PluginListenerHandle>;
}

export const ONLY_ANDROID = 'Доступно только в приложении Android';

const available = Capacitor.isNativePlatform();
const plugin = available ? registerPlugin<OmpNativePlugin>('OmpNative') : null;

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

function parse(json: string): any {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export const native: OmpNativeApi = {
  available,

  async discoverTvs(timeoutMs) {
    if (!plugin) return [];
    const r = await plugin.discoverTvs({ timeoutMs });
    return r.tvs ?? [];
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
    return plugin.wakeOnLan({ mac, ip });
  },

  openExternal(url, mime) {
    if (!plugin) return unavailable();
    return plugin.openExternal({ url, mime });
  },

  async downloadAndInstallApk(url, sha256, onProgress) {
    if (!plugin) return unavailable();
    // awaited so that no early progress event is missed
    const handle = await plugin.addListener('apkProgress', (e) => onProgress(e.percent));
    try {
      await plugin.downloadAndInstallApk({ url, sha256 });
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
};

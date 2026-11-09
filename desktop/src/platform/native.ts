import { createBridge, type DesktopBridge } from './bridge';
import { createServerApi, EMBEDDED_SERVER_ORIGIN, type ServerApi, type ServerHandle } from './server';
import { createPlayerApi } from './player';
import { createUpdateApi, updateInfoFromPackage } from './update';
import { createSecretStore, createSourceHttp, type NativeHttpRequest } from '../../../src/sources/http';
import type { NativeBilling, SecretStore, SourceHttp } from '../../../src/sources/types';
import type { LocalDownloadProgress, LocalServerInfo, LocalServerState, OmpNativeApi } from '../../../mobile/src/platform/native';
import { t } from '../../../src/i18n';

export interface DesktopNative {
  native: OmpNativeApi;
  sourceHttp: SourceHttp;
  nativeBilling: NativeBilling | null;
  secrets: SecretStore;
  serverApi: ServerApi;
}

type SecretStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const memorySecrets = new Map<string, string>();

function secretsStorage(): SecretStorage {
  if (typeof localStorage !== 'undefined') return localStorage;
  return {
    getItem: (key) => memorySecrets.get(key) ?? null,
    setItem: (key, value) => void memorySecrets.set(key, value),
    removeItem: (key) => void memorySecrets.delete(key),
  };
}

function localInfo(handle: ServerHandle, installed: boolean): LocalServerInfo {
  return {
    supported: true,
    running: handle.status === 'ready',
    binary: installed ? 'ready' : 'missing',
    pinVersion: 'MatriX.150',
    ip: '127.0.0.1',
    error: handle.error,
  };
}

export function createDesktopNative(bridge: DesktopBridge = createBridge()): DesktopNative {
  const serverApi = createServerApi(bridge);
  const playerApi = createPlayerApi(bridge);
  const updateApi = createUpdateApi(bridge);
  const stateListeners = new Set<(state: LocalServerState) => void>();
  const emit = (running: boolean, error?: string) => {
    for (const listener of stateListeners) listener({ running, error });
  };
  const http = (request: NativeHttpRequest & { bodyBase64?: string; contentType?: string }) =>
    bridge.invoke<{ status: number; base64: string; url?: string; text?: string }>('native_http', { request });
  const clearCookies = (url: string) => bridge.invoke<void>('native_http_clear_cookies', { url });
  const sourceHttp = createSourceHttp(http, clearCookies);
  const storage = secretsStorage();
  const secrets = createSecretStore({
    get: async (key) => ({ value: storage.getItem(`omp.desktop.secret.${key}`) }),
    set: async (key, value) => void storage.setItem(`omp.desktop.secret.${key}`, value),
    delete: async (key) => void storage.removeItem(`omp.desktop.secret.${key}`),
  });

  const core: Record<string, unknown> = {
    available: false,
    discoverTvs: async () => [],
    discoverOmpTvs: async () => [],
    discoverCastTvs: async () => [],
    scanLan: async () => null,
    phoneName: async () => 'OMP Desktop',
    localIpv4: async () => null,
    wifiHint: async () => ({ available: false, ssid: null }),
    wifiCurrent: async () => ({ kind: 'unsupported', ssid: null }),
    requestWifiName: async () => ({ kind: 'unsupported', ssid: null }),
    player2160: async () => null,
    embedded2160: async () => false,
    audioState: async () => null,
    takePendingAudioOpen: async () => null,
    takePendingMagnet: async () => null,
    deviceAbiKey: async () => null,
    canInstallApks: async () => true,
    downloadAndInstallApk: async (url: string, sha256: string, onProgress: (percent: number) => void) => {
      const info = updateInfoFromPackage(url, sha256);
      await updateApi.updateDownload(info);
      onProgress(50);
      await updateApi.updateApply(info);
      onProgress(100);
    },
    localServerCache: async () => 0,
    rpcSetEnabled: async () => null,
    rpcInfo: async () => null,
    localServerInfo: async () => {
      const [handle, installed] = await Promise.all([
        serverApi.serverStatus(),
        bridge.invoke<boolean>('server_binary_installed'),
      ]);
      return localInfo(handle, installed);
    },
    startLocalServer: async () => {
      const handle = await serverApi.serverStart({ mode: 'embedded', origin: EMBEDDED_SERVER_ORIGIN });
      const info = localInfo(handle, true);
      emit(info.running, info.error);
      return info;
    },
    stopLocalServer: async () => {
      await serverApi.serverStop();
      emit(false);
    },
    downloadLocalServer: async (onProgress: (progress: LocalDownloadProgress) => void) => {
      onProgress({ phase: 'verify' });
      const handle = await serverApi.serverUpdate();
      const info = localInfo(handle, true);
      emit(info.running, info.error);
      return info;
    },
    cancelLocalServerDownload: async () => undefined,
    clearLocalServerCache: async () => undefined,
    onLocalServerState: (listener: (state: LocalServerState) => void) => {
      stateListeners.add(listener);
      return () => void stateListeners.delete(listener);
    },
    http,
    httpClearCookies: clearCookies,
    openExternal: async (url: string, mime: string) => {
      if (!mime.startsWith('video/')) {
        window.open(url, '_blank', 'noopener');
        return;
      }
      const status = await playerApi.playerOpen({ url });
      if (status.state === 'error') throw new Error(status.error || 'player launch failed');
    },
    shareText: async ({ name, text }: { name: string; text: string }) => {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    shareMessage: async ({ text }: { text: string }) => {
      await navigator.clipboard.writeText(text);
      return 'copied';
    },
    setLanguage: async () => undefined,
    setOrientation: async () => undefined,
    setCleartextHosts: async () => undefined,
    cloudflareClearance: async () => null,
  };
  const native = new Proxy(core, {
    get(target, property) {
      if (property in target) return target[property as string];
      if (typeof property === 'string' && property.startsWith('on')) return () => () => undefined;
      return () => Promise.resolve(undefined);
    },
  }) as unknown as OmpNativeApi;

  return { native, sourceHttp, nativeBilling: null, secrets, serverApi };
}

const desktop = createDesktopNative();
export const native = desktop.native;
export const sourceHttp = desktop.sourceHttp;
export const nativeBilling = desktop.nativeBilling;
export const secrets = desktop.secrets;

export function rawPlugin(): unknown {
  return null;
}

export const onlyAndroid = () => t('errors.onlyAndroid');

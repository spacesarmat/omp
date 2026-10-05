// The embedded TorrServer on the phone: status, autostart setting and the start sequence.
import { signal } from '@preact/signals';
import { native, type OmpNativeApi, type LocalServerInfo, type LocalDownloadProgress } from '../platform/native';
import { loadJson, saveJson, isObject } from '../../../src/store/storage';
import { addServer, setActiveServer } from '../../../src/store/servers';
import { TorrServerClient } from '../../../src/api/torrserver';
import { errorMessage } from '../../../src/api/http';
import { log } from '../../../src/lib/log';
import { t, fmtSize } from '../../../src/i18n';
import { ru } from '../../../src/i18n/ru';
import { TORRSERVER_VERSION } from './torrserverVersion';

export const LOCAL_URL = 'http://127.0.0.1:8090';
export const LOCAL_PORT = 8090;
/** Display name of the local server, in the current language (stored with the server when it is added). */
export const localName = () => t('localServer.name');

type NativeSlice = Pick<
  OmpNativeApi,
  | 'localServerInfo'
  | 'startLocalServer'
  | 'stopLocalServer'
  | 'downloadLocalServer'
  | 'cancelLocalServerDownload'
  | 'localServerCache'
  | 'clearLocalServerCache'
  | 'onLocalServerState'
>;

export interface LocalServerDeps {
  native: NativeSlice;
  echo: (url: string) => Promise<string>;
}

const realDeps: LocalServerDeps = {
  native,
  echo: (url) => new TorrServerClient({ url }).echo(),
};

let deps: LocalServerDeps = realDeps;

/** Replaces the side effects (tests); null restores the real ones. */
export function setLocalServerDeps(d: Partial<LocalServerDeps> | null): void {
  deps = d ? { ...realDeps, ...d } : realDeps;
}

export const localServer = signal<LocalServerInfo>({ supported: false, running: false });

const KEY = 'tsp.localServer';

// autostart stays off until the user has started the server once; `autostartKnown` tells "never chosen" from "off"
let autostartKnown = false;

function readAutostart(): boolean | null {
  const v = loadJson<unknown>(KEY, null, (x) => isObject(x) && typeof x.autostart === 'boolean');
  return isObject(v) ? (v.autostart as boolean) : null;
}

const initial = readAutostart();
autostartKnown = initial !== null;
export const localAutostart = signal<boolean>(initial === true);

/** Re-reads the persisted setting (tests). */
export function reloadLocalServerSettings(): void {
  const v = readAutostart();
  autostartKnown = v !== null;
  localAutostart.value = v === true;
}

export function setAutostart(on: boolean): void {
  autostartKnown = true;
  localAutostart.value = on;
  saveJson(KEY, { autostart: on });
}

export async function refreshLocalServer(): Promise<void> {
  try {
    localServer.value = await deps.native.localServerInfo();
  } catch {
    localServer.value = { supported: false, running: false };
  }
}

/** Starts the service and refreshes the status; a failure goes into `localServer.error`. */
export async function startLocal(): Promise<void> {
  try {
    await deps.native.startLocalServer();
    if (!autostartKnown) setAutostart(true);
    await refreshLocalServer();
  } catch (e) {
    logStartFailure(e);
    await refreshLocalServer();
    localServer.value = { ...localServer.value, error: errorMessage(e) };
  }
}

export async function stopLocal(): Promise<void> {
  try {
    await deps.native.stopLocalServer();
  } catch (e) {
    await refreshLocalServer();
    localServer.value = { ...localServer.value, error: errorMessage(e) };
    return;
  }
  await refreshLocalServer();
}

/** Bytes the server's disk cache occupies; 0 when unknown. */
export function localCacheBytes(): Promise<number> {
  return deps.native.localServerCache().catch(() => 0);
}

/** Empties the cache (the service restarts if it was running) and refreshes the status. */
export async function clearLocalCache(): Promise<void> {
  await deps.native.clearLocalServerCache();
  await refreshLocalServer();
}

export const CACHE_LIMIT_BYTES = 1024 * 1024 * 1024;

/** Start of the native (Russian) text when the binary does not run on this device (linker, 16 KB pages, instant crash). */
export const CANNOT_RUN_PREFIX = ru.localServer.cannotRun;

/** Logs a failed start: an error entry when the server cannot run on this device at all. */
function logStartFailure(e: unknown): void {
  if (errorMessage(e).startsWith(CANNOT_RUN_PREFIX)) log('error', 'server', t('localServer.cannotRun'));
  else log('warn', 'server', t('localServer.logStartFailed'));
}

/** Thrown by setupLocal when the screen that ran it has gone after the download. */
export const SETUP_ABANDONED = 'setup-abandoned';

/** The binary has to be downloaded (first start) or updated (the pinned release changed). */
export function needsDownload(info: LocalServerInfo): boolean {
  return info.supported && (info.binary === 'missing' || info.binary === 'outdated');
}

/** A verified binary is on the phone (an outdated one still runs). */
export function canRun(info: LocalServerInfo): boolean {
  return info.supported && info.binary !== 'missing';
}

/** «~61 МБ» from the pinned download size; empty when unknown. */
export function downloadSize(info: LocalServerInfo): string {
  return info.downloadBytes ? '~' + fmtSize(Math.max(info.downloadBytes, 1024 * 1024)) : '';
}

/** True for the rejection of a download the user cancelled. */
export function isDownloadCancelled(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: unknown }).code === 'cancelled';
}

/** The plugin state as is (the setup screen decides whether to offer the download). */
export function getLocalServerInfo(): Promise<LocalServerInfo> {
  return deps.native.localServerInfo();
}

export function cancelLocalDownload(): Promise<void> {
  return deps.native.cancelLocalServerDownload().catch(() => {});
}

/** Step labels' state: index of the running step, 4 when everything is done. */
export const SETUP_STEPS = 4;

/**
 * The visible start sequence: prepare (download the binary when needed), start in the background, check /echo,
 * connect OMP. `onStep(i, version)` reports the step that is running now; the last call is `onStep(4, …)`.
 * `onDownload` gets the download progress; `download` false skips the update of an outdated binary (a missing one is
 * always downloaded). The download outlives the screen; when `alive()` is false after it, nothing is started (rejects
 * with SETUP_ABANDONED). Rejects at the failing step.
 */
export async function setupLocal(
  onStep: (step: number, version: string) => void,
  onDownload: (p: LocalDownloadProgress) => void = () => {},
  download = true,
  alive: () => boolean = () => true,
): Promise<void> {
  const info = await deps.native.localServerInfo();
  if (!info.supported) throw new Error(t('localServer.unsupported'));
  const pinned = info.pinVersion || TORRSERVER_VERSION;
  let version = (info.running && info.version) || pinned;
  onStep(0, version);
  if (needsDownload(info) && (download || info.binary === 'missing')) {
    version = pinned;
    onStep(0, version);
    log('info', 'server', info.binary === 'outdated' ? t('localServer.logUpdating') : t('localServer.logDownloading'));
    try {
      await deps.native.downloadLocalServer(onDownload);
    } catch (e) {
      log(isDownloadCancelled(e) ? 'info' : 'warn', 'server', isDownloadCancelled(e) ? t('localServer.logCancelled') : t('localServer.logDownloadFailed'));
      throw e;
    }
    log('info', 'server', t('localServer.logDownloaded'));
    // a running old version: restart on the new binary
    if (!alive()) throw new Error(SETUP_ABANDONED);
    if (info.running) await deps.native.stopLocalServer();
  }
  onStep(1, version);
  try {
    await deps.native.startLocalServer();
  } catch (e) {
    logStartFailure(e);
    throw e;
  }
  onStep(2, version);
  await deps.echo(LOCAL_URL);
  onStep(3, version);
  const s = addServer({ name: localName(), url: LOCAL_URL });
  setActiveServer(s.id);
  if (!autostartKnown) setAutostart(true);
  await refreshLocalServer();
  onStep(4, version);
}

/** App start: refresh the status and, when enabled, start the server without any UI. */
export async function autostartLocal(): Promise<void> {
  await refreshLocalServer();
  const st = localServer.value;
  // never downloads on its own: without a binary the user starts it from the screen
  if (localAutostart.value && canRun(st) && !st.running) await startLocal();
}

/** Keeps the store in sync with the service (notification «Остановить», crash). Returns the unsubscribe. */
export function watchLocalServer(): () => void {
  return deps.native.onLocalServerState((s) => {
    localServer.value = { ...localServer.value, running: s.running, error: s.error };
    if (s.error && s.error.startsWith(CANNOT_RUN_PREFIX)) log('error', 'server', t('localServer.cannotRun'));
    if (s.running) void refreshLocalServer();
  });
}

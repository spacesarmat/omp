// The embedded TorrServer on the phone: status, autostart setting and the start sequence.
import { signal } from '@preact/signals';
import { native, type OmpNativeApi, type LocalServerInfo } from '../platform/native';
import { loadJson, saveJson, isObject } from '../../../src/store/storage';
import { addServer, setActiveServer } from '../../../src/store/servers';
import { TorrServerClient } from '../../../src/api/torrserver';
import { errorMessage } from '../../../src/api/http';
import { TORRSERVER_VERSION } from './torrserverVersion';

export const LOCAL_URL = 'http://127.0.0.1:8090';
export const LOCAL_PORT = 8090;
export const LOCAL_NAME = 'Этот телефон';

type NativeSlice = Pick<
  OmpNativeApi,
  'localServerInfo' | 'startLocalServer' | 'stopLocalServer' | 'localServerCache' | 'clearLocalServerCache' | 'onLocalServerState'
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

/** «412 МБ» / «1,2 ГБ». */
export function formatBytes(b: number): string {
  if (b >= CACHE_LIMIT_BYTES) return (b / CACHE_LIMIT_BYTES).toFixed(1).replace('.', ',') + ' ГБ';
  return Math.round(b / (1024 * 1024)) + ' МБ';
}

/** Step labels' state: index of the running step, 4 when everything is done. */
export const SETUP_STEPS = 4;

/**
 * The visible start sequence: prepare (info), start in the background, check /echo, connect OMP.
 * `onStep(i, version)` reports the step that is running now; the last call is `onStep(4, …)`. Rejects at the failing step.
 */
export async function setupLocal(onStep: (step: number, version: string) => void): Promise<void> {
  const info = await deps.native.localServerInfo();
  if (!info.supported) throw new Error('Встроенный сервер недоступен на этом телефоне');
  const version = (info.running && info.version) || TORRSERVER_VERSION;
  onStep(0, version);
  onStep(1, version);
  await deps.native.startLocalServer();
  onStep(2, version);
  await deps.echo(LOCAL_URL);
  onStep(3, version);
  const s = addServer({ name: LOCAL_NAME, url: LOCAL_URL });
  setActiveServer(s.id);
  if (!autostartKnown) setAutostart(true);
  await refreshLocalServer();
  onStep(4, version);
}

/** App start: refresh the status and, when enabled, start the server without any UI. */
export async function autostartLocal(): Promise<void> {
  await refreshLocalServer();
  const st = localServer.value;
  if (localAutostart.value && st.supported && !st.running) await startLocal();
}

/** Keeps the store in sync with the service (notification «Остановить», crash). Returns the unsubscribe. */
export function watchLocalServer(): () => void {
  return deps.native.onLocalServerState((s) => {
    localServer.value = { ...localServer.value, running: s.running, error: s.error };
    if (s.running) void refreshLocalServer();
  });
}

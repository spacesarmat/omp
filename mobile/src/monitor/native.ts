// Monitoring calls of the OmpNative plugin (android/.../OmpNativePlugin.kt, section «monitoring»): the WorkManager
// schedule, «Проверить сейчас», the last run, the notification permission and links from notifications.
import type { PluginListenerHandle } from '@capacitor/core';
import { rawPlugin, ONLY_ANDROID } from '../platform/native';
import { sanitizeSummary, type MonitorSummary } from '../../../src/monitor/settings';

export type NotifyPermission = 'granted' | 'denied' | 'prompt';

export interface MonitorStatus {
  /** The periodic check is scheduled. */
  enabled: boolean;
  hours: number;
  wifiOnly: boolean;
  /** A check or a notification button is running now. */
  running: boolean;
  /** Unix ms of the last finished run (any kind), when known. */
  lastRun?: number;
  /** Summary the page reported for the last check; absent when it did not finish (lastError says why). */
  lastSummary?: MonitorSummary;
  lastError?: string;
  /** Unix ms of the next periodic run, when WorkManager knows it. */
  nextRun?: number;
}

/** The plugin methods used here (registered by mobile/src/platform/native.ts). */
export interface MonitorPlugin {
  monitorSchedule(o: { enabled: boolean; hours: number; wifiOnly: boolean }): Promise<unknown>;
  monitorRunNow(): Promise<unknown>;
  monitorStatus(): Promise<Record<string, unknown>>;
  monitorNotifyPermission(): Promise<{ state?: string }>;
  requestMonitorNotifyPermission(): Promise<{ state?: string }>;
  takeMonitorOpen(): Promise<{ url?: string | null }>;
  addListener(event: 'monitorOpen', cb: (e: { url?: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'monitorDone', cb: (e: { summary?: string }) => void): Promise<PluginListenerHandle>;
}

export interface MonitorNative {
  available: boolean;
  /** Schedules (enabled) or cancels the periodic check; hours 1/3/6/12, wifiOnly → unmetered network only. */
  schedule(o: { enabled: boolean; hours: number; wifiOnly: boolean }): Promise<void>;
  /** «Проверить сейчас»: a one-time check (any network). */
  runNow(): Promise<void>;
  status(): Promise<MonitorStatus | null>;
  /** POST_NOTIFICATIONS state (Android 13+; older: whether notifications are on for the app). */
  notifyPermission(): Promise<NotifyPermission>;
  /** Asks for it (the system dialog); resolves with the new state. */
  requestNotifyPermission(): Promise<NotifyPermission>;
  /**
   * The link of a tapped notification not handled yet: `omp:news?sub=<subId>&finding=<key>` (+ `&watch=1` for
   * «Смотреть на ТВ»); null when none.
   */
  takeOpen(): Promise<string | null>;
  /** The same links while the app runs; returns the unsubscribe. */
  onOpen(cb: (url: string) => void): () => void;
  /** A background run finished (reload the monitor stores from localStorage). */
  onDone(cb: (summary: MonitorSummary | null) => void): () => void;
}

function permission(v: unknown): NotifyPermission {
  return v === 'granted' || v === 'denied' ? v : 'prompt';
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && isFinite(v) && v > 0 ? v : undefined;
}

function parseSummary(v: unknown): MonitorSummary | null {
  if (typeof v !== 'string' || !v) return null;
  try {
    return sanitizeSummary(JSON.parse(v));
  } catch {
    return null;
  }
}

export function parseStatus(r: Record<string, unknown> | null | undefined): MonitorStatus {
  const o = r || {};
  const s: MonitorStatus = {
    enabled: o.enabled === true,
    hours: typeof o.hours === 'number' ? o.hours : 3,
    wifiOnly: o.wifiOnly !== false,
    running: o.running === true,
  };
  const lastRun = num(o.lastRun);
  if (lastRun) s.lastRun = lastRun;
  const summary = parseSummary(o.lastSummary);
  if (summary) s.lastSummary = summary;
  if (typeof o.lastError === 'string' && o.lastError) s.lastError = o.lastError;
  const nextRun = num(o.nextRun);
  if (nextRun) s.nextRun = nextRun;
  return s;
}

const OPEN = /^omp:news(\?.*)?$/;

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

export function createMonitorNative(plugin: MonitorPlugin | null): MonitorNative {
  const unavailable = (): Promise<never> => Promise.reject(new Error(ONLY_ANDROID));
  return {
    available: !!plugin,
    schedule: (o) => (plugin ? plugin.monitorSchedule(o).then(() => undefined) : unavailable()),
    runNow: () => (plugin ? plugin.monitorRunNow().then(() => undefined) : unavailable()),
    status: () => (plugin ? plugin.monitorStatus().then(parseStatus, () => null) : Promise.resolve(null)),
    notifyPermission: () =>
      plugin ? plugin.monitorNotifyPermission().then((r) => permission(r?.state), () => 'denied' as const) : Promise.resolve('denied'),
    requestNotifyPermission: () =>
      plugin ? plugin.requestMonitorNotifyPermission().then((r) => permission(r?.state), () => 'denied' as const) : Promise.resolve('denied'),
    takeOpen: () =>
      plugin
        ? plugin.takeMonitorOpen().then(
            (r) => (typeof r?.url === 'string' && OPEN.test(r.url) ? r.url : null),
            () => null,
          )
        : Promise.resolve(null),
    onOpen(cb) {
      if (!plugin) return () => {};
      return listen(() =>
        plugin.addListener('monitorOpen', (e) => {
          if (typeof e?.url === 'string' && OPEN.test(e.url)) cb(e.url);
        }),
      );
    },
    onDone(cb) {
      if (!plugin) return () => {};
      return listen(() => plugin.addListener('monitorDone', (e) => cb(parseSummary(e?.summary))));
    },
  };
}

export const monitorNative: MonitorNative = createMonitorNative(rawPlugin() as MonitorPlugin | null);

// Monitoring settings («Настройки» → «Мониторинг») and the summary of the last background check. Both live in
// localStorage, so the phone app and its background page (mobile/monitor.html, same origin) read the same values.
// Chromium 53 safe.
import { isObject, loadJson, saveJson } from '../store/storage';

export const MONITOR_KEY = 'tsp.monitor';
export const LAST_RUN_KEY = 'tsp.monitorLast';

/** «Как часто»: hours between background checks. */
export const MONITOR_HOURS = [1, 3, 6, 12];

export interface MonitorSettings {
  /** «Проверять в фоне». */
  enabled: boolean;
  /** One of MONITOR_HOURS. */
  hours: number;
  /** «Только через Wi-Fi». */
  wifiOnly: boolean;
  /** «Следить за новыми сериями». */
  episodes: boolean;
}

export const DEFAULT_MONITOR: MonitorSettings = { enabled: true, hours: 3, wifiOnly: true, episodes: true };

export function sanitizeMonitorSettings(v: unknown): MonitorSettings {
  const o = isObject(v) ? v : {};
  const hours = typeof o.hours === 'number' && MONITOR_HOURS.indexOf(o.hours) >= 0 ? o.hours : DEFAULT_MONITOR.hours;
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : DEFAULT_MONITOR.enabled,
    hours,
    wifiOnly: typeof o.wifiOnly === 'boolean' ? o.wifiOnly : DEFAULT_MONITOR.wifiOnly,
    episodes: typeof o.episodes === 'boolean' ? o.episodes : DEFAULT_MONITOR.episodes,
  };
}

export function loadMonitorSettings(): MonitorSettings {
  return sanitizeMonitorSettings(loadJson<unknown>(MONITOR_KEY, null));
}

/** Saves a patch over the stored settings; returns the result. */
export function saveMonitorSettings(patch: Partial<MonitorSettings>): MonitorSettings {
  const cur = loadMonitorSettings();
  const next = sanitizeMonitorSettings({
    enabled: patch.enabled !== undefined ? patch.enabled : cur.enabled,
    hours: patch.hours !== undefined ? patch.hours : cur.hours,
    wifiOnly: patch.wifiOnly !== undefined ? patch.wifiOnly : cur.wifiOnly,
    episodes: patch.episodes !== undefined ? patch.episodes : cur.episodes,
  });
  saveJson(MONITOR_KEY, next);
  return next;
}

/** Outcome of a notification button («Добавить» / «Заменить») run by the background page. */
export interface MonitorActionResult {
  ok: boolean;
  /** «Добавлено на сервер», «Заменено» or the error (Russian). */
  message: string;
  /** Title of the release. */
  title?: string;
}

/** Summary of one background run (the page hands it to Android and keeps it in LAST_RUN_KEY). */
export interface MonitorSummary {
  /** Unix ms of the start. */
  at: number;
  kind: 'check' | 'action';
  /** New findings (subscriptions + new episodes). */
  found: number;
  /** Notifications shown. */
  notified: number;
  /** Sources that answered / were asked (subscriptions). */
  answered: number;
  asked: number;
  /** Subscriptions checked / skipped for lack of time. */
  subs: number;
  skipped: number;
  /** The «Новое» feed was refreshed. */
  feed: boolean;
  /** Some notifications could not be shown (notifications off or not permitted). */
  notifyBlocked?: boolean;
  /** Why part of the run failed (Russian), e.g. «Сервер недоступен» for the new episodes. */
  error?: string;
  action?: MonitorActionResult;
}

function num(v: unknown): number {
  return typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0;
}

export function sanitizeSummary(v: unknown): MonitorSummary | null {
  if (!isObject(v) || typeof v.at !== 'number' || !isFinite(v.at)) return null;
  const s: MonitorSummary = {
    at: v.at,
    kind: v.kind === 'action' ? 'action' : 'check',
    found: num(v.found),
    notified: num(v.notified),
    answered: num(v.answered),
    asked: num(v.asked),
    subs: num(v.subs),
    skipped: num(v.skipped),
    feed: v.feed === true,
  };
  if (v.notifyBlocked === true) s.notifyBlocked = true;
  if (typeof v.error === 'string' && v.error) s.error = v.error;
  if (isObject(v.action) && typeof v.action.message === 'string') {
    s.action = { ok: v.action.ok === true, message: v.action.message };
    if (typeof v.action.title === 'string' && v.action.title) s.action.title = v.action.title;
  }
  return s;
}

/** The last background check (actions are not kept here). */
export function loadLastRun(): MonitorSummary | null {
  return sanitizeSummary(loadJson<unknown>(LAST_RUN_KEY, null));
}

export function saveLastRun(s: MonitorSummary): void {
  saveJson(LAST_RUN_KEY, s);
}

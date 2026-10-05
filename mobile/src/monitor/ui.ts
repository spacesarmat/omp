// Monitoring glue of the phone app: a version signal that makes screens re-read the monitor stores (the background page
// writes the same localStorage keys), the bell badge, the WorkManager schedule, the notification permission prompt and
// links from notifications (omp:news?sub=…&finding=…[&watch=1]).
import { signal } from '@preact/signals';
import { t } from '../../../src/i18n';
import { useEffect, useState } from 'preact/hooks';
import { monitorNative, type MonitorStatus } from './native';
import { switchTab, navigate } from '../nav';
import { showToast } from '../ui/toast';
import { activeServer } from '../../../src/store/servers';
import { loadJson, saveJson } from '../../../src/store/storage';
import { getSubscription, unseenCount } from '../../../src/monitor/subs';
import { loadLastRun, loadMonitorSettings, type MonitorSettings, type MonitorSummary } from '../../../src/monitor/settings';
import { BETTER_ID, EPISODES_ID } from '../../../src/monitor/types';

/** Bumped whenever the monitor stores may have changed (a background run, an edit, the app back in front). */
export const monitorVersion = signal(0);

export function reloadMonitor(): void {
  monitorVersion.value = monitorVersion.value + 1;
}

/** Bumped when a background run finishes (monitorDone): ends «Проверяю…». */
export const monitorDoneCount = signal(0);

/**
 * A background run finished: the stores are re-read. «Проверяю…» ends only with the summary of a check (or when the
 * run gave none): a notification-button run finishing says nothing about a check queued behind it.
 */
export function monitorFinished(summary?: MonitorSummary | null): void {
  if (!summary || summary.kind === 'check') monitorDoneCount.value = monitorDoneCount.value + 1;
  reloadMonitor();
}

/** The bell badge: findings not looked at yet (subscriptions + new episodes). Re-read on monitorVersion. */
export function newsBadge(): number {
  void monitorVersion.value;
  return unseenCount();
}

/** Schedules (or cancels) the periodic check with the given settings; harmless when repeated. */
export function applySchedule(s: MonitorSettings = loadMonitorSettings()): Promise<void> {
  if (!monitorNative.available) return Promise.resolve();
  return monitorNative.schedule({ enabled: s.enabled, hours: s.hours, wifiOnly: s.wifiOnly }).catch(() => {});
}

const ASKED_KEY = 'tsp.monitorNotifyAsked';
const BLOCKED_KEY = 'tsp.monitorNotifyHint';
const isBool = (v: unknown) => typeof v === 'boolean';

/**
 * The system notification dialog, once: when monitoring is first switched on or the first subscription is created.
 * Nothing happens when the permission is already decided.
 */
// app start and the first «Новое» visit may both ask at once: one request at a time
let asking: Promise<void> | null = null;

export function askNotifyOnce(): Promise<void> {
  if (asking) return asking;
  asking = (async () => {
    if (!monitorNative.available || loadJson<boolean>(ASKED_KEY, false, isBool)) return;
    const st = await monitorNative.notifyPermission();
    if (st !== 'prompt') return;
    saveJson(ASKED_KEY, true);
    await monitorNative.requestNotifyPermission();
  })().finally(() => {
    asking = null;
  });
  return asking;
}

/** A background run could not show its notifications: ask (or hint) once. */
export async function notifyBlocked(): Promise<void> {
  if (!monitorNative.available || loadJson<boolean>(BLOCKED_KEY, false, isBool)) return;
  saveJson(BLOCKED_KEY, true);
  const st = await monitorNative.notifyPermission();
  if (st === 'prompt') {
    saveJson(ASKED_KEY, true);
    await monitorNative.requestNotifyPermission();
    return;
  }
  showToast(t('monitor.notifyOff'), 6000);
}

/**
 * App start with monitoring on: a run that could not show its notifications (stored summary) is handled, and the
 * permission is asked once (monitoring is on by default, so its first start counts as switching it on).
 */
export async function startupNotify(): Promise<void> {
  if (!monitorNative.available || !loadMonitorSettings().enabled) return;
  const last = lastCheck(await monitorNative.status());
  if (last && last.notifyBlocked) await notifyBlocked();
  await askNotifyOnce();
}

/** The last finished check: the newer of the page's own record and what Android reports. */
export function lastCheck(status: MonitorStatus | null): MonitorSummary | null {
  const local = loadLastRun();
  const native = status && status.lastSummary && status.lastSummary.kind === 'check' ? status.lastSummary : null;
  if (!local) return native;
  if (!native) return local;
  return native.at > local.at ? native : local;
}

export interface NewsLink {
  sub: string;
  finding?: string;
  watch: boolean;
}

/** `omp:news?sub=<id>&finding=<key>[&watch=1]` → its parts; null for anything else. */
export function parseNewsLink(url: string): NewsLink | null {
  const m = /^omp:news\?(.*)$/.exec(url || '');
  if (!m) return null;
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(m[1]);
  } catch {
    return null;
  }
  const sub = p.get('sub');
  if (!sub) return null;
  const finding = p.get('finding');
  const link: NewsLink = { sub, watch: p.get('watch') === '1' };
  if (finding) link.finding = finding;
  return link;
}

/**
 * Opens «Новое» on the finding of a tapped notification. `watch=1` only readies «Смотреть на ТВ» on that finding: any
 * app can send such a link, so nothing is ever played on the TV without a tap.
 */
export function openNewsLink(url: string): void {
  const l = parseNewsLink(url);
  if (!l || !activeServer.value) return;
  reloadMonitor();
  if (l.sub === EPISODES_ID || l.sub === BETTER_ID) {
    switchTab({ name: 'news', seg: 'subs', finding: l.finding, watch: l.watch });
    return;
  }
  switchTab({ name: 'news', seg: 'subs' });
  if (getSubscription(l.sub)) navigate({ name: 'subFindings', id: l.sub, finding: l.finding, watch: l.watch });
}

/**
 * monitorStatus(), asked again whenever the monitor stores change (and every pollMs ms when set); null until it answers
 * (or outside Android).
 */
export function useMonitorStatus(pollMs = 0): MonitorStatus | null {
  const [st, setSt] = useState<MonitorStatus | null>(null);
  const v = monitorVersion.value;
  useEffect(() => {
    let alive = true;
    const ask = () =>
      monitorNative.status().then(
        (s) => alive && setSt(s),
        () => {},
      );
    void ask();
    const t = pollMs > 0 ? setInterval(() => void ask(), pollMs) : undefined;
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [v, pollMs]);
  return st;
}

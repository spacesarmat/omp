import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from './storage';
import { settings } from './settings';
import { request } from '../api/http';
import { compareVersions } from '../lib/version';
import { UpdateInfo, sanitizeUpdateInfo, updateFeedUrl } from '../lib/updateInfo';
import { platformKind } from '../platform/env';
import { APP_VERSION } from '../version';

const KEY = 'tsp.update';
/** The least time between automatic checks when OMP comes back to the screen; a launch always checks. */
export const CHECK_INTERVAL_MS = 60 * 60 * 1000;

interface UpdateState {
  lastCheck: number;
  skipped?: string;
}

export function sanitizeUpdateState(v: unknown): UpdateState {
  const out: UpdateState = { lastCheck: 0 };
  if (!isObject(v)) return out;
  if (typeof v.lastCheck === 'number' && isFinite(v.lastCheck)) out.lastCheck = v.lastCheck;
  if (typeof v.skipped === 'string' && v.skipped) out.skipped = v.skipped;
  return out;
}

let state: UpdateState = sanitizeUpdateState(loadJson<unknown>(KEY, {}, isObject));

/** Newest version found on the feed (newer than the installed one). */
export const latestUpdate = signal<UpdateInfo | null>(null);
/** Version the update dialog should show right now. */
export const updatePrompt = signal<UpdateInfo | null>(null);

export function reloadUpdateState(): void {
  state = sanitizeUpdateState(loadJson<unknown>(KEY, {}, isObject));
  latestUpdate.value = null;
  updatePrompt.value = null;
}

export type CheckResult = 'update' | 'latest' | 'error' | 'skipped';

export function checkForUpdate(opts: { manual: boolean; now?: number; current?: string; url?: string; minIntervalMs?: number }): Promise<CheckResult> {
  const now = opts.now === undefined ? Date.now() : opts.now;
  const current = opts.current === undefined ? APP_VERSION : opts.current;
  const gap = opts.minIntervalMs === undefined ? CHECK_INTERVAL_MS : opts.minIntervalMs;
  if (!opts.manual && (!settings.value.updateCheck || (state.lastCheck <= now && now - state.lastCheck < gap))) {
    return Promise.resolve<CheckResult>('skipped');
  }
  // cache-buster: GitHub raw and the WebView keep the feed for up to 5 minutes after a release
  // Android TV installs the APK (update-android.json), webOS the ipk (update.json)
  // the beta feed with «Получать бета-версии»; without it a beta waits for a release newer than itself
  const url = opts.url || updateFeedUrl(platformKind() === 'androidtv', settings.value.betaUpdates);
  return request<unknown>(url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + now, { timeoutMs: 10000, quiet: true }).then(
    (raw): CheckResult => {
      state = { ...state, lastCheck: now };
      saveJson(KEY, state);
      const info = sanitizeUpdateInfo(raw);
      if (!info || compareVersions(info.version, current) <= 0) {
        latestUpdate.value = null;
        return 'latest';
      }
      latestUpdate.value = info;
      if (opts.manual || info.version !== state.skipped) updatePrompt.value = info;
      return 'update';
    },
    (): CheckResult => 'error',
  );
}

/**
 * The automatic check: at once (a launch always asks the feed), then each time OMP comes back to the screen, at most
 * once per CHECK_INTERVAL_MS (Android keeps the app in memory, so a «launch» is often a return). Returns the cleanup.
 */
export function installUpdateChecks(run: (minIntervalMs: number) => void, delayMs = 3000): () => void {
  const timer = setTimeout(() => run(0), delayMs);
  const onShow = () => {
    if (!document.hidden) run(CHECK_INTERVAL_MS);
  };
  document.addEventListener('visibilitychange', onShow);
  return () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onShow);
  };
}

export function skipVersion(version: string): void {
  state = { ...state, skipped: version };
  saveJson(KEY, state);
  updatePrompt.value = null;
}

export function dismissPrompt(): void {
  updatePrompt.value = null;
}

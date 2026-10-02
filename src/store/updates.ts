import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from './storage';
import { settings } from './settings';
import { request } from '../api/http';
import { compareVersions } from '../lib/version';
import { UpdateInfo, sanitizeUpdateInfo, UPDATE_URL, ANDROID_UPDATE_URL } from '../lib/updateInfo';
import { platformKind } from '../platform/env';
import { APP_VERSION } from '../version';

const KEY = 'tsp.update';
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

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

export function checkForUpdate(opts: { manual: boolean; now?: number; current?: string; url?: string }): Promise<CheckResult> {
  const now = opts.now === undefined ? Date.now() : opts.now;
  const current = opts.current === undefined ? APP_VERSION : opts.current;
  if (!opts.manual && (!settings.value.updateCheck || (state.lastCheck <= now && now - state.lastCheck < CHECK_INTERVAL_MS))) {
    return Promise.resolve<CheckResult>('skipped');
  }
  // cache-buster: GitHub raw and the WebView keep the feed for up to 5 minutes after a release
  // Android TV installs the APK (update-android.json), webOS the ipk (update.json)
  const url = opts.url || (platformKind() === 'androidtv' ? ANDROID_UPDATE_URL : UPDATE_URL);
  return request<unknown>(url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + now, { timeoutMs: 10000 }).then(
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

export function skipVersion(version: string): void {
  state = { ...state, skipped: version };
  saveJson(KEY, state);
  updatePrompt.value = null;
}

export function dismissPrompt(): void {
  updatePrompt.value = null;
}

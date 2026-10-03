import { request } from '../../../src/api/http';
import { compareVersions } from '../../../src/lib/version';
import { sanitizeUpdateInfo, UPDATE_URL, ANDROID_UPDATE_URL } from '../../../src/lib/updateInfo';
import { launchOnTv, ompVersionOnTv, tvKind } from './tvClient';
import type { TvKind } from './tvStore';

/** First TV build that opens its update screen from the `open: 'update'` launch param. */
export const OPEN_UPDATE_MIN = '0.11.4';

export interface TvOmp {
  /** OMP version installed on the TV; null when unknown */
  installed: string | null;
  /** newest OMP for this kind of TV; null when the feed is unavailable */
  latest: string | null;
}

export interface TvUpdateDeps {
  installed?: () => Promise<string | null>;
  fetchJson?: (url: string) => Promise<unknown>;
  now?: number;
}

/** Newest OMP for a kind of TV (webOS feed for LG, APK feed for Android TV); null when the feed is unavailable. */
export function latestOmpVersion(kind: TvKind, deps: Pick<TvUpdateDeps, 'fetchJson' | 'now'> = {}): Promise<string | null> {
  const fetchJson = deps.fetchJson || ((url: string) => request<unknown>(url, { timeoutMs: 10000, quiet: true }));
  const feed = kind === 'atv' ? ANDROID_UPDATE_URL : UPDATE_URL;
  // cache-buster: the feed is cached for minutes after a release
  return fetchJson(feed + '?t=' + (deps.now === undefined ? Date.now() : deps.now)).then(
    (raw) => {
      const info = sanitizeUpdateInfo(raw);
      return info ? info.version : null;
    },
    () => null,
  );
}

/** Installed and newest OMP for the connected TV (webOS feed for LG, APK feed for Android TV). */
export function tvOmpVersions(deps: TvUpdateDeps = {}): Promise<TvOmp> {
  const installed = deps.installed || ompVersionOnTv;
  const latest = latestOmpVersion(tvKind(), deps);
  return Promise.all([installed().catch(() => null), latest]).then(([i, l]) => ({ installed: i, latest: l }));
}

export function tvNeedsUpdate(v: TvOmp): boolean {
  return !!v.installed && !!v.latest && compareVersions(v.latest, v.installed) > 0;
}

/** Older TV builds just open OMP: the update is started there by hand. */
export function tvOpensUpdate(installed: string): boolean {
  return compareVersions(installed, OPEN_UPDATE_MIN) >= 0;
}

/** Opens the update screen of OMP on the TV. */
export function openUpdateOnTv(): Promise<void> {
  return launchOnTv({ open: 'update' });
}

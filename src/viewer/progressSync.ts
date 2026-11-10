// Playback position for a signed-in account, so another device can offer «Продолжить с мм:сс».
// No context or no session: the call is skipped and local progress stays as it was.
import { billingGet, billingPost } from '../billing/client';
import { billingSession } from '../billing/session';
import { deviceId } from '../billing/session';
import { withDeviceToken } from '../billing/tokens';
import { nativeSourceHttp } from '../platform/androidNative';
import type { SourceContext } from '../sources/types';
import { episodeProgressKey, progressTitleKey } from './tracks';

export interface RemoteProgress {
  positionSec: number;
  durationSec: number;
  updatedAt: number;
  otherDevice: boolean;
  label: string;
  episodeKey: string;
}

export interface ProgressPush {
  titleKey: string;
  episodeKey: string;
  positionSec: number;
  durationSec: number;
  title: string;
  label: string;
}

let contextOf: () => SourceContext | null = defaultContext;

function defaultContext(): SourceContext | null {
  const http = nativeSourceHttp();
  if (!http) return null;
  return { http: http, client: null };
}

/** The phone passes its source context. Android TV uses the native HTTP client. */
export function setProgressContext(fn: (() => SourceContext | null) | null): void {
  contextOf = fn || defaultContext;
}

export function progressContext(): SourceContext | null {
  return contextOf();
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : 0;
  return isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function parseProgressBody(text: string): RemoteProgress | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as { [k: string]: unknown };
    if (!v || v.error) return null;
    const positionSec = num(v.positionSec);
    if (positionSec <= 0) return null;
    return {
      positionSec: positionSec,
      durationSec: num(v.durationSec),
      updatedAt: num(v.updatedAt),
      otherDevice: v.otherDevice === true,
      label: typeof v.label === 'string' ? v.label : '',
      episodeKey: typeof v.episodeKey === 'string' ? v.episodeKey : '',
    };
  } catch (e) {
    return null;
  }
}

/**
 * Remote position wins when it is another device and it is clearly further along.
 * The same device, or a remote that is behind, keeps the local second.
 */
export function pickContinue(localSec: number, remote: RemoteProgress | null): number {
  const local = localSec > 0 ? localSec : 0;
  if (!remote || !remote.otherDevice) return local;
  if (remote.positionSec < 15) return local;
  if (remote.positionSec > local + 10) return remote.positionSec;
  return local;
}

export function fetchProgress(titleKey: string, episodeKey: string): Promise<RemoteProgress | null> {
  const ctx = progressContext();
  if (!ctx || !billingSession() || !titleKey) return Promise.resolve(null);
  const q = '/v1/progress?titleKey=' + encodeURIComponent(titleKey) + '&episodeKey=' + encodeURIComponent(episodeKey || '');
  return withDeviceToken(ctx, (headers) => billingGet(ctx, q, { headers: headers, timeoutMs: 8000 })).then(
    (res) => (res.status >= 200 && res.status < 300 ? parseProgressBody(res.text) : null),
    () => null,
  );
}

export function pushProgress(row: ProgressPush): void {
  const ctx = progressContext();
  if (!ctx || !billingSession() || !row.titleKey || !row.episodeKey) return;
  if (!(row.positionSec >= 0)) return;
  const body: { [k: string]: string } = {
    titleKey: row.titleKey,
    episodeKey: row.episodeKey,
    positionSec: String(Math.floor(row.positionSec)),
    durationSec: String(Math.floor(row.durationSec > 0 ? row.durationSec : 0)),
    title: (row.title || '').slice(0, 180),
    label: (row.label || '').slice(0, 80),
    deviceId: deviceId(),
  };
  withDeviceToken(ctx, (headers) => billingPost(ctx, '/v1/progress', body, { headers: headers, timeoutMs: 8000 })).then(
    () => undefined,
    () => undefined,
  );
}

export function progressIdentity(title: string, path: string, film: boolean): { titleKey: string; episodeKey: string } {
  return { titleKey: progressTitleKey(title), episodeKey: episodeProgressKey(path, film) };
}

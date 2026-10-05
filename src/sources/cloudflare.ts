// What a Cloudflare check on a site request ended with, as the native http reports it (android/.../sources/SiteHttp.kt):
// a pass comes back as { cloudflare: 'browser' | 'flaresolverr' } on the answer, a failure as a rejection with the code
// 'cloudflare' or 'cloudflare-interactive' (the background monitor page gets the message only, so the messages are
// matched too). Log lines name the site, never an address or a cookie. Chromium 53 safe (no Error subclasses).
import { t } from '../i18n';
import { ru } from '../i18n/ru';
import { log } from '../lib/log';

export type CloudflareKind = 'cloudflare' | 'cloudflare-interactive';

/** What the person sees (the current language). */
export const cfFailed = (): string => t('cloudflare.failed');
export const cfInteractive = (): string => t('cloudflare.interactive');

// The messages of the native http (android/.../sources/SiteHttp.kt CF_FAILED / CF_INTERACTIVE) are Russian until the
// Kotlin side is localized; they are matched, never shown. The code is matched first.
const NATIVE_CF_FAILED = ru.cloudflare.failed;
const NATIVE_CF_INTERACTIVE = ru.cloudflare.interactive;

/** The message is a Cloudflare 'interactive' one: the native text or the shown one (any language the person had). */
export function isCfInteractiveMessage(m: unknown): boolean {
  return m === NATIVE_CF_INTERACTIVE || m === cfInteractive();
}

function isCfFailedMessage(m: unknown): boolean {
  return m === NATIVE_CF_FAILED || m === cfFailed();
}

/** A failed site request because of Cloudflare: `code` is the kind, `siteUrl` the site root to open a visible check on. */
export interface CloudflareError extends Error {
  code: CloudflareKind;
  siteUrl: string;
}

/** scheme://host[:port]/ of an address ('' when it is not one). */
export function siteRoot(url: string): string {
  const m = /^(https?:\/\/)(?:[^/?#@]*@)?([^/?#]+)/i.exec(url || '');
  return m ? m[1].toLowerCase() + m[2].toLowerCase() + '/' : '';
}

/** Host of an address, the fallback site name of a log line. */
export function hostOf(url: string): string {
  const m = /^https?:\/\/(?:[^/?#@]*@)?([^/?#:]+)/i.exec(url || '');
  return m ? m[1].toLowerCase() : '';
}

function kindOf(e: unknown): CloudflareKind | null {
  if (!e || typeof e !== 'object') return null;
  const o = e as { code?: unknown; message?: unknown };
  if (o.code === 'cloudflare' || o.code === 'cloudflare-interactive') return o.code;
  if (isCfInteractiveMessage(o.message)) return 'cloudflare-interactive';
  if (isCfFailedMessage(o.message)) return 'cloudflare';
  return null;
}

/** The rejection of a native request to `url` as a [CloudflareError], null when it is another failure. */
export function toCloudflareError(e: unknown, url: string): CloudflareError | null {
  const kind = kindOf(e);
  if (!kind) return null;
  const err = new Error(kind === 'cloudflare-interactive' ? cfInteractive() : cfFailed()) as CloudflareError;
  err.code = kind;
  err.siteUrl = siteRoot(url);
  return err;
}

/** The error is a Cloudflare failure of the native http: { kind, siteUrl } or null. */
export function cloudflareFailure(e: unknown): { kind: CloudflareKind; siteUrl: string } | null {
  const kind = kindOf(e);
  if (!kind) return null;
  const u = (e as { siteUrl?: unknown }).siteUrl;
  return { kind, siteUrl: typeof u === 'string' ? u : '' };
}

/** Log line of a check: passed (info), needs a tick / failed (warn). Site name only. */
export function logCloudflare(result: 'passed' | CloudflareKind, site: string): void {
  const name = site ? ' · ' + site : '';
  if (result === 'passed') log('info', 'search', t('cloudflare.logPassed') + name);
  else log('warn', 'search', t(result === 'cloudflare-interactive' ? 'cloudflare.logInteractive' : 'cloudflare.logFailed') + name);
}

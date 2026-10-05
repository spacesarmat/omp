// The visible Cloudflare check (spec §3): when a site whose «Обходить проверку Cloudflare» is on answers with a check
// that needs a person (code 'cloudflare-interactive'), the platform's checker shows the site — a sheet on the phone
// («Подтвердите, что вы не робот»), a dialog under the remote on Android TV with «Пройти на телефоне» — and the search
// is run again once it is passed. The cookies never reach the page: the native side stores them (or, for the TV, the
// phone sends them to the TV over the pairing channel). All the Russian copy of the check lives here; the native dialog
// gets it as parameters. Shared by the phone and the TV bundles: Chromium 53 rules, no platform imports.
import { t } from '../i18n';
import { log } from '../lib/log';
import { cloudflareFailure, hostOf, logCloudflare, siteRoot } from './cloudflare';
import { allSources, getSource } from './registry';
import { isCloudflareBypassOn } from './store';
import type { Source } from './types';

// ---- copy (mockups PhoneCloudflare, TvCloudflare, PhoneSite, Main) ----

export const sheetTitle = (): string => t('cloudflare.sheetTitle');
export const sheetNoteTv = (): string => t('cloudflare.sheetNoteTv');
export const cancelText = (): string => t('cloudflare.cancel');
export const tvText = (): string => t('cloudflare.tvText');
export const tvPhone = (): string => t('cloudflare.tvPhone');
export const tvRemote = (): string => t('cloudflare.tvRemote');
/** The text keeps `%s` = the phone's name (the native dialog fills it in). */
export const tvHint = (): string => t('cloudflare.tvHint');
export const tvWaiting = (): string => t('cloudflare.tvWaiting');
/** No phone is paired with the TV. */
export const noPhone = (): string => t('cloudflare.noPhone');
/** A phone is paired, but OMP is not open on it (or it cannot show the request). */
export const phoneClosed = (): string => t('cloudflare.phoneClosed');
/** Another Cloudflare check holds the page: the dialog waits for it. */
export const gateWait = (): string => t('cloudflare.gateWait');
/** By the native relay outcome (a code, never a text): what the TV dialog says when the phone did not pass the check. */
export const tvErrors = (): { [outcome: string]: string } => ({
  NOT_TAKEN: t('cloudflare.tvErrors.notTaken'),
  TIMEOUT: t('cloudflare.tvErrors.timeout'),
  CANCELLED: t('cloudflare.tvErrors.cancelled'),
  FAILED: t('cloudflare.tvErrors.failed'),
  STORE_FAILED: t('cloudflare.tvErrors.storeFailed'),
  BUSY: t('cloudflare.tvErrors.busy'),
  UNAVAILABLE: phoneClosed(),
});
/** The phone's notification when the app is in the background (the text keeps `%s` = the site). */
export const watchNotify = (): string => t('cloudflare.watchNotify');
export const sentToTv = (): string => t('cloudflare.sentToTv');
export const notSentToTv = (): string => t('cloudflare.notSentToTv');
export const checkBusy = (): string => t('cloudflare.checkBusy');
export const checkFailed = (): string => t('cloudflare.checkFailed');

export const bypassLabel = (): string => t('cloudflare.bypassLabel');
export const bypassWarning = (): string => t('cloudflare.bypassWarning');

/** «Сайт rustorka просит пройти проверку Cloudflare.» + «Это нужно для телевизора «Гостиная».» when the TV asked. */
export function sheetText(site: string, tv?: string): string {
  return t('cloudflare.sheetText', { site }) + (tv ? ' ' + t('cloudflare.forTv', { tv }) : '');
}

/** «rustorka: проверка Cloudflare». */
export function tvTitle(site: string): string {
  return t('cloudflare.tvTitle', { site });
}

function two(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

/** «проверка пройдена · действует до 22:40» while the clearance lasts, null otherwise. */
export function clearanceText(until: number | null | undefined, now: number = Date.now()): string | null {
  if (typeof until !== 'number' || !isFinite(until) || until <= now) return null;
  const d = new Date(until);
  return t('cloudflare.clearance', { time: two(d.getHours()) + ':' + two(d.getMinutes()) });
}

export interface SiteNote {
  text: string;
  tone: 'ok' | 'warn' | 'muted';
}

/**
 * The note of a Cloudflare site on the Android TV «Источники поиска» (mockup Main): off, a check that needs a person,
 * the clearance time, or just «обход Cloudflare».
 */
export function tvSiteNote(bypass: boolean, needsCheck: boolean, until: number | null, now: number = Date.now()): SiteNote {
  if (!bypass) return { text: t('sources.state.off'), tone: 'muted' };
  if (needsCheck) return { text: t('cloudflare.noteNeedsCheck'), tone: 'warn' };
  const c = clearanceText(until, now);
  return { text: c ? t('cloudflare.noteBypassUntil', { until: c }) : t('cloudflare.noteBypass'), tone: 'ok' };
}

/** Arguments of OmpNative.cloudflareVisible (phone and TV). */
export interface CloudflareVisibleRequest {
  url: string;
  site: string;
  mode: 'phone' | 'tv';
  title: string;
  text: string;
  cancel: string;
  note?: string;
  phone?: string;
  remote?: string;
  hint?: string;
  noPhone?: string;
  phoneClosed?: string;
  gateWait?: string;
  waiting?: string;
  errors?: { [outcome: string]: string };
  /** Phone: the id of the TV's waiting request (the native side takes the address from it). */
  forTv?: string;
}

/** The TV dialog (mockup TvCloudflare) for the site. */
export function tvCheckRequest(site: { name: string; url: string }): CloudflareVisibleRequest {
  return {
    url: site.url,
    site: site.name,
    mode: 'tv',
    title: tvTitle(site.name),
    text: tvText(),
    cancel: cancelText(),
    phone: tvPhone(),
    remote: tvRemote(),
    hint: tvHint(),
    noPhone: noPhone(),
    phoneClosed: phoneClosed(),
    waiting: tvWaiting(),
    gateWait: gateWait(),
    errors: tvErrors(),
  };
}

/** The phone sheet (mockup PhoneCloudflare); with forTv the TV «tv» asked for it and gets the result. */
export function phoneCheckRequest(site: { name: string; url: string }, forTv?: { id: string; tv: string }): CloudflareVisibleRequest {
  const r: CloudflareVisibleRequest = {
    url: site.url,
    site: site.name,
    mode: 'phone',
    title: sheetTitle(),
    text: sheetText(site.name, forTv ? forTv.tv : undefined),
    cancel: cancelText(),
    gateWait: gateWait(),
  };
  if (forTv) {
    r.note = sheetNoteTv();
    r.forTv = forTv.id;
  }
  return r;
}

/** The native answer as a CheckResult (anything unknown is a failure). */
export function checkResultOf(r: unknown): CheckResult {
  const x = r && typeof r === 'object' ? (r as { result?: unknown }).result : undefined;
  return x === 'solved' || x === 'cancelled' || x === 'busy' ? x : 'failed';
}

// ---- the checker of the platform ----

/** solved: passed (cookies stored natively); cancelled: closed; busy: another WebView check runs; failed: not opened. */
export type CheckResult = 'solved' | 'cancelled' | 'busy' | 'failed';

export type CloudflareChecker = (site: { name: string; url: string }) => Promise<CheckResult>;

let checker: CloudflareChecker | null = null;
let running: Promise<CheckResult> | null = null;
let runningHost = '';

/** The phone and the Android TV register theirs; null removes it (LG has none). */
export function setCloudflareChecker(c: CloudflareChecker | null): void {
  checker = c;
}

export function hasCloudflareChecker(): boolean {
  return !!checker;
}

/**
 * Shows the visible check of the site at `url` (its root). One at a time: a second request for the same host joins the
 * open one, another host waits for it to close. Logged with the site name only.
 */
export function runCloudflareCheck(name: string, url: string): Promise<CheckResult> {
  const root = siteRoot(url);
  const c = checker;
  if (!c || !root) return Promise.resolve('failed' as CheckResult);
  const host = hostOf(root);
  if (running && runningHost === host) return running;
  const before: Promise<unknown> = running || Promise.resolve();
  const p: Promise<CheckResult> = before
    .then(
      () => undefined,
      () => undefined,
    )
    .then(() => {
      runningHost = host;
      let r: Promise<CheckResult>;
      try {
        r = Promise.resolve(c({ name, url: root }));
      } catch (e) {
        r = Promise.resolve('failed' as CheckResult);
      }
      return r.then(
        (x) => (x === 'solved' || x === 'cancelled' || x === 'busy' ? x : 'failed') as CheckResult,
        () => 'failed' as CheckResult,
      );
    })
    .then((x) => {
      if (running === p) {
        running = null;
        runningHost = '';
      }
      if (x === 'solved') logCloudflare('passed', name);
      else if (x === 'failed') logCloudflare('cloudflare', name);
      return x;
    });
  running = p;
  runningHost = host;
  return p;
}

/**
 * The site root a failed search of `source` should open a visible check on: the error is 'cloudflare-interactive', the
 * site is behind Cloudflare with its switch on and the platform has a checker. null otherwise.
 */
export function visibleCheckUrl(source: Source | undefined, error: unknown): string | null {
  if (!source || !checker || !isCloudflareBypassOn(source)) return null;
  const f = cloudflareFailure(error);
  if (!f || f.kind !== 'cloudflare-interactive') return null;
  return siteRoot(f.siteUrl || source.siteUrl || '') || null;
}

/** Hosts already checked during one search (and the searches it retried): a check is never offered twice in a row. */
export interface CheckedHosts {
  [host: string]: true;
}

/**
 * A search's onDone: a source that failed with a check needing a person opens the visible check (once per host per
 * search); `retry` runs the search again when it is passed. Returns true when a check was opened.
 */
export function onSearchFailure(sourceId: string, error: unknown, asked: CheckedHosts, retry: () => void): boolean {
  const source = getSource(sourceId);
  const url = visibleCheckUrl(source, error);
  if (!url || !source) return false;
  const host = hostOf(url);
  if (asked[host]) return false;
  asked[host] = true;
  runCloudflareCheck(source.name, url).then(
    (r) => {
      if (r === 'solved') retry();
    },
    () => log('warn', 'search', t('cloudflare.logNotOpened')),
  );
  return true;
}

/** A site behind Cloudflare has its switch on (the phone then listens to the TV for «Пройти на телефоне»). */
export function anyBypassOn(list: Source[] = allSources()): boolean {
  return list.some((s) => isCloudflareBypassOn(s));
}

/**
 * The source a TV request may open a check for: a registered site behind Cloudflare with its switch on whose siteUrl
 * has exactly the request's scheme, host and port. null for anything else (the phone never opens another page in its trusted sheet).
 */
export function tvRequestSource(url: string, list: Source[] = allSources()): Source | null {
  const host = hostOf(url);
  if (!host || siteRoot(url) !== url) return null;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!isCloudflareBypassOn(s)) continue;
    const roots = (s.siteUrls || []).concat(s.siteUrl ? [s.siteUrl] : []);
    if (roots.some((r) => siteRoot(r) === url)) return s;
  }
  return null;
}

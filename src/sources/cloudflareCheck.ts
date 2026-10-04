// The visible Cloudflare check (spec §3): when a site whose «Обходить проверку Cloudflare» is on answers with a check
// that needs a person (code 'cloudflare-interactive'), the platform's checker shows the site — a sheet on the phone
// («Подтвердите, что вы не робот»), a dialog under the remote on Android TV with «Пройти на телефоне» — and the search
// is run again once it is passed. The cookies never reach the page: the native side stores them (or, for the TV, the
// phone sends them to the TV over the pairing channel). All the Russian copy of the check lives here; the native dialog
// gets it as parameters. Shared by the phone and the TV bundles: Chromium 53 rules, no platform imports.
import { log } from '../lib/log';
import { cloudflareFailure, hostOf, logCloudflare, siteRoot } from './cloudflare';
import { allSources, getSource } from './registry';
import { isCloudflareBypassOn } from './store';
import type { Source } from './types';

// ---- copy (mockups PhoneCloudflare, TvCloudflare, PhoneSite, Main) ----

export const SHEET_TITLE = 'Подтвердите, что вы не робот';
export const SHEET_NOTE_TV = 'После проверки OMP сам передаст разрешение на телевизор. Пароли и личные данные не передаются.';
export const CANCEL = 'Отмена';
export const TV_TEXT = 'Сайт просит подтвердить, что вы не робот. Пультом это неудобно — пройдите проверку на телефоне.';
export const TV_PHONE = 'Пройти на телефоне';
export const TV_REMOTE = 'Отметить пультом';
/** %s = the phone's name (the native dialog fills it in). */
export const TV_HINT = 'Телефон «%s» получит запрос';
export const TV_WAITING = 'Пройдите проверку на телефоне «%s»';
/** No phone is paired with the TV. */
export const NO_PHONE = 'Подключите телефон к телевизору';
/** A phone is paired, but OMP is not open on it (or it cannot show the request). */
export const PHONE_CLOSED = 'Откройте OMP на телефоне';
/** Another Cloudflare check holds the page: the dialog waits for it. */
export const GATE_WAIT = 'Ждём, пока закончится другая проверка…';
/** By the native relay outcome: what the TV dialog says when the phone did not pass the check. */
export const TV_ERRORS: { [outcome: string]: string } = {
  NOT_TAKEN: 'Телефон не ответил — откройте OMP на телефоне',
  TIMEOUT: 'Телефон не прислал ответ вовремя — попробуйте ещё раз',
  CANCELLED: 'Проверку на телефоне отменили',
  FAILED: 'На телефоне проверку пройти не удалось',
  STORE_FAILED: 'Телевизор не смог сохранить разрешение: защищённое хранилище недоступно',
  BUSY: 'Телевизор уже ждёт ответ телефона',
  UNAVAILABLE: PHONE_CLOSED,
};
/** The phone's notification when the app is in the background (%s = the site). */
export const WATCH_NOTIFY = 'Телевизор просит пройти проверку на %s';
export const SENT_TO_TV = 'Разрешение передано на телевизор';
export const NOT_SENT_TO_TV = 'Не удалось передать разрешение на телевизор — попробуйте ещё раз';
export const CHECK_BUSY = 'Уже идёт другая проверка Cloudflare — попробуйте через минуту';
export const CHECK_FAILED = 'Не удалось открыть проверку Cloudflare';

export const BYPASS_LABEL = 'Обходить проверку Cloudflare';
export const BYPASS_WARNING =
  'Обход проверки может нарушать правила сайта. Включайте на свой риск. OMP обращается только к самому сайту и к вашему FlareSolverr.';

/** «Сайт rustorka просит пройти проверку Cloudflare.» + «Это нужно для телевизора «Гостиная».» when the TV asked. */
export function sheetText(site: string, tv?: string): string {
  return 'Сайт ' + site + ' просит пройти проверку Cloudflare.' + (tv ? ' Это нужно для телевизора «' + tv + '».' : '');
}

/** «rustorka: проверка Cloudflare». */
export function tvTitle(site: string): string {
  return site + ': проверка Cloudflare';
}

function two(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

/** «проверка пройдена · действует до 22:40» while the clearance lasts, null otherwise. */
export function clearanceText(until: number | null | undefined, now: number = Date.now()): string | null {
  if (typeof until !== 'number' || !isFinite(until) || until <= now) return null;
  const d = new Date(until);
  return 'проверка пройдена · действует до ' + two(d.getHours()) + ':' + two(d.getMinutes());
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
  if (!bypass) return { text: 'выключен', tone: 'muted' };
  if (needsCheck) return { text: 'нужна проверка — пройдите на телефоне', tone: 'warn' };
  const c = clearanceText(until, now);
  return { text: c ? 'обход Cloudflare · ' + c : 'обход Cloudflare', tone: 'ok' };
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
    text: TV_TEXT,
    cancel: CANCEL,
    phone: TV_PHONE,
    remote: TV_REMOTE,
    hint: TV_HINT,
    noPhone: NO_PHONE,
    phoneClosed: PHONE_CLOSED,
    waiting: TV_WAITING,
    gateWait: GATE_WAIT,
    errors: TV_ERRORS,
  };
}

/** The phone sheet (mockup PhoneCloudflare); with forTv the TV «tv» asked for it and gets the result. */
export function phoneCheckRequest(site: { name: string; url: string }, forTv?: { id: string; tv: string }): CloudflareVisibleRequest {
  const r: CloudflareVisibleRequest = {
    url: site.url,
    site: site.name,
    mode: 'phone',
    title: SHEET_TITLE,
    text: sheetText(site.name, forTv ? forTv.tv : undefined),
    cancel: CANCEL,
    gateWait: GATE_WAIT,
  };
  if (forTv) {
    r.note = SHEET_NOTE_TV;
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
    () => log('warn', 'search', 'Cloudflare: проверка не открылась'),
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

// «Войти через браузер» (Task 9b): the person signs in to a site in a visible page themselves (any captcha too) — a
// native sheet on the phone, a dialog under the remote on Android TV with «Войти на телефоне». The native side reads
// the site's cookies, checks them with its own request (the site's check page must be a signed-in one) and keeps them
// as the site's session in the encrypted jar; the page never sees a cookie or the password. A site signed in this way
// has no saved password: its `<id>.browser` marker says «вход выполнен в браузере», «Выйти» forgets the session.
// The platforms register their way of showing the page (mobile/src/browserLogin.ts, src/sources/cloudflareTv.ts);
// LG has none. All the Russian copy lives here. Shared by the phone and the TV bundles: Chromium 53 rules, no platform imports.
import { t } from '../i18n';
import { cloudflareFailure } from './cloudflare';
import { rutrackerCaptcha } from './rutrackerText';
import { siteLoginCode, siteLoginKeys } from './siteLoginText';
import type { SecretStore, SourceContext } from './types';

// ---- copy ----

export const browserLoginText = (): string => t('sources.browser.login');
export const browserHint = (): string => t('sources.browser.hint');
/** While the native side checks the sign-in. */
export const browserChecking = (): string => t('sources.browser.checking');
/** The sign-in did not open the site signed in. */
export const browserNotConfirmed = (): string => t('sources.browser.notConfirmed');
export const browserRetry = (): string => t('sources.browser.retry');
/** Shown under a form login that hit a captcha. */
export const browserCaptcha = (): string => t('sources.browser.captcha');
/** Shown under a form login that Cloudflare stopped (the browser page passes the check itself). */
export const browserCloudflare = (): string => t('sources.browser.cloudflare');
/** The state of a site signed in through the browser. */
export const browserDone = (): string => t('sources.browser.done');
export const browserDoneTitle = (): string => t('sources.browser.doneTitle');
export const browserCancel = (): string => t('common.cancel');
export const loginOnPhone = (): string => t('sources.browser.loginOnPhone');
export const loginByRemote = (): string => t('sources.browser.loginByRemote');
export const browserTvText = (): string => t('sources.browser.tvText');
/** The text keeps `%s` = the phone's name (the native dialog fills it in). */
export const browserTvHint = (): string => t('sources.browser.tvHint');
export const browserTvWaiting = (): string => t('sources.browser.tvWaiting');
export const browserNoPhone = (): string => t('sources.browser.noPhone');
/** The phone listens to the TV only on «Источники поиска» (or with a Cloudflare switch on): where to open it. */
export const browserPhoneClosed = (): string => t('sources.browser.phoneClosed');
/** The login page tried to leave the site. */
export const browserBlocked = (): string => t('sources.browser.blocked');
export const browserGateWait = (): string => t('sources.browser.gateWait');
/** By the native relay outcome (a code, never a text): what the TV dialog says when the phone did not sign in. */
export const browserTvErrors = (): { [outcome: string]: string } => ({
  NOT_TAKEN: t('sources.browser.tvErrors.notTaken'),
  TIMEOUT: t('sources.browser.tvErrors.timeout'),
  CANCELLED: t('sources.browser.tvErrors.cancelled'),
  FAILED: t('sources.browser.tvErrors.failed'),
  STORE_FAILED: t('sources.browser.tvErrors.storeFailed'),
  BUSY: t('sources.browser.tvErrors.busy'),
  UNAVAILABLE: browserPhoneClosed(),
  UNVERIFIED: t('sources.browser.tvErrors.unverified'),
});
export const browserNoteTv = (): string => t('sources.browser.noteTv');
/** The phone's notification when the TV asks for a sign-in (the text keeps `%s` = the site). */
export const watchNotifyLogin = (): string => t('sources.browser.watchNotify');
export const browserFailed = (): string => t('sources.browser.failed');
export const browserBusy = (): string => t('sources.browser.busy');
/** Signed in, but the encrypted storage refused the session: nothing is kept. */
export const browserStoreFailed = (): string => t('sources.browser.storeFailed');
export const browserSentTv = (): string => t('sources.browser.sentTv');
export const browserNotSentTv = (): string => t('sources.browser.notSentTv');

/** «Вход в rutracker выполнен». */
export function browserSignedIn(site: string): string {
  return t('sources.browser.signedIn', { site });
}

/** «Вход на Kinozal» (the sheet's title). */
export function browserTitle(site: string): string {
  return t('common.signInTo', { site });
}

/** «Войдите … Это нужно для телевизора «Гостиная».» when the TV asked. */
export function browserText(tv?: string): string {
  return browserHint() + (tv ? ' ' + t('cloudflare.forTv', { tv }) : '');
}

// ---- the request ----

/** How the native side tells a signed-in session: the check page with the session must have `marker`. */
export interface BrowserCheck {
  /** Page asked to verify the session (relative to the site root). */
  path: string;
  /** Text only a signed-in page has (its logout link). */
  marker: string;
  /** The login page: opened in the browser, and a check that ends there is not signed in. */
  loginPath: string;
  /** Cookie names a signed-in browser has (any of them); omitted = any cookie of the site. */
  cookies?: string[];
}

/** What a site gives the platform: its login page on the active mirror, all its hosts, the check. */
export interface BrowserSpec {
  url: string;
  site: string;
  source: string;
  hosts: string[];
  check: BrowserCheck;
  /** The sheet's own copy instead of the sign-in one (a site's code page: «Ввести код»). */
  title?: string;
  text?: string;
  cancel?: string;
}

/** Arguments of OmpNative.siteBrowserLogin (phone and TV). */
export interface BrowserLoginRequest extends BrowserSpec {
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
  waiting?: string;
  gateWait?: string;
  errors?: { [outcome: string]: string };
  /** Phone: the id of the TV's waiting request (the native side takes the address from it). */
  forTv?: string;
  /** TV: ask the phone right away («Войти на телефоне»). */
  askPhone?: boolean;
  /** The login page tried to leave the site (it is back on the login page). */
  blocked?: string;
  /** While the sign-in is checked; when it is not confirmed; the button that checks again. */
  checking?: string;
  notConfirmed?: string;
  retry?: string;
}

/** The phone sheet; with forTv the TV «tv» asked for it and gets the session. */
export function phoneLoginRequest(spec: BrowserSpec, forTv?: { id: string; tv: string }): BrowserLoginRequest {
  const r: BrowserLoginRequest = {
    url: spec.url,
    site: spec.site,
    source: spec.source,
    hosts: spec.hosts,
    check: spec.check,
    mode: 'phone',
    title: spec.title || browserTitle(spec.site),
    text: spec.text || browserText(forTv ? forTv.tv : undefined),
    cancel: spec.cancel || browserCancel(),
    gateWait: browserGateWait(),
    blocked: browserBlocked(),
    checking: browserChecking(),
    notConfirmed: browserNotConfirmed(),
    retry: browserRetry(),
  };
  if (forTv) {
    r.note = browserNoteTv();
    r.forTv = forTv.id;
  }
  return r;
}

/** The TV dialog: the page under the remote, «Войти на телефоне», «Ввести пультом», «Отмена». */
export function tvLoginRequest(spec: BrowserSpec, askPhone?: boolean): BrowserLoginRequest {
  const r: BrowserLoginRequest = {
    url: spec.url,
    site: spec.site,
    source: spec.source,
    hosts: spec.hosts,
    check: spec.check,
    mode: 'tv',
    title: browserTitle(spec.site),
    text: browserTvText(),
    cancel: browserCancel(),
    phone: loginOnPhone(),
    remote: loginByRemote(),
    hint: browserTvHint(),
    noPhone: browserNoPhone(),
    phoneClosed: browserPhoneClosed(),
    waiting: browserTvWaiting(),
    gateWait: browserGateWait(),
    errors: browserTvErrors(),
    blocked: browserBlocked(),
    checking: browserChecking(),
    notConfirmed: browserNotConfirmed(),
    retry: browserRetry(),
  };
  if (askPhone) r.askPhone = true;
  return r;
}

/**
 * ok: signed in (session kept natively); cancelled: closed; busy: another page is open; failed: not opened;
 * store_failed: signed in, but the encrypted storage refused the session (nothing kept, no marker).
 */
export type BrowserResult = 'ok' | 'cancelled' | 'busy' | 'failed' | 'store_failed';

export interface BrowserOutcome {
  result: BrowserResult;
  /** The host the session is on (a mirror may have answered). */
  host?: string;
  /** 'here' | 'phone' (the TV: the phone signed in). */
  via?: string;
  /** Phone for the TV: the TV took the session. */
  sent?: boolean;
  /** Phone for the TV: the TV closed its dialog meanwhile. */
  done?: boolean;
}

const HOST = /^[a-z0-9.-]{1,253}$/;

/** The native answer as an outcome (anything unknown is a failure). */
export function browserOutcome(r: unknown): BrowserOutcome {
  const o = r && typeof r === 'object' ? (r as { result?: unknown; host?: unknown; via?: unknown; sent?: unknown }) : {};
  if (o.result === 'done') return { result: 'cancelled', done: true };
  const result: BrowserResult =
    o.result === 'ok' || o.result === 'cancelled' || o.result === 'busy' || o.result === 'store_failed' ? o.result : 'failed';
  const out: BrowserOutcome = { result };
  if (typeof o.host === 'string' && HOST.test(o.host)) out.host = o.host;
  if (typeof o.via === 'string') out.via = o.via;
  if (typeof o.sent === 'boolean') out.sent = o.sent;
  return out;
}

// ---- the platform ----

export interface BrowserLoginPlatform {
  /** Shows the page; resolves the outcome (never rejects). */
  login(spec: BrowserSpec, opts?: { askPhone?: boolean }): Promise<BrowserOutcome>;
  /** Android TV: the session the phone sent for the site (staged) opens the check page signed in. */
  pending?(site: string, check: BrowserCheck): Promise<{ ok: boolean; host?: string }>;
  /** Android TV: «Войти на телефоне» is possible (the TV relay). */
  phone?: boolean;
}

let platform: BrowserLoginPlatform | null = null;

/** The phone and the Android TV register theirs; null removes it (LG has none). */
export function setBrowserLoginPlatform(p: BrowserLoginPlatform | null): void {
  platform = p;
}

export function hasBrowserLogin(): boolean {
  return !!platform;
}

/**
 * Shows a site page in the browser sheet without signing in (a site's code page): nothing is marked. Resolves the
 * outcome, 'failed' without a platform; never rejects.
 */
export function openSitePage(spec: BrowserSpec): Promise<BrowserOutcome> {
  const p = platform;
  if (!p) return Promise.resolve({ result: 'failed' } as BrowserOutcome);
  try {
    return p.login(spec).then(browserOutcome, () => ({ result: 'failed' }) as BrowserOutcome);
  } catch (e) {
    return Promise.resolve({ result: 'failed' } as BrowserOutcome);
  }
}

/** The TV can ask the phone to sign in. */
export function canLoginOnPhone(): boolean {
  return !!platform && platform.phone === true;
}

/** A form login was refused with a captcha (the screen then suggests «Войти через браузер»). */
export function isCaptchaError(e: unknown): boolean {
  if (siteLoginCode(e) === 'captcha') return true;
  return e instanceof Error && e.message === rutrackerCaptcha();
}

/**
 * A form login the browser login gets past: a captcha, or a Cloudflare check OMP could not pass on its own (the
 * browser page shows it, the person ticks it). The suggestion shown above «Войти через браузер», '' for anything else.
 */
export function browserSuggestion(e: unknown): string {
  if (isCaptchaError(e)) return browserCaptcha();
  if (cloudflareFailure(e)) return browserCloudflare();
  return '';
}

/** The marker of a site signed in through the browser (Keystore, js: namespace; the TV's transfer writes it natively). */
export function browserKey(id: string): string {
  return id + '.browser';
}

/** What a site tells about its browser login. */
export interface BrowserSite {
  id: string;
  name: string;
  /** All hosts, the active mirror first. */
  hosts(): string[];
  /** https://<active mirror>/ */
  base(): string;
  check: BrowserCheck;
  /** A session that came from another mirror makes it the active one. */
  adopt?(url: string): void;
}

export interface BrowserLogin {
  spec(): BrowserSpec;
  /**
   * Shows the page; on «ok» the site is marked signed in through the browser and its saved password is forgotten (a
   * browser session has none). Rejects only when the marker cannot be written.
   */
  login(ctx: SourceContext, opts?: { askPhone?: boolean }): Promise<BrowserOutcome>;
  /** The current login is a browser session. */
  active(ctx: SourceContext): Promise<boolean>;
  /** Forgets the marker (logout, a form login). */
  forget(secrets: SecretStore | undefined): Promise<void>;
  /**
   * The session is gone (the site answered signed out, no password to sign in again): the marker goes, so the site
   * says «нужен вход» again. Resolves whether there was one.
   */
  expired(secrets: SecretStore | undefined): Promise<boolean>;
  /** Android TV: checks the session the phone sent (staged natively) on `host`; rejects when it is not signed in. */
  pending(ctx: SourceContext, host: string): Promise<void>;
}

export const sessionNotVerified = (): string => t('sources.browser.sessionNotVerified');

export function createBrowserLogin(site: BrowserSite): BrowserLogin {
  const key = browserKey(site.id);
  const keys = siteLoginKeys(site.id);
  const spec = (): BrowserSpec => ({ url: site.base() + site.check.loginPath, site: site.name, source: site.id, hosts: site.hosts(), check: site.check });
  return {
    spec,
    login(ctx, opts) {
      const p = platform;
      if (!p) return Promise.resolve({ result: 'failed' } as BrowserOutcome);
      let run: Promise<BrowserOutcome>;
      try {
        run = p.login(spec(), opts).then(browserOutcome, () => ({ result: 'failed' }) as BrowserOutcome);
      } catch (e) {
        run = Promise.resolve({ result: 'failed' } as BrowserOutcome);
      }
      return run.then((r) => {
        if (r.result !== 'ok') return r;
        if (r.host && site.adopt) site.adopt('https://' + r.host + '/');
        const s = ctx.secrets;
        if (!s) return r;
        return s
          .set(key, '1')
          .then(() => Promise.all([s.delete(keys.user), s.delete(keys.pass)]).then(undefined, () => undefined))
          .then(() => r);
      });
    },
    active(ctx) {
      const s = ctx.secrets;
      if (!s) return Promise.resolve(false);
      return s.get(key).then(
        (v) => v === '1',
        () => false,
      );
    },
    forget(secrets) {
      return secrets ? secrets.delete(key) : Promise.resolve();
    },
    expired(secrets) {
      if (!secrets) return Promise.resolve(false);
      return secrets.get(key).then(
        (v) => (v === '1' ? secrets.delete(key).then(() => true) : false),
        () => false,
      );
    },
    pending(_ctx, host) {
      const p = platform;
      if (!p || !p.pending) return Promise.reject(new Error(sessionNotVerified()));
      if (site.hosts().indexOf(host) < 0) return Promise.reject(new Error(sessionNotVerified()));
      return p.pending(site.id, site.check).then((r) => {
        if (!r || r.ok !== true) throw new Error(sessionNotVerified());
        if (r.host && site.adopt) site.adopt('https://' + r.host + '/');
      });
    },
  };
}

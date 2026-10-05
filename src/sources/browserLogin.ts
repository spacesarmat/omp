// «Войти через браузер» (Task 9b): the person signs in to a site in a visible page themselves (any captcha too) — a
// native sheet on the phone, a dialog under the remote on Android TV with «Войти на телефоне». The native side reads
// the site's cookies, checks them with its own request (the site's check page must be a signed-in one) and keeps them
// as the site's session in the encrypted jar; the page never sees a cookie or the password. A site signed in this way
// has no saved password: its `<id>.browser` marker says «вход выполнен в браузере», «Выйти» forgets the session.
// The platforms register their way of showing the page (mobile/src/browserLogin.ts, src/sources/cloudflareTv.ts);
// LG has none. All the Russian copy lives here. Shared by the phone and the TV bundles: Chromium 53 rules, no platform imports.
import { RUTRACKER_CAPTCHA } from './rutrackerText';
import { siteLoginCode, siteLoginKeys } from './siteLoginText';
import type { SecretStore, SourceContext } from './types';

// ---- copy ----

export const BROWSER_LOGIN = 'Войти через браузер';
export const BROWSER_HINT = 'Войдите как обычно — OMP сохранит вход. Пароль OMP не видит.';
/** Shown under a form login that hit a captcha. */
export const BROWSER_CAPTCHA = 'Сайт просит капчу — войдите через браузер';
/** The state of a site signed in through the browser. */
export const BROWSER_DONE = 'вход выполнен в браузере';
export const BROWSER_DONE_TITLE = 'Вход выполнен в браузере';
export const BROWSER_CANCEL = 'Отмена';
export const LOGIN_ON_PHONE = 'Войти на телефоне';
export const LOGIN_BY_REMOTE = 'Ввести пультом';
export const BROWSER_TV_TEXT = 'Войдите на сайт как обычно. Пультом это неудобно — войдите на телефоне, OMP передаст вход сюда.';
/** %s = the phone's name (the native dialog fills it in). */
export const BROWSER_TV_HINT = 'Телефон «%s» получит запрос';
export const BROWSER_TV_WAITING = 'Войдите на телефоне «%s»';
export const BROWSER_NO_PHONE = 'Подключите телефон к телевизору';
export const BROWSER_PHONE_CLOSED = 'Откройте OMP на телефоне';
export const BROWSER_GATE_WAIT = 'Ждём, пока закончится другая проверка…';
/** By the native relay outcome: what the TV dialog says when the phone did not sign in. */
export const BROWSER_TV_ERRORS: { [outcome: string]: string } = {
  NOT_TAKEN: 'Телефон не ответил — откройте OMP на телефоне',
  TIMEOUT: 'Телефон не прислал вход вовремя — попробуйте ещё раз',
  CANCELLED: 'Вход на телефоне отменили',
  FAILED: 'На телефоне войти не удалось',
  STORE_FAILED: 'Телевизор не смог сохранить вход: защищённое хранилище недоступно',
  BUSY: 'Телевизор уже ждёт ответ телефона',
  UNAVAILABLE: BROWSER_PHONE_CLOSED,
  UNVERIFIED: 'Вход с телефона не подтвердился — попробуйте ещё раз',
};
export const BROWSER_NOTE_TV = 'После входа OMP передаст его на телевизор. Пароль OMP не видит и не передаёт.';
/** The phone's notification when the TV asks for a sign-in (%s = the site). */
export const WATCH_NOTIFY_LOGIN = 'Телевизор просит войти на %s';
export const BROWSER_FAILED = 'Не удалось открыть вход через браузер';
export const BROWSER_BUSY = 'Уже открыта другая проверка — попробуйте через минуту';
export const BROWSER_STORE_FAILED = 'Не удалось сохранить вход: защищённое хранилище недоступно';
export const BROWSER_SENT_TV = 'Вход передан на телевизор';
export const BROWSER_NOT_SENT_TV = 'Не удалось передать вход на телевизор — попробуйте ещё раз';

/** «Вход на Kinozal» (the sheet's title). */
export function browserTitle(site: string): string {
  return 'Вход на ' + site;
}

/** «Войдите … Это нужно для телевизора «Гостиная».» when the TV asked. */
export function browserText(tv?: string): string {
  return BROWSER_HINT + (tv ? ' Это нужно для телевизора «' + tv + '».' : '');
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
    title: browserTitle(spec.site),
    text: browserText(forTv ? forTv.tv : undefined),
    cancel: BROWSER_CANCEL,
    gateWait: BROWSER_GATE_WAIT,
  };
  if (forTv) {
    r.note = BROWSER_NOTE_TV;
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
    text: BROWSER_TV_TEXT,
    cancel: BROWSER_CANCEL,
    phone: LOGIN_ON_PHONE,
    remote: LOGIN_BY_REMOTE,
    hint: BROWSER_TV_HINT,
    noPhone: BROWSER_NO_PHONE,
    phoneClosed: BROWSER_PHONE_CLOSED,
    waiting: BROWSER_TV_WAITING,
    gateWait: BROWSER_GATE_WAIT,
    errors: BROWSER_TV_ERRORS,
  };
  if (askPhone) r.askPhone = true;
  return r;
}

/** ok: signed in (session kept natively); cancelled: closed; busy: another page is open; failed: not opened / not stored. */
export type BrowserResult = 'ok' | 'cancelled' | 'busy' | 'failed';

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
  const result: BrowserResult = o.result === 'ok' || o.result === 'cancelled' || o.result === 'busy' ? o.result : 'failed';
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

/** The TV can ask the phone to sign in. */
export function canLoginOnPhone(): boolean {
  return !!platform && platform.phone === true;
}

/** A form login was refused with a captcha (the screen then suggests «Войти через браузер»). */
export function isCaptchaError(e: unknown): boolean {
  if (siteLoginCode(e) === 'captcha') return true;
  return e instanceof Error && e.message === RUTRACKER_CAPTCHA;
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
  /** Android TV: checks the session the phone sent (staged natively) on `host`; rejects when it is not signed in. */
  pending(ctx: SourceContext, host: string): Promise<void>;
}

export const SESSION_NOT_VERIFIED = 'Вход с телефона не подтвердился';

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
    pending(_ctx, host) {
      const p = platform;
      if (!p || !p.pending) return Promise.reject(new Error(SESSION_NOT_VERIFIED));
      if (site.hosts().indexOf(host) < 0) return Promise.reject(new Error(SESSION_NOT_VERIFIED));
      return p.pending(site.id, site.check).then((r) => {
        if (!r || r.ok !== true) throw new Error(SESSION_NOT_VERIFIED);
        if (r.host && site.adopt) site.adopt('https://' + r.host + '/');
      });
    },
  };
}

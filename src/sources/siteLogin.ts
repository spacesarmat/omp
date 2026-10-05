// Sign-in of a site behind a login (Kinozal, rustorka; labtor next), the way rutracker does it: the credentials live
// only in the Android secret store (ctx.secrets, siteLoginKeys) and go only to the site; the session cookie stays in
// the native per-site jar. A page that needs the session signs in again once with the saved credentials, else it
// rejects with loginRequired(). A captcha is never solved: the screen offers «Войти через браузер» (browserLogin.ts: the
// person signs in in a visible page, the session is kept natively, no password is stored). Every request goes to the
// site's active mirror (mirrors.ts) with the site's options (siteOptions: the Cloudflare pass while its switch is on).
// Chromium 53 safe.
import { parseHtml } from './html';
import { checkLoginPage, checkPage, siteOptions } from './site';
import { createBrowserLogin, type BrowserCheck, type BrowserOutcome, type BrowserSpec } from './browserLogin';
import { SITE_EMPTY, SITE_NO_STORE, siteLoginCode, siteLoginError, siteLoginKeys } from './siteLoginText';
import { loginRequired } from './types';
import type { SiteHosts } from './mirrors';
import type { HttpOptions, HttpResponse, SecretStore, Source, SourceContext } from './types';

export interface SiteLoginConfig {
  /** The source (id, name for the messages, cloudflare for siteOptions). */
  source: Pick<Source, 'id' | 'name' | 'cloudflare'>;
  /** The site's mirrors (one host for most sites). */
  hosts: SiteHosts;
  /** Path of the login form's action on the mirror ('takelogin.php'). */
  loginPath: string;
  /** The form fields. */
  form(username: string, password: string): { [key: string]: string };
  /** Charset of the form body (old trackers: windows-1251). */
  formCharset?: string;
  /** The page is one of a signed-in user (its header: a logout link). */
  signedIn(res: HttpResponse, doc: Document): boolean;
  /** The page asks for a captcha. */
  hasCaptcha(doc: Document): boolean;
  /** The login answer says the login or password is wrong. */
  refused?(doc: Document): boolean;
  /**
   * The login answer is still the login page (rutracker's check): a sign-in that worked redirects away from it. Such an
   * answer is never a success, even with the logged-in header of an older session.
   */
  stillOnLogin?(res: HttpResponse): boolean;
  /** A page that shows whether the session works, asked when the login answer is not conclusive (Kinozal: my.php). */
  checkPath?: string;
  /** «Войти через браузер»: the login page to open and how the native side tells a signed-in session. */
  browser: BrowserCheck;
}

export interface SavedLogin {
  username: string;
  password: string;
}

export interface SiteLogin {
  /** Sign in; the credentials are stored only after the site accepted them. Rejects in Russian (code bad_login / captcha). */
  login(username: string, password: string, ctx: SourceContext): Promise<void>;
  /** Forgets the cookies of every mirror and the saved credentials. */
  logout(ctx: SourceContext): Promise<void>;
  /** Saved credentials exist (no network). */
  loggedIn(ctx: SourceContext): Promise<boolean>;
  /**
   * Android TV: checks the login the phone sent (staged under the pending keys) with one sign-in. Nothing is stored or
   * deleted here: the native side promotes the pair after an «ok», else drops it and the earlier login stays.
   */
  loginPending(ctx: SourceContext): Promise<void>;
  /** The saved login (both parts), null when there is none. */
  savedLogin(secrets: SecretStore): Promise<SavedLogin | null>;
  /** A page (path on the active mirror) that needs the session: signs in again once when it has expired. */
  sessionDoc(ctx: SourceContext, path: string, extra?: HttpOptions): Promise<{ res: HttpResponse; doc: Document }>;
  /** One sign-in with the saved credentials (parallel callers share it); loginRequired() when there are none or they fail. */
  signInAgain(ctx: SourceContext): Promise<void>;
  /** «Войти через браузер»: on «ok» the site is signed in with a browser session (no saved password). */
  browserLogin(ctx: SourceContext, opts?: { askPhone?: boolean }): Promise<BrowserOutcome>;
  /** The current login is a browser session. */
  browserSession(ctx: SourceContext): Promise<boolean>;
  browserSpec(): BrowserSpec;
  /** The hosts, the active mirror first. */
  sessionHosts(): string[];
  /** Android TV: checks the browser session the phone sent (staged) on `host`. */
  sessionPending(ctx: SourceContext, host: string): Promise<void>;
}

function pair(s: SecretStore, user: string, pass: string): Promise<SavedLogin | null> {
  return Promise.all([s.get(user), s.get(pass)]).then((v) => (v[0] && v[1] ? { username: v[0], password: v[1] } : null));
}

export function createSiteLogin(cfg: SiteLoginConfig): SiteLogin {
  const keys = siteLoginKeys(cfg.source.id);
  const name = cfg.source.name;
  const opts = (extra?: HttpOptions) => siteOptions(cfg.source, extra);
  const hostsFirst = () => {
    const active = cfg.hosts.host();
    return [active].concat(cfg.hosts.hosts.filter((h) => h !== active));
  };
  const browser = createBrowserLogin({
    id: cfg.source.id,
    name,
    hosts: hostsFirst,
    base: () => cfg.hosts.base(),
    check: cfg.browser,
    adopt: (url) => cfg.hosts.adopt(url),
  });

  const load = (ctx: SourceContext, path: string, extra?: HttpOptions) =>
    cfg.hosts
      .get(ctx, path, opts(extra))
      .then(checkPage)
      .then((res) => ({ res, doc: parseHtml(res.text) }));

  /**
   * POST of the login form; resolves when the answer (or the check page) is a signed-in one. Never stores anything.
   * Order matters: a still-valid older session keeps the logged-in header on a refusal page, so the captcha and refusal
   * markers and the login-page URL are read before the header.
   */
  const postLogin = (username: string, password: string, ctx: SourceContext): Promise<void> =>
    cfg.hosts
      .post(ctx, cfg.loginPath, cfg.form(username, password), opts(cfg.formCharset ? { formCharset: cfg.formCharset } : undefined))
      // an inline Turnstile on the login form is a captcha (the browser login), not a Cloudflare block
      .then((res) => checkLoginPage(res, cfg.hasCaptcha, () => siteLoginError('captcha', name)))
      .then((res) => {
        const doc = parseHtml(res.text);
        if (cfg.hasCaptcha(doc)) throw siteLoginError('captcha', name);
        if ((cfg.refused && cfg.refused(doc)) || (cfg.stillOnLogin && cfg.stillOnLogin(res))) throw siteLoginError('bad_login', name);
        if (cfg.signedIn(res, doc)) return undefined;
        if (!cfg.checkPath) throw siteLoginError('bad_login', name);
        return load(ctx, cfg.checkPath).then((p) => {
          if (!cfg.signedIn(p.res, p.doc)) throw siteLoginError('bad_login', name);
        });
      });

  const savedLogin = (s: SecretStore) => pair(s, keys.user, keys.pass);
  const saved = (ctx: SourceContext) => (ctx.secrets ? savedLogin(ctx.secrets) : Promise.resolve(null));

  let relogin: Promise<void> | null = null;
  const signInAgain = (ctx: SourceContext): Promise<void> => {
    if (!relogin) {
      relogin = saved(ctx)
        .then((c) => {
          if (!c) throw loginRequired();
          return postLogin(c.username, c.password, ctx).then(undefined, (e: unknown) => {
            // wrong password or captcha: the user has to act; network / Cloudflare errors stay errors
            if (siteLoginCode(e)) throw loginRequired();
            throw e;
          });
        })
        .then(
          () => {
            relogin = null;
          },
          (e: unknown) => {
            relogin = null;
            throw e;
          },
        );
    }
    return relogin;
  };

  return {
    login(username, password, ctx) {
      const secrets = ctx.secrets;
      const user = (username || '').trim();
      if (!user || !password) return Promise.reject(new Error(SITE_EMPTY));
      if (!secrets) return Promise.reject(new Error(SITE_NO_STORE));
      return postLogin(user, password, ctx)
        .then(() => secrets.set(keys.user, user).then(() => secrets.set(keys.pass, password)))
        // a password login replaces a browser session
        .then(() => browser.forget(secrets).then(undefined, () => undefined));
    },
    logout(ctx) {
      const secrets = ctx.secrets;
      const forget = secrets ? Promise.all([secrets.delete(keys.user), secrets.delete(keys.pass), browser.forget(secrets)]) : Promise.resolve([]);
      // the jar is per registrable domain: every mirror has its own session
      const cookies = Promise.all(cfg.hosts.roots().map((r) => ctx.http.clearCookies(r)));
      return Promise.all([cookies, forget]).then(() => undefined);
    },
    loggedIn(ctx) {
      return saved(ctx).then((c) => !!c || browser.active(ctx));
    },
    loginPending(ctx) {
      const secrets = ctx.secrets;
      if (!secrets) return Promise.reject(new Error(SITE_NO_STORE));
      return pair(secrets, keys.pendingUser, keys.pendingPass).then((c) => {
        if (!c) throw new Error(SITE_EMPTY);
        return postLogin(c.username, c.password, ctx);
      });
    },
    savedLogin,
    sessionDoc(ctx, path, extra) {
      return load(ctx, path, extra).then((p) => {
        if (cfg.signedIn(p.res, p.doc)) return p;
        // signed out, or another mirror (its own jar): one sign-in again on the active mirror
        return signInAgain(ctx)
          .then(() => load(ctx, path, extra))
          .then((again) => {
            if (!cfg.signedIn(again.res, again.doc)) throw loginRequired();
            return again;
          });
      });
    },
    signInAgain,
    browserLogin: (ctx, o) => browser.login(ctx, o),
    browserSession: (ctx) => browser.active(ctx),
    browserSpec: () => browser.spec(),
    sessionHosts: hostsFirst,
    sessionPending: (ctx, host) => browser.pending(ctx, host),
  };
}

/** Captcha markers of the usual forum engines (TorrentPier, phpBB) and widgets (reCAPTCHA, hCaptcha, Turnstile). */
export function commonCaptcha(doc: Document): boolean {
  return !!doc.querySelector(
    'img[src*="captcha"], input[name="cap_sid"], input[name^="cap_code_"], input[name*="captcha"], .g-recaptcha, .h-captcha, .cf-turnstile, ' +
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"]',
  );
}

/** The final URL of an answer is the page at `path` (any mirror): «still on the login page». */
export function urlIsPath(res: HttpResponse, path: string): boolean {
  const m = /^https?:\/\/[^/?#]+\/([^?#]*)/i.exec(res.url || '');
  return !!m && m[1].toLowerCase() === path.toLowerCase();
}

// Sign-in of a site behind a login (Kinozal, rustorka; labtor next), the way rutracker does it: the credentials live
// only in the Android secret store (ctx.secrets, siteLoginKeys) and go only to the site; the session cookie stays in
// the native per-site jar. A page that needs the session signs in again once with the saved credentials, else it
// rejects with loginRequired(). A captcha is never solved: «… войдите на сайте в браузере». Every request carries the
// site's options (siteOptions: the Cloudflare pass while its switch is on). Chromium 53 safe.
import { parseHtml } from './html';
import { checkPage, siteOptions } from './site';
import { SITE_EMPTY, SITE_NO_STORE, siteLoginCode, siteLoginError, siteLoginKeys } from './siteLoginText';
import { loginRequired } from './types';
import type { HttpOptions, HttpResponse, SecretStore, Source, SourceContext } from './types';

export interface SiteLoginConfig {
  /** The source (id, name for the messages, cloudflare for siteOptions). */
  source: Pick<Source, 'id' | 'name' | 'cloudflare'>;
  /** Where the login form posts. */
  loginUrl: string;
  /** The form fields. */
  form(username: string, password: string): { [key: string]: string };
  /** Charset of the form body (old trackers: windows-1251). */
  formCharset?: string;
  /** The page is one of a signed-in user. */
  signedIn(res: HttpResponse, doc: Document): boolean;
  /** The page asks for a captcha. */
  hasCaptcha(doc: Document): boolean;
  /** The login answer says the login or password is wrong (optional: a page that is neither signed in nor a captcha is). */
  refused?(doc: Document): boolean;
  /** A page that shows whether the session works, asked when the login answer is not conclusive (Kinozal: my.php). */
  checkUrl?: string;
  /** A URL of the site whose cookies «Выйти» forgets. */
  cookieUrl: string;
}

export interface SavedLogin {
  username: string;
  password: string;
}

export interface SiteLogin {
  /** Sign in; the credentials are stored only after the site accepted them. Rejects in Russian (code bad_login / captcha). */
  login(username: string, password: string, ctx: SourceContext): Promise<void>;
  /** Forgets the site cookies and the saved credentials. */
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
  /** A page that needs the session: signs in again once when it has expired. */
  sessionDoc(ctx: SourceContext, url: string, extra?: HttpOptions): Promise<{ res: HttpResponse; doc: Document }>;
  /** One sign-in with the saved credentials (parallel callers share it); loginRequired() when there are none or they fail. */
  signInAgain(ctx: SourceContext): Promise<void>;
}

function pair(s: SecretStore, user: string, pass: string): Promise<SavedLogin | null> {
  return Promise.all([s.get(user), s.get(pass)]).then((v) => (v[0] && v[1] ? { username: v[0], password: v[1] } : null));
}

export function createSiteLogin(cfg: SiteLoginConfig): SiteLogin {
  const keys = siteLoginKeys(cfg.source.id);
  const name = cfg.source.name;
  const opts = (extra?: HttpOptions) => siteOptions(cfg.source, extra);

  const load = (ctx: SourceContext, url: string, extra?: HttpOptions) =>
    ctx.http
      .get(url, opts(extra))
      .then(checkPage)
      .then((res) => ({ res, doc: parseHtml(res.text) }));

  /** POST of the login form; resolves when the answer (or the check page) is a signed-in one. Never stores anything. */
  const postLogin = (username: string, password: string, ctx: SourceContext): Promise<void> =>
    ctx.http
      .post(cfg.loginUrl, cfg.form(username, password), opts(cfg.formCharset ? { formCharset: cfg.formCharset } : undefined))
      .then(checkPage)
      .then((res) => {
        const doc = parseHtml(res.text);
        if (cfg.signedIn(res, doc)) return undefined;
        if (cfg.hasCaptcha(doc)) throw siteLoginError('captcha', name);
        if (!cfg.checkUrl || (cfg.refused && cfg.refused(doc))) throw siteLoginError('bad_login', name);
        return load(ctx, cfg.checkUrl).then((p) => {
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
      return postLogin(user, password, ctx).then(() => secrets.set(keys.user, user).then(() => secrets.set(keys.pass, password)));
    },
    logout(ctx) {
      const secrets = ctx.secrets;
      const forget = secrets ? Promise.all([secrets.delete(keys.user), secrets.delete(keys.pass)]) : Promise.resolve([]);
      return Promise.all([ctx.http.clearCookies(cfg.cookieUrl), forget]).then(() => undefined);
    },
    loggedIn(ctx) {
      return saved(ctx).then((c) => !!c);
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
    sessionDoc(ctx, url, extra) {
      return load(ctx, url, extra).then((p) => {
        if (cfg.signedIn(p.res, p.doc)) return p;
        return signInAgain(ctx)
          .then(() => load(ctx, url, extra))
          .then((again) => {
            if (!cfg.signedIn(again.res, again.doc)) throw loginRequired();
            return again;
          });
      });
    },
    signInAgain,
  };
}

/** Captcha markers of the usual forum engines (TorrentPier, phpBB, reCAPTCHA / hCaptcha / Turnstile widgets). */
export function commonCaptcha(doc: Document): boolean {
  return !!doc.querySelector(
    'img[src*="captcha"], input[name="cap_sid"], input[name^="cap_code_"], input[name*="captcha"], .g-recaptcha, .h-captcha, iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
  );
}

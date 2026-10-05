// rutracker.org: search needs a login. Credentials live only in the Android secret store (ctx.secrets) and are
// sent only to rutracker; the session cookie stays in the native per-site cookie jar. When the session expires the
// source signs in again once with the saved credentials, otherwise it rejects with loginRequired(). «Войти через
// браузер» signs in with a browser session instead (browserLogin.ts): no password is stored then.
// Selectors and the login form follow the open-source Jackett RuTracker indexer (not checked with a real account).
import { absUrl, parseHtml, parseSize, textOf } from './html';
import { checkLoginPage, checkPage, magnetOf, makeResult, requireHost, toInt } from './site';
import { commonCaptcha } from './siteLogin';
import { createBrowserLogin } from './browserLogin';
import { rutrackerBadLogin, rutrackerCaptcha, rutrackerEmpty, rutrackerNoStore } from './rutrackerText';
import { loginRequired } from './types';
import type { HttpResponse, SecretStore, Source, SourceContext, SourceResult } from './types';

const HOST = 'rutracker.org';
const FORUM = 'https://' + HOST + '/forum/';
const LOGIN_URL = FORUM + 'login.php';
const SEARCH = FORUM + 'tracker.php?nm=';
const USER_KEY = 'rutracker.username';
const PASS_KEY = 'rutracker.password';
// a login the phone sent to the Android TV waits here until it is verified; the native side then promotes it to
// the keys above in one write, or drops it (SecretLoginStore in android/.../control/SourcesTransfer.kt)
export const RUTRACKER_PENDING_USER_KEY = 'rutracker.pending.username';
export const RUTRACKER_PENDING_PASS_KEY = 'rutracker.pending.password';

export { rutrackerCaptcha, rutrackerBadLogin, rutrackerEmpty, rutrackerNoStore };

function signedIn(res: HttpResponse, doc: Document): boolean {
  if (/\/forum\/login\.php/i.test(res.url)) return false;
  return !!doc.getElementById('logged-in-username');
}

function hasCaptcha(doc: Document): boolean {
  return !!doc.querySelector('img[src*="/captcha/"], input[name="cap_sid"], input[name^="cap_code_"]');
}

/** «Войти через браузер»: the login page, and the signed-in header (#logged-in-username) on the forum index. */
const browser = createBrowserLogin({
  id: 'rutracker',
  name: 'rutracker',
  hosts: () => [HOST],
  base: () => 'https://' + HOST + '/',
  check: { loginPath: 'forum/login.php', path: 'forum/index.php', marker: 'logged-in-username', cookies: ['bb_session'] },
});

/** POST to login.php; resolves when the answer is a signed-in page. Never stores anything. */
function postLogin(username: string, password: string, ctx: SourceContext): Promise<void> {
  return ctx.http
    .post(LOGIN_URL, { login_username: username, login_password: password, login: 'вход' }, { formCharset: 'windows-1251' })
    // an inline Turnstile on the login form is a captcha (the browser login), not a Cloudflare block
    .then((res) => checkLoginPage(res, commonCaptcha, () => new Error(rutrackerCaptcha())))
    .then((res) => {
      const doc = parseHtml(res.text);
      if (signedIn(res, doc)) return;
      if (hasCaptcha(doc)) throw new Error(rutrackerCaptcha());
      throw new Error(rutrackerBadLogin());
    });
}

function pair(s: SecretStore, user: string, pass: string): Promise<{ username: string; password: string } | null> {
  return Promise.all([s.get(user), s.get(pass)]).then((v) => (v[0] && v[1] ? { username: v[0], password: v[1] } : null));
}

/** The saved login (both parts), null when there is none. */
export function rutrackerSavedLogin(s: SecretStore): Promise<{ username: string; password: string } | null> {
  return pair(s, USER_KEY, PASS_KEY);
}

function savedCredentials(ctx: SourceContext): Promise<{ username: string; password: string } | null> {
  return ctx.secrets ? rutrackerSavedLogin(ctx.secrets) : Promise.resolve(null);
}

/**
 * Android TV: checks the login the phone sent (staged under the pending keys) with one sign-in. Nothing is stored
 * or deleted here: the native side promotes the pair after an «ok», else drops it and the earlier login stays.
 * Rejects with the Russian messages of login().
 */
export function rutrackerLoginPending(ctx: SourceContext): Promise<void> {
  const secrets = ctx.secrets;
  if (!secrets) return Promise.reject(new Error(rutrackerNoStore()));
  return pair(secrets, RUTRACKER_PENDING_USER_KEY, RUTRACKER_PENDING_PASS_KEY).then((c) => {
    if (!c) throw new Error(rutrackerEmpty());
    return postLogin(c.username, c.password, ctx);
  });
}

let relogin: Promise<void> | null = null;

/** One sign-in with the saved credentials at a time (parallel searches share it); loginRequired() when it fails. */
function signInAgain(ctx: SourceContext): Promise<void> {
  if (!relogin) {
    relogin = savedCredentials(ctx)
      .then((c) => {
        // a browser session that expired: its marker goes («нужен вход»), there is no password to sign in with
        if (!c) return browser.expired(ctx.secrets).then(() => Promise.reject(loginRequired()));
        return postLogin(c.username, c.password, ctx).then(undefined, (e: unknown) => {
          // wrong password or captcha: the user has to act; network / Cloudflare errors stay errors
          const msg = e instanceof Error ? e.message : '';
          if (msg === rutrackerBadLogin() || msg === rutrackerCaptcha()) throw loginRequired();
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
}

/** A page that needs the session: signs in again once when it has expired. */
function sessionDoc(ctx: SourceContext, url: string): Promise<{ res: HttpResponse; doc: Document }> {
  const load = () =>
    ctx.http
      .get(url)
      .then(checkPage)
      .then((res) => ({ res, doc: parseHtml(res.text) }));
  return load().then((p) => {
    if (signedIn(p.res, p.doc)) return p;
    return signInAgain(ctx)
      .then(load)
      .then((again) => {
        if (!signedIn(again.res, again.doc)) throw loginRequired();
        return again;
      });
  });
}

function parse(doc: Document, base: string): SourceResult[] {
  const out: SourceResult[] = [];
  const rows = doc.querySelectorAll('#tor-tbl > tbody > tr');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as HTMLTableRowElement;
    const sizeCell = row.querySelector('td.tor-size');
    const dl = row.querySelector('td.tor-size > a.tr-dl');
    const link = row.querySelector('td.t-title-col div.t-title > a.tLink');
    // no download link = the release is on moderation
    if (!sizeCell || !dl || !link || row.cells.length < 10) continue;
    const bytesAttr = sizeCell.getAttribute('data-ts_text') || '';
    const size = textOf(dl).replace(/[^\d.,\sA-Za-zА-Яа-я]+$/, '').trim();
    const seedCell = row.cells[6];
    const seedText = textOf(seedCell);
    const unix = toInt(row.cells[9].getAttribute('data-ts_text'));
    out.push(
      makeResult('rutracker', 'rutracker', {
        title: textOf(link),
        detailUrl: absUrl(link.getAttribute('href'), base),
        categories: textOf(row.querySelector('td.f-name-col div.f-name > a')),
        size,
        sizeBytes: /^\d+$/.test(bytesAttr) ? parseInt(bytesAttr, 10) : parseSize(size),
        // «12 дн» = no seeders for 12 days
        seeds: seedText.indexOf('дн') >= 0 ? 0 : toInt(textOf(seedCell.querySelector('b')) || seedText),
        peers: toInt(textOf(row.cells[7])),
        date: unix > 0 ? unix * 1000 : undefined,
      }),
    );
  }
  return out;
}

export const rutracker: Source = {
  id: 'rutracker',
  name: 'rutracker',
  kind: 'builtin',
  needsLogin: true,
  search(query: string, ctx: SourceContext) {
    return sessionDoc(ctx, SEARCH + encodeURIComponent(query)).then((p) => parse(p.doc, p.res.url || FORUM));
  },
  magnet(detailUrl: string, ctx: SourceContext) {
    return requireHost(detailUrl, HOST)
      .then(() => sessionDoc(ctx, detailUrl))
      .then((p) => magnetOf(p.doc, 'a.magnet-link[href^="magnet:"]'));
  },
  login(username: string, password: string, ctx: SourceContext) {
    const secrets = ctx.secrets;
    const user = (username || '').trim();
    if (!user || !password) return Promise.reject(new Error(rutrackerEmpty()));
    if (!secrets) return Promise.reject(new Error(rutrackerNoStore()));
    return postLogin(user, password, ctx)
      .then(() => secrets.set(USER_KEY, user).then(() => secrets.set(PASS_KEY, password)))
      // a password login replaces a browser session
      .then(() => browser.forget(secrets).then(undefined, () => undefined));
  },
  logout(ctx: SourceContext) {
    const secrets = ctx.secrets;
    const forget = secrets ? Promise.all([secrets.delete(USER_KEY), secrets.delete(PASS_KEY), browser.forget(secrets)]) : Promise.resolve([]);
    return Promise.all([ctx.http.clearCookies(FORUM), forget]).then(() => undefined);
  },
  loggedIn(ctx: SourceContext) {
    return savedCredentials(ctx).then((c) => !!c || browser.active(ctx));
  },
  browserLogin: (ctx, o) => browser.login(ctx, o),
  browserSession: (ctx) => browser.active(ctx),
  browserSpec: () => browser.spec(),
  sessionHosts: () => [HOST],
  sessionPending: (ctx, host) => browser.pending(ctx, host),
};

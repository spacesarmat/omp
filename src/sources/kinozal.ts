// Kinozal: behind Cloudflare, needs a login (without it the site gives no .torrent). Mirrors kinozal.me, kinozal.guru
// and kinozal.tv (Jackett's links, then its legacy link): every request goes to the active one, a dead mirror falls back
// to the next (mirrors.ts). windows-1251 pages (decoded by the native http), the query normalized like Jackett's and
// percent-encoded in windows-1251. The release is added by its magnet, taken from the signed-in
// «get_srv_details.php?action=2» answer (does not count against the daily download limit), else by the .torrent from
// download.php through the session.
// Selectors, the search URL, the login form and the logged-in marker follow the open-source Jackett definitions
// kinozal.yml / kinozal-magnet.yml (not checked with a real account; verified on a device).
import { absUrl, encodeWin1251, parseDate, parseHtml, parseSize, textOf } from './html';
import { createSiteHosts } from './mirrors';
import { CHALLENGE, fetchTorrentAnswer, isChallenge, makeResult, siteOptions, toInt } from './site';
import { BAD_URL } from './http';
import { createSiteLogin, commonCaptcha, urlIsPath } from './siteLogin';
import { loginRequired } from './types';
import type { HttpResponse, Source, SourceContext, SourceResult } from './types';

/** Jackett kinozal.yml: links kinozal.me, kinozal.guru; legacy kinozal.tv. */
export const KINOZAL_MIRRORS = ['kinozal.me', 'kinozal.guru', 'kinozal.tv'];
export const kinozalHosts = createSiteHosts('kinozal', KINOZAL_MIRRORS);
// all categories, by title, any format / year / period; newest first
const SEARCH_TAIL = '&g=0&c=0&v=0&d=0&w=0&t=0&f=0';
const LOGIN_PATH = 'takelogin.php';

export const KINOZAL_NO_FILE = 'Kinozal не отдал торрент — войдите заново или проверьте дневной лимит скачиваний';

/** Kinozal category ids (Jackett's mapping) → the label of the result. */
const CATEGORIES: { [id: string]: string } = {
  '45': 'Сериалы', '46': 'Сериалы',
  '20': 'Аниме', '21': 'Мультфильмы', '22': 'Мультфильмы',
  '3': 'Музыка', '4': 'Музыка', '5': 'Музыка', '42': 'Музыка',
};
const MOVIES = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 24, 35, 37, 38, 39, 47, 48, 49, 50];

function category(row: Element): string {
  const img = row.querySelector('td.bt img');
  const id = ((img && img.getAttribute('onclick')) || '').replace(/[^\d]/g, '');
  if (!id) return '';
  if (CATEGORIES[id]) return CATEGORIES[id];
  return MOVIES.indexOf(parseInt(id, 10)) >= 0 ? 'Фильмы' : '';
}

function dateOf(text: string, now: number): number | undefined {
  if (/^сейчас/i.test(text)) return now;
  return parseDate(text, now);
}

/** Jackett's keyword filters: punctuation → spaces, «S01» → «1», «S01E02» → «1 2». */
export function kinozalQuery(q: string): string {
  return q
    .replace(/[^a-zA-Zа-яА-ЯёЁ0-9]+/g, ' ')
    .replace(/\bS0*(\d+)\b/gi, '$1')
    .replace(/\bS0*(\d+)E0*(\d+)\b/gi, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseKinozal(doc: Document, base: string, now: number = Date.now()): SourceResult[] {
  const rows = doc.querySelectorAll('table tr');
  const out: SourceResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as HTMLTableRowElement;
    if (!row.querySelector('td.bt')) continue;
    const link = row.querySelector('td.nam a[href*="details.php?"]');
    const cells = row.cells;
    if (!link || cells.length < 7) continue;
    const size = textOf(cells[3]);
    out.push(
      makeResult('kinozal', 'Kinozal', {
        title: textOf(link),
        detailUrl: absUrl(link.getAttribute('href'), base),
        categories: category(row),
        size,
        sizeBytes: parseSize(size),
        seeds: toInt(textOf(cells[4])),
        peers: toInt(textOf(cells[5])),
        date: dateOf(textOf(cells[6]), now),
      }),
    );
  }
  return out;
}

function signedIn(doc: Document): boolean {
  return !!doc.querySelector('a[href*="logout.php?hash4u="]');
}

export const kinozalLogin = createSiteLogin({
  source: { id: 'kinozal', name: 'Kinozal', cloudflare: true },
  hosts: kinozalHosts,
  loginPath: LOGIN_PATH,
  form: (username, password) => ({ username, password }),
  formCharset: 'windows-1251',
  signedIn: (_res, doc) => signedIn(doc),
  hasCaptcha: commonCaptcha,
  refused: (doc) => !!doc.querySelector('div.bx1 div.red'),
  stillOnLogin: (res) => urlIsPath(res, LOGIN_PATH) || urlIsPath(res, 'login.php'),
  checkPath: 'my.php',
  // the login page and the signed-in check of «Войти через браузер» (the same logout link as above); uid / pass are the
  // TBDev engine's sign-in cookies (a fast signal only: without them the page is still checked every 30 s)
  browser: { loginPath: 'login.php', path: 'my.php', marker: 'logout.php?hash4u=', cookies: ['uid', 'pass'] },
});

/** The release id of a details link on any mirror (…/details.php?id=123), '' otherwise. */
function releaseId(url: string): string {
  const path = kinozalHosts.path(url || '');
  const m = path === null ? null : /^details\.php\?(?:.*&)?id=(\d+)/.exec(path);
  return m ? m[1] : '';
}

/** An answer that says the session is gone: the login page, a login form, 401/403. */
function signedOut(res: HttpResponse): boolean {
  if (res.status === 401 || res.status === 403) return true;
  if (urlIsPath(res, 'login.php') || urlIsPath(res, LOGIN_PATH)) return true;
  return /<input[^>]+name=["']?password/i.test(res.text);
}

/** The infohash from «get_srv_details.php?id=…&action=2» (its first <li>), '' when the answer has none. */
function infohash(ctx: SourceContext, id: string): Promise<{ hash: string; out: boolean }> {
  return kinozalHosts.get(ctx, 'get_srv_details.php?id=' + id + '&action=2', siteOptions(kinozal)).then((res) => {
    if (isChallenge(res.text)) throw new Error(CHALLENGE);
    if (res.status < 200 || res.status >= 400) return { hash: '', out: signedOut(res) };
    const li = parseHtml(res.text).querySelector('li');
    const m = /\b([A-Fa-f0-9]{40})\b/.exec(textOf(li) || '');
    return { hash: m ? m[1].toLowerCase() : '', out: !m && signedOut(res) };
  });
}

function magnetOf(hash: string, title: string): string {
  return 'magnet:?xt=urn:btih:' + hash + (title ? '&dn=' + encodeURIComponent(title) : '');
}

/**
 * The .torrent through the session; only a signed-out answer signs in again, a limit page does not. `signedAgain`: this
 * add already signed in once (never twice per add).
 */
function torrent(ctx: SourceContext, id: string, signedAgain: boolean): Promise<string> {
  const get = () => fetchTorrentAnswer(ctx, kinozalHosts.base() + 'download.php?id=' + id, siteOptions(kinozal));
  return get()
    .then((a) => (a.link || signedAgain || !signedOut(a.res) ? a : kinozalLogin.signInAgain(ctx).then(get)))
    .then((a) => {
      if (!a.link) throw new Error(KINOZAL_NO_FILE);
      return a.link;
    });
}

export const kinozal: Source = {
  id: 'kinozal',
  name: 'Kinozal',
  kind: 'builtin',
  needsLogin: true,
  cloudflare: true,
  /** The active mirror (the visible check and the clearance status use it). */
  get siteUrl() {
    return kinozalHosts.base();
  },
  get siteUrls() {
    return kinozalHosts.roots();
  },
  search(query: string, ctx: SourceContext) {
    const path = 'browse.php?s=' + encodeWin1251(kinozalQuery(query)) + SEARCH_TAIL;
    return kinozalLogin.sessionDoc(ctx, path).then((p) => parseKinozal(p.doc, p.res.url || kinozalHosts.base()));
  },
  resolve(r: SourceResult, ctx: SourceContext) {
    // a result from before a mirror switch still resolves: only its id is used, on the active mirror
    const id = releaseId(r.detailUrl || '');
    if (!id) return Promise.reject(new Error(BAD_URL));
    let signedAgain = false;
    return kinozalLogin
      .loggedIn(ctx)
      .then((has) => {
        if (!has) throw loginRequired();
        // sign in again only when the answer looks signed out; any other answer without a hash goes to the .torrent
        return infohash(ctx, id).then((h) => {
          if (h.hash || !h.out) return h.hash;
          signedAgain = true;
          return kinozalLogin.signInAgain(ctx).then(() => infohash(ctx, id).then((x) => x.hash));
        });
      })
      .then((hash) => (hash ? magnetOf(hash, r.Title) : torrent(ctx, id, signedAgain)));
  },
  login: (u, p, ctx) => kinozalLogin.login(u, p, ctx),
  logout: (ctx) => kinozalLogin.logout(ctx),
  loggedIn: (ctx) => kinozalLogin.loggedIn(ctx),
  savedLogin: (ctx) => (ctx.secrets ? kinozalLogin.savedLogin(ctx.secrets) : Promise.resolve(null)),
  loginPending: (ctx) => kinozalLogin.loginPending(ctx),
  browserLogin: (ctx, o) => kinozalLogin.browserLogin(ctx, o),
  browserSession: (ctx) => kinozalLogin.browserSession(ctx),
  browserSpec: () => kinozalLogin.browserSpec(),
  sessionHosts: () => kinozalLogin.sessionHosts(),
  sessionPending: (ctx, host) => kinozalLogin.sessionPending(ctx, host),
};

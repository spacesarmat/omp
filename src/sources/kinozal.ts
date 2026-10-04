// kinozal.tv: behind Cloudflare, needs a login (without it the site gives no .torrent). windows-1251 pages (decoded by
// the native http), the query percent-encoded in windows-1251. The release is added by its magnet, taken from the
// signed-in «get_srv_details.php?action=2» answer (does not count against the daily download limit), else by the
// .torrent from download.php through the session.
// Selectors, the search URL, the login form and the logged-in marker follow the open-source Jackett definitions
// kinozal.yml / kinozal-magnet.yml (not checked with a real account; verified on a device).
import { absUrl, encodeWin1251, parseDate, parseSize, textOf } from './html';
import { fetchTorrent, makeResult, requireHost, siteOptions, toInt } from './site';
import { createSiteLogin, commonCaptcha } from './siteLogin';
import { loginRequired } from './types';
import type { Source, SourceContext, SourceResult } from './types';

const HOST = 'kinozal.tv';
const BASE = 'https://' + HOST + '/';
const SEARCH = BASE + 'browse.php?s=';
// all categories, by title, any format / year / period; newest first
const SEARCH_TAIL = '&g=0&c=0&v=0&d=0&w=0&t=0&f=0';

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
  loginUrl: BASE + 'takelogin.php',
  form: (username, password) => ({ username, password }),
  formCharset: 'windows-1251',
  signedIn: (_res, doc) => signedIn(doc),
  hasCaptcha: commonCaptcha,
  refused: (doc) => !!doc.querySelector('div.bx1 div.red'),
  checkUrl: BASE + 'my.php',
  cookieUrl: BASE,
});

/** The release id of a details link (…/details.php?id=123). */
function releaseId(url: string): string {
  const m = /[?&]id=(\d+)/.exec(url || '');
  return m ? m[1] : '';
}

/** The infohash from «get_srv_details.php?id=…&action=2» (its first <li>), '' when the answer has none. */
function infohash(ctx: SourceContext, id: string): Promise<string> {
  return ctx.http.get(BASE + 'get_srv_details.php?id=' + id + '&action=2', siteOptions(kinozal)).then((res) => {
    if (res.status < 200 || res.status >= 400) return '';
    const doc = new DOMParser().parseFromString(res.text, 'text/html');
    const li = doc.querySelector('li');
    const m = /\b([A-Fa-f0-9]{40})\b/.exec(textOf(li) || '');
    return m ? m[1].toLowerCase() : '';
  });
}

function magnetOf(hash: string, title: string): string {
  return 'magnet:?xt=urn:btih:' + hash + (title ? '&dn=' + encodeURIComponent(title) : '');
}

export const kinozal: Source = {
  id: 'kinozal',
  name: 'Kinozal',
  kind: 'builtin',
  needsLogin: true,
  cloudflare: true,
  siteUrl: BASE,
  search(query: string, ctx: SourceContext) {
    const url = SEARCH + encodeWin1251(query) + SEARCH_TAIL;
    return kinozalLogin.sessionDoc(ctx, url).then((p) => parseKinozal(p.doc, p.res.url || BASE));
  },
  resolve(r: SourceResult, ctx: SourceContext) {
    const detail = r.detailUrl || '';
    const id = releaseId(detail);
    return requireHost(detail, HOST)
      .then(() => {
        if (!id) throw new Error(KINOZAL_NO_FILE);
        return kinozalLogin.loggedIn(ctx);
      })
      .then((has) => {
        if (!has) throw loginRequired();
        // the session may have expired: one sign-in again, then the .torrent through the session
        return infohash(ctx, id).then((h) => h || kinozalLogin.signInAgain(ctx).then(() => infohash(ctx, id)));
      })
      .then((h) => {
        if (h) return magnetOf(h, r.Title);
        return fetchTorrent(ctx, BASE + 'download.php?id=' + id, siteOptions(kinozal)).then((link) => {
          if (!link) throw new Error(KINOZAL_NO_FILE);
          return link;
        });
      });
  },
  login: (u, p, ctx) => kinozalLogin.login(u, p, ctx),
  logout: (ctx) => kinozalLogin.logout(ctx),
  loggedIn: (ctx) => kinozalLogin.loggedIn(ctx),
  savedLogin: (ctx) => (ctx.secrets ? kinozalLogin.savedLogin(ctx.secrets) : Promise.resolve(null)),
  loginPending: (ctx) => kinozalLogin.loginPending(ctx),
};

// rustorka.com: a TorrentPier forum tracker behind Cloudflare; search and .torrent need a login. windows-1251 pages
// (decoded by the native http), the query percent-encoded in windows-1251. The release is added by its .torrent
// (download.php through the session), else by the magnet of the topic page.
// Selectors and the search URL follow the open-source Jackett definition rustorka.yml (Jackett signs in with a cookie;
// the login form is TorrentPier's, like rutracker's). Not checked with a real account; verified on a device.
import { absUrl, encodeWin1251, parseSize, textOf } from './html';
import { fetchTorrentAnswer, magnetOf, makeResult, NO_MAGNET, siteOptions, toInt } from './site';
import { BAD_URL } from './http';
import { createSiteHosts } from './mirrors';
import { createSiteLogin, commonCaptcha, urlIsPath } from './siteLogin';
import { loginRequired } from './types';
import type { HttpResponse, Source, SourceContext, SourceResult } from './types';

/** Jackett rustorka.yml: one link (rustorka.com); the mirror helper is shared with Kinozal. */
export const RUSTORKA_MIRRORS = ['rustorka.com'];
// every forum, newest first, all time
const SEARCH_TAIL = '&f%5B%5D=-1&o=1&s=2&tm=-1';

/** '<u>1471026790</u> 1.37 GB' → { key: '1471026790', text: '1.37 GB' } (the <u> holds the sort key). */
function keyed(cell: Element | undefined): { key: string; text: string } {
  if (!cell) return { key: '', text: '' };
  const key = textOf(cell.querySelector('u'));
  const all = textOf(cell);
  return { key, text: key && all.indexOf(key) === 0 ? all.slice(key.length).trim() : all };
}

export function parseRustorka(doc: Document, base: string): SourceResult[] {
  const rows = doc.querySelectorAll('tr[id^="tor_"]');
  const out: SourceResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as HTMLTableRowElement;
    const link = row.querySelector('a[href*="viewtopic.php?t="]');
    const dl = row.querySelector('a[href*="download.php?id="]');
    const cells = row.cells;
    // no download link = the release is on moderation
    if (!link || !dl || cells.length < 8) continue;
    const size = keyed(cells[6]);
    const added = keyed(cells[cells.length - 1]);
    const unix = /^\d+$/.test(added.key) ? parseInt(added.key, 10) : 0;
    out.push(
      makeResult('rustorka', 'rustorka', {
        title: textOf(link),
        detailUrl: absUrl(link.getAttribute('href'), base),
        link: absUrl(dl.getAttribute('href'), base),
        categories: textOf(row.querySelector('a[href*="tracker.php?f="]')),
        size: size.text,
        sizeBytes: /^\d+$/.test(size.key) ? parseInt(size.key, 10) : parseSize(size.text),
        seeds: toInt(textOf(row.querySelector('td.seedmed b') || row.querySelector('td.seedmed'))),
        peers: toInt(textOf(row.querySelector('td.leechmed b') || row.querySelector('td.leechmed'))),
        date: unix > 0 ? unix * 1000 : undefined,
      }),
    );
  }
  return out;
}

export const rustorkaHosts = createSiteHosts('rustorka', RUSTORKA_MIRRORS);

export const rustorkaLogin = createSiteLogin({
  source: { id: 'rustorka', name: 'rustorka', cloudflare: true },
  hosts: rustorkaHosts,
  loginPath: 'forum/login.php',
  form: (username, password) => ({ login_username: username, login_password: password, login: 'Вход' }),
  formCharset: 'windows-1251',
  signedIn: (_res, doc) => !!doc.querySelector('a[href*="login.php?logout"]'),
  hasCaptcha: commonCaptcha,
  // TorrentPier shows the form again after a wrong password (with the header of an older session, if any)
  refused: (doc) => !!doc.querySelector('input[name="login_password"]'),
  stillOnLogin: (res) => urlIsPath(res, 'forum/login.php'),
  checkPath: 'forum/index.php',
  // no cookie names: TorrentPier's guest and member cookies share names, so a new cookie or the 30 s check decides
  browser: { loginPath: 'forum/login.php', path: 'forum/index.php', marker: 'login.php?logout' },
});

export const RUSTORKA_NO_FILE = 'rustorka не отдал торрент — войдите заново и попробуйте снова';

/** An answer that says the session is gone: the login page or its form, 401/403. */
function signedOut(res: HttpResponse): boolean {
  if (res.status === 401 || res.status === 403 || urlIsPath(res, 'forum/login.php')) return true;
  return /<input[^>]+name=["']?login_password/i.test(res.text);
}

export const rustorka: Source = {
  id: 'rustorka',
  name: 'rustorka',
  kind: 'builtin',
  needsLogin: true,
  cloudflare: true,
  get siteUrl() {
    return rustorkaHosts.base();
  },
  get siteUrls() {
    return rustorkaHosts.roots();
  },
  search(query: string, ctx: SourceContext) {
    const path = 'forum/tracker.php?nm=' + encodeWin1251(query) + SEARCH_TAIL;
    return rustorkaLogin.sessionDoc(ctx, path).then((p) => parseRustorka(p.doc, p.res.url || rustorkaHosts.base() + 'forum/'));
  },
  resolve(r: SourceResult, ctx: SourceContext) {
    const file = rustorkaHosts.path(r.Link || '');
    const topic = rustorkaHosts.path(r.detailUrl || '');
    if (file === null) return Promise.reject(new Error(BAD_URL));
    const get = () => fetchTorrentAnswer(ctx, rustorkaHosts.base() + file, siteOptions(rustorka));
    return rustorkaLogin
      .loggedIn(ctx)
      .then((has) => {
        if (!has) throw loginRequired();
        // only a signed-out answer signs in again (once)
        return get().then((a) => (a.link || !signedOut(a.res) ? a : rustorkaLogin.signInAgain(ctx).then(get)));
      })
      .then((a) => {
        if (a.link) return a.link;
        // no file (e.g. a limit): the magnet of the topic page
        if (topic === null) throw new Error(RUSTORKA_NO_FILE);
        return rustorkaLogin
          .sessionDoc(ctx, topic)
          .then((p) => magnetOf(p.doc))
          .then(undefined, (e: unknown) => {
            throw e instanceof Error && e.message === NO_MAGNET ? new Error(RUSTORKA_NO_FILE) : e;
          });
      });
  },
  login: (u, p, ctx) => rustorkaLogin.login(u, p, ctx),
  logout: (ctx) => rustorkaLogin.logout(ctx),
  loggedIn: (ctx) => rustorkaLogin.loggedIn(ctx),
  savedLogin: (ctx) => (ctx.secrets ? rustorkaLogin.savedLogin(ctx.secrets) : Promise.resolve(null)),
  loginPending: (ctx) => rustorkaLogin.loginPending(ctx),
  browserLogin: (ctx, o) => rustorkaLogin.browserLogin(ctx, o),
  browserSession: (ctx) => rustorkaLogin.browserSession(ctx),
  browserSpec: () => rustorkaLogin.browserSpec(),
  sessionHosts: () => rustorkaLogin.sessionHosts(),
  sessionPending: (ctx, host) => rustorkaLogin.sessionPending(ctx, host),
};

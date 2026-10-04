// rustorka.com: a TorrentPier forum tracker behind Cloudflare; search and .torrent need a login. windows-1251 pages
// (decoded by the native http), the query percent-encoded in windows-1251. The release is added by its .torrent
// (download.php through the session), else by the magnet of the topic page.
// Selectors and the search URL follow the open-source Jackett definition rustorka.yml (Jackett signs in with a cookie;
// the login form is TorrentPier's, like rutracker's). Not checked with a real account; verified on a device.
import { absUrl, encodeWin1251, parseSize, textOf } from './html';
import { fetchTorrent, magnetOf, makeResult, NO_MAGNET, requireHost, siteOptions, toInt } from './site';
import { createSiteLogin, commonCaptcha } from './siteLogin';
import { loginRequired } from './types';
import type { Source, SourceContext, SourceResult } from './types';

const HOST = 'rustorka.com';
const BASE = 'https://' + HOST + '/';
const FORUM = BASE + 'forum/';
const SEARCH = FORUM + 'tracker.php?nm=';
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

export const rustorkaLogin = createSiteLogin({
  source: { id: 'rustorka', name: 'rustorka', cloudflare: true },
  loginUrl: FORUM + 'login.php',
  form: (username, password) => ({ login_username: username, login_password: password, login: 'Вход' }),
  formCharset: 'windows-1251',
  signedIn: (_res, doc) => !!doc.querySelector('a[href*="login.php?logout"]'),
  hasCaptcha: commonCaptcha,
  // TorrentPier shows the form again after a wrong password
  refused: (doc) => !!doc.querySelector('input[name="login_password"]'),
  checkUrl: FORUM + 'index.php',
  cookieUrl: FORUM,
});

export const RUSTORKA_NO_FILE = 'rustorka не отдал торрент — войдите заново и попробуйте снова';

export const rustorka: Source = {
  id: 'rustorka',
  name: 'rustorka',
  kind: 'builtin',
  needsLogin: true,
  cloudflare: true,
  siteUrl: BASE,
  search(query: string, ctx: SourceContext) {
    const url = SEARCH + encodeWin1251(query) + SEARCH_TAIL;
    return rustorkaLogin.sessionDoc(ctx, url).then((p) => parseRustorka(p.doc, p.res.url || FORUM));
  },
  resolve(r: SourceResult, ctx: SourceContext) {
    const file = r.Link || '';
    const detail = r.detailUrl || '';
    const opts = () => siteOptions(rustorka);
    return requireHost(file, HOST)
      .then(() => rustorkaLogin.loggedIn(ctx))
      .then((has) => {
        if (!has) throw loginRequired();
        // the session may have expired: one sign-in again
        return fetchTorrent(ctx, file, opts()).then((l) => l || rustorkaLogin.signInAgain(ctx).then(() => fetchTorrent(ctx, file, opts())));
      })
      .then((l) => {
        if (l) return l;
        // no file (e.g. a limit): the magnet of the topic page
        return requireHost(detail, HOST)
          .then(() => rustorkaLogin.sessionDoc(ctx, detail))
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
};

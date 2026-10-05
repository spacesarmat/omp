// nnmclub.to: a phpBB 2 forum tracker behind Cloudflare (windows-1251, decoded by the native http); magnet on the
// release page. The search and the «Новое» feed are open to guests; a login (password or «Войти через браузер») is
// optional: it gets past the Cloudflare check, the session lives in the native jar and goes with every request. The
// search never signs in by itself. The login form and the signed-in marker (the header's logout link) follow phpBB 2;
// not checked with a real account, verified on a device.
import { absUrl, parseHtml, parseSize, textOf } from './html';
import { checkPage, loadDoc, magnetOf, makeResult, parseError, requireHost, siteOptions, toInt } from './site';
import { createSiteHosts } from './mirrors';
import { createSiteLogin, commonCaptcha, urlIsPath } from './siteLogin';
import type { FeedCategory, Source, SourceContext, SourceResult } from './types';

const HOST = 'nnmclub.to';
/** One host; the mirror helper gives the site root, the session hosts and the per-mirror logout. */
export const NNMCLUB_MIRRORS = [HOST];
export const nnmclubHosts = createSiteHosts('nnmclub', NNMCLUB_MIRRORS);
const SEARCH_PATH = 'forum/tracker.php?nm=';
/** The tracker list of a forum category, newest first, open to guests (checked live): «Видео. Кино…», «Сериалы», «Аниме». */
const FEED_URL = 'https://' + HOST + '/forum/tracker.php?c=';
const FEED: { [c: string]: number } = { movie: 14, tv: 27, anime: 24 };
const LOGIN_PATH = 'forum/login.php';

/** '<u>26228254998</u> 24.4 GB' → { bytes: 26228254998, text: '24.4 GB' } (the <u> holds the sort key). */
function keyed(cell: Element | undefined): { key: string; text: string } {
  if (!cell) return { key: '', text: '' };
  const u = cell.querySelector('u');
  const key = textOf(u);
  const all = textOf(cell);
  return { key, text: key && all.indexOf(key) === 0 ? all.slice(key.length).trim() : all };
}

function parse(doc: Document, base: string): SourceResult[] {
  const table = doc.querySelector('table.forumline.tablesorter');
  if (!table) throw new Error(parseError());
  const out: SourceResult[] = [];
  const rows = table.querySelectorAll('tbody > tr');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as HTMLTableRowElement;
    const link = row.querySelector('a.topictitle');
    const cells = row.cells;
    if (!link || cells.length < 10) continue;
    const size = keyed(cells[5]);
    const added = keyed(cells[9]);
    const bytes = /^\d+$/.test(size.key) ? parseInt(size.key, 10) : parseSize(size.text);
    const unix = /^\d+$/.test(added.key) ? parseInt(added.key, 10) : 0;
    out.push(
      makeResult('nnmclub', 'NNM-Club', {
        title: textOf(link),
        detailUrl: absUrl(link.getAttribute('href'), base),
        categories: textOf(cells[1]),
        size: size.text,
        sizeBytes: bytes,
        seeds: toInt(textOf(row.querySelector('td.seedmed'))),
        peers: toInt(textOf(row.querySelector('td.leechmed'))),
        date: unix > 0 ? unix * 1000 : undefined,
      }),
    );
  }
  return out;
}

export const nnmclubLogin = createSiteLogin({
  source: { id: 'nnmclub', name: 'NNM-Club', cloudflare: true },
  hosts: nnmclubHosts,
  loginPath: LOGIN_PATH,
  // phpBB 2: «login» is the submit button; its value «Вход» is written escaped (the site reads only that it is there)
  form: (username, password) => ({ username, password, autologin: 'on', redirect: 'index.php', login: '\u0412\u0445\u043e\u0434' }),
  formCharset: 'windows-1251',
  signedIn: (_res, doc) => !!doc.querySelector('a[href*="login.php?logout"]'),
  hasCaptcha: commonCaptcha,
  // a wrong password answers with the login page itself; a good one redirects to index.php
  stillOnLogin: (res) => urlIsPath(res, LOGIN_PATH),
  checkPath: 'forum/index.php',
  // no cookie names: phpBB guests and members share them, so a new cookie or the 30 s check decides
  browser: { loginPath: LOGIN_PATH, path: 'forum/index.php', marker: 'login.php?logout' },
});

export const nnmclub: Source = {
  id: 'nnmclub',
  name: 'NNM-Club',
  kind: 'builtin',
  // no needsLogin: the search works for guests and the site stays on by default
  cloudflare: true,
  get siteUrl() {
    return nnmclubHosts.base();
  },
  get siteUrls() {
    return nnmclubHosts.roots();
  },
  search(query: string, ctx: SourceContext) {
    // the site reads a UTF-8 percent-encoded nm (checked live; a windows-1251 one is ignored)
    return nnmclubHosts
      .get(ctx, SEARCH_PATH + encodeURIComponent(query), siteOptions(nnmclub))
      .then(checkPage)
      .then((res) => parse(parseHtml(res.text), res.url || nnmclubHosts.base() + 'forum/tracker.php'));
  },
  latest(ctx: SourceContext, category: FeedCategory) {
    const c = FEED[category];
    if (!c) return Promise.resolve([]);
    // no Cloudflare pass: the feed runs in the background, where a visible check cannot open
    return loadDoc(ctx, FEED_URL + c).then((p) => parse(p.doc, p.res.url || FEED_URL + c));
  },
  magnet(detailUrl: string, ctx: SourceContext) {
    return requireHost(detailUrl, HOST)
      .then(() => loadDoc(ctx, detailUrl, siteOptions(nnmclub)))
      .then((p) => magnetOf(p.doc));
  },
  login: (u, p, ctx) => nnmclubLogin.login(u, p, ctx),
  logout: (ctx) => nnmclubLogin.logout(ctx),
  loggedIn: (ctx) => nnmclubLogin.loggedIn(ctx),
  savedLogin: (ctx) => (ctx.secrets ? nnmclubLogin.savedLogin(ctx.secrets) : Promise.resolve(null)),
  loginPending: (ctx) => nnmclubLogin.loginPending(ctx),
  browserLogin: (ctx, o) => nnmclubLogin.browserLogin(ctx, o),
  browserSession: (ctx) => nnmclubLogin.browserSession(ctx),
  browserSpec: () => nnmclubLogin.browserSpec(),
  sessionHosts: () => nnmclubLogin.sessionHosts(),
  sessionPending: (ctx, host) => nnmclubLogin.sessionPending(ctx, host),
};

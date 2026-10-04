import { describe, it, expect, beforeEach } from 'vitest';
import { kinozal, KINOZAL_MIRRORS, KINOZAL_NO_FILE, kinozalHosts, kinozalQuery, parseKinozal } from '../../src/sources/kinozal';
import { createSourceHttp } from '../../src/sources/http';
import type { NativeHttpRequest } from '../../src/sources/http';
import { parseHtml } from '../../src/sources/html';
import { resetMirrors } from '../../src/sources/mirrors';
import { reloadSourcePrefs, setCloudflareBypass } from '../../src/sources/store';
import { isLoginRequired } from '../../src/sources/types';
import { takeStashedFile } from '../../src/api/torrentFiles';
import { siteLoginCode } from '../../src/sources/siteLoginText';
import { tvRequestSource } from '../../src/sources/cloudflareCheck';
import { fakeSite, fixture, page, CLOUDFLARE } from './fakeSite';
import type { HttpCall } from './fakeSite';

const ME = 'https://kinozal.me/';
const GURU = 'https://kinozal.guru/';
const TV = 'https://kinozal.tv/';
// test-only values, not a real account
const CREDS = { 'kinozal.username': 'test-user', 'kinozal.password': 'test-pass' };
const HASH = '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567';
const TORRENT = 'd8:announce3:url4:infod4:name4:teste' + String.fromCharCode(200, 1, 255) + 'e';

function hostOf(url: string): string {
  return url.slice(0, url.indexOf('/', 8) + 1);
}
function pathOf(url: string): string {
  return url.slice(url.indexOf('/', 8) + 1);
}

interface Opts {
  loginPage?: string;
  signedIn?: boolean;
  srv?: string;
  torrent?: string;
  /** Roots that do not connect (DNS block). */
  down?: string[];
  /** Root → root every request of it is redirected to. */
  redirect?: { [from: string]: string };
  /** The login answer keeps the logged-in header of an older session. */
  oldSession?: boolean;
}

/** A Kinozal on every mirror: signed in after a POST of «test-pass» / PASSWORD to takelogin.php. */
function server(opts: Opts = {}) {
  let signedIn = !!opts.signedIn;
  return (c: HttpCall) => {
    const root = hostOf(c.url);
    if (opts.down && opts.down.indexOf(root) >= 0) throw new Error('Unable to resolve host');
    const to = opts.redirect && opts.redirect[root];
    const final = to ? to + pathOf(c.url) : c.url;
    const path = pathOf(final);
    if (c.method === 'POST' && path === 'takelogin.php') {
      // a redirected POST arrives as a GET of the new address: it says nothing about the form
      if (to) return page(fixture('kinozal-guest.html'), final);
      if (opts.loginPage) {
        const body = fixture(opts.loginPage);
        return page(opts.oldSession ? '<a href="/logout.php?hash4u=old">Выход</a>' + body : body, final);
      }
      signedIn = true;
      return page(fixture('kinozal-search.html'), hostOf(final)); // the redirect after a good login
    }
    if (path.indexOf('get_srv_details.php') === 0) return page(signedIn ? (opts.srv === undefined ? fixture('kinozal-srv.html') : opts.srv) : '', final);
    if (path.indexOf('download.php') === 0) return page(signedIn && opts.torrent ? opts.torrent : fixture('kinozal-guest.html'), final);
    if (path === 'my.php' || path.indexOf('browse.php') === 0) return page(fixture(signedIn || opts.oldSession ? 'kinozal-search.html' : 'kinozal-guest.html'), final);
    return page(fixture(signedIn ? 'kinozal-search.html' : 'kinozal-guest.html'), final);
  };
}

beforeEach(() => {
  localStorage.removeItem('tsp.sources');
  reloadSourcePrefs();
  resetMirrors();
});

describe('Kinozal', () => {
  it('is a built-in site behind Cloudflare that needs a login, on Jackett\'s mirrors', () => {
    expect(kinozal.id).toBe('kinozal');
    expect(kinozal.name).toBe('Kinozal');
    expect(kinozal.kind).toBe('builtin');
    expect(kinozal.needsLogin).toBe(true);
    expect(kinozal.cloudflare).toBe(true);
    expect(KINOZAL_MIRRORS).toEqual(['kinozal.me', 'kinozal.guru', 'kinozal.tv']);
    expect(kinozal.siteUrl).toBe(ME);
    expect(kinozal.siteUrls).toEqual([ME, GURU, TV]);
  });

  it('parses the search rows: size, seeders, leechers, dates, category; skips broken rows; no pagination', () => {
    const now = new Date(2026, 9, 4, 12, 0, 0).getTime();
    const list = parseKinozal(parseHtml(fixture('kinozal-search.html')), ME + 'browse.php', now);
    expect(list.map((r) => r.Title)).toEqual([
      'Северный маяк / Northern Lighthouse / 2025 / ДБ / WEB-DL (1080p)',
      'Тихая гавань (1 сезон: 1-8 серии из 8) / 2026 / ЛМ / WEBRip (720p)',
      'Лисья тропа / Fox Trail / 2024 / СТ / BDRip',
      'Звёздный пирог / 2026',
    ]);
    const [a, b, c, d] = list;
    expect(a.source).toBe('kinozal');
    expect(a.Tracker).toBe('Kinozal');
    expect(a.detailUrl).toBe(ME + 'details.php?id=1900001');
    expect(a.Magnet).toBe('');
    expect(a.Size).toBe('7.85 ГБ');
    expect(a.sizeBytes).toBe(Math.round(7.85 * 1024 * 1024 * 1024));
    expect(a.Seed).toBe(153);
    expect(a.Peer).toBe(9);
    expect(a.date).toBe(new Date(2025, 9, 24, 23, 44).getTime());
    expect(a.Categories).toBe('Фильмы');
    expect(b.Seed).toBe(1204);
    expect(b.sizeBytes).toBe(Math.round(12.4 * 1024 * 1024 * 1024));
    expect(b.date).toBe(new Date(2026, 9, 4, 21, 40).getTime());
    expect(b.Categories).toBe('Сериалы');
    expect(c.date).toBe(new Date(2026, 9, 3, 8, 5).getTime());
    expect(c.Categories).toBe('Аниме');
    expect(c.sizeBytes).toBe(700 * 1024 * 1024);
    expect(d.sizeBytes).toBeUndefined();
    expect(d.Seed).toBe(0);
    expect(d.date).toBe(now);
    expect(d.Categories).toBe('');
    expect(parseKinozal(parseHtml('<html><body><p>Ничего не найдено</p></body></html>'), ME)).toEqual([]);
  });

  it('normalizes the query like Jackett', () => {
    expect(kinozalQuery('Маяк: часть 2 — финал!')).toBe('Маяк часть 2 финал');
    expect(kinozalQuery('Гавань S01')).toBe('Гавань 1');
    expect(kinozalQuery('Гавань S01E02')).toBe('Гавань 1 2');
    expect(kinozalQuery('ёж-2025')).toBe('ёж 2025');
  });

  it('searches with a normalized windows-1251 query and every request carries the site options', async () => {
    const site = fakeSite(server({ signedIn: true }), CREDS);
    const list = await kinozal.search('маяк: 2025', site.ctx);
    expect(list).toHaveLength(4);
    expect(site.calls).toHaveLength(1);
    expect(site.calls[0].url).toBe(ME + 'browse.php?s=%EC%E0%FF%EA%202025&g=0&c=0&v=0&d=0&w=0&t=0&f=0');
    expect(site.calls[0].opts).toEqual({ siteName: 'Kinozal' });
    setCloudflareBypass('kinozal', true);
    await kinozal.search('маяк', site.ctx);
    expect(site.calls[1].opts).toEqual({ siteName: 'Kinozal', cloudflare: true });
  });

  it('a mirror that does not connect falls back to the next one, which is remembered', async () => {
    const site = fakeSite(server({ signedIn: true, down: [ME] }), CREDS);
    const list = await kinozal.search('маяк', site.ctx);
    expect(site.calls.map((c) => hostOf(c.url))).toEqual([ME, GURU]);
    expect(list[0].detailUrl).toBe(GURU + 'details.php?id=1900001');
    expect(kinozalHosts.host()).toBe('kinozal.guru');
    expect(kinozal.siteUrl).toBe(GURU);
    await kinozal.search('маяк', site.ctx);
    expect(hostOf(site.calls[2].url)).toBe(GURU);
    // every mirror down: the first error
    const dead = fakeSite(server({ down: [ME, GURU, TV] }), CREDS);
    await expect(kinozal.search('маяк', dead.ctx)).rejects.toThrow('Unable to resolve host');
  });

  it('a Cloudflare check never switches the mirror', async () => {
    const site = fakeSite((c) => page(CLOUDFLARE, c.url, 403), CREDS);
    await expect(kinozal.search('маяк', site.ctx)).rejects.toThrow('Cloudflare');
    expect(site.calls).toHaveLength(1);
    expect(kinozalHosts.host()).toBe('kinozal.me');
  });

  it('a redirect to another mirror makes it active; its results resolve; the login is sent again there, never the redirected GET', async () => {
    const redirect = { [ME]: GURU };
    const site = fakeSite(server({ redirect }), CREDS);
    const list = await kinozal.search('маяк', site.ctx);
    expect(kinozalHosts.host()).toBe('kinozal.guru');
    expect(list[0].detailUrl).toBe(GURU + 'details.php?id=1900001');
    // browse (redirected, signed out) → POST to .guru (the active one now) → browse on .guru
    expect(site.calls.map((c) => c.method + ' ' + c.url.split('?')[0])).toEqual([
      'GET ' + ME + 'browse.php',
      'POST ' + GURU + 'takelogin.php',
      'GET ' + GURU + 'browse.php',
    ]);
    const link = await kinozal.resolve!(list[0], site.ctx);
    expect(link.indexOf('magnet:?xt=urn:btih:' + HASH)).toBe(0);
    // a login form posted to a mirror that redirects is posted again on the new mirror
    resetMirrors();
    const post = fakeSite(server({ redirect }));
    await kinozal.login!('kino', 'test-pass', post.ctx);
    expect(post.calls.map((c) => c.method + ' ' + c.url)).toEqual(['POST ' + ME + 'takelogin.php', 'POST ' + GURU + 'takelogin.php']);
    expect(post.secrets).toEqual({ 'kinozal.username': 'kino', 'kinozal.password': 'test-pass' });
  });

  it('results from another mirror resolve on the active one; other hosts are refused', async () => {
    const site = fakeSite(server({ signedIn: true }), CREDS);
    const r = parseKinozal(parseHtml(fixture('kinozal-search.html')), TV)[0];
    expect(r.detailUrl).toBe(TV + 'details.php?id=1900001');
    await kinozal.resolve!(r, site.ctx);
    expect(site.calls.map((c) => c.url)).toEqual([ME + 'get_srv_details.php?id=1900001&action=2']);
    await expect(kinozal.resolve!({ ...r, detailUrl: 'https://example.com/details.php?id=1' }, site.ctx)).rejects.toThrow('Неверный адрес');
  });

  it('a TV check request may name any mirror of the site', () => {
    setCloudflareBypass('kinozal', true);
    expect(tvRequestSource(TV, [kinozal])).toBe(kinozal);
    expect(tvRequestSource(GURU, [kinozal])).toBe(kinozal);
    expect(tvRequestSource('https://kinozal.example/', [kinozal])).toBeNull();
  });

  it('signs in with a windows-1251 form (also through the native layer) and stores the login only after the site accepted it', async () => {
    const site = fakeSite(server());
    expect(await kinozal.loggedIn!(site.ctx)).toBe(false);
    await kinozal.login!(' Киноман ', 'пароль 1', site.ctx);
    expect(site.calls[0]).toMatchObject({ method: 'POST', url: ME + 'takelogin.php', form: { username: 'Киноман', password: 'пароль 1' } });
    expect(site.calls[0].opts).toEqual({ siteName: 'Kinozal', formCharset: 'windows-1251' });
    expect(site.secrets).toEqual({ 'kinozal.username': 'Киноман', 'kinozal.password': 'пароль 1' });
    expect(await kinozal.loggedIn!(site.ctx)).toBe(true);

    const reqs: NativeHttpRequest[] = [];
    const http = createSourceHttp((req) => {
      reqs.push(req);
      return Promise.resolve({ status: 200, url: ME, text: fixture('kinozal-search.html') });
    }, undefined, () => null);
    const store = fakeSite(server()).ctx.secrets!;
    await kinozal.login!('Киноман', 'p', { http, client: null, secrets: store });
    expect(reqs[0]).toMatchObject({ method: 'POST', url: ME + 'takelogin.php', formCharset: 'windows-1251', form: { username: 'Киноман', password: 'p' } });
  });

  it('a wrong password is refused even while an older session is still valid; nothing is stored', async () => {
    const site = fakeSite(server({ loginPage: 'kinozal-login-error.html' }));
    const e = await kinozal.login!('u', 'bad', site.ctx).then(() => null, (x: unknown) => x);
    expect((e as Error).message).toBe('Неверный логин или пароль');
    expect(siteLoginCode(e)).toBe('bad_login');
    expect(site.secrets).toEqual({});
    // the logged-in header of an older session on the refusal page
    const old = fakeSite(server({ loginPage: 'kinozal-login-error.html', oldSession: true }), CREDS);
    expect(siteLoginCode(await kinozal.login!('u', 'bad', old.ctx).then(() => null, (x: unknown) => x))).toBe('bad_login');
    expect(old.secrets).toEqual(CREDS);
    // the same for a login staged by a transfer: never «ok», so the native side never promotes it
    const tv = fakeSite(server({ loginPage: 'kinozal-login-error.html', oldSession: true }), { 'kinozal.pending.username': 'a', 'kinozal.pending.password': 'b' });
    expect(siteLoginCode(await kinozal.loginPending!(tv.ctx).then(() => null, (x: unknown) => x))).toBe('bad_login');
    // still on the login page with the old header and no refusal markup: refused too
    const still = fakeSite(server({ loginPage: 'kinozal-guest.html', oldSession: true }), CREDS);
    await expect(kinozal.login!('u', 'bad', still.ctx)).rejects.toThrow('Неверный логин или пароль');
    expect(still.calls).toHaveLength(1);
  });

  it('an answer away from the login page that is not conclusive is decided by my.php', async () => {
    const site = fakeSite((c: HttpCall) => {
      if (c.method === 'POST') return page('<html><body>Перенаправление…</body></html>', ME + 'index.php');
      return page(fixture('kinozal-guest.html'), c.url);
    });
    await expect(kinozal.login!('u', 'p', site.ctx)).rejects.toThrow('Неверный логин или пароль');
    expect(site.calls.map((c) => c.url)).toEqual([ME + 'takelogin.php', ME + 'my.php']);
  });

  it('a captcha (classic or Turnstile widget) asks to sign in in the browser', async () => {
    const captcha = '<html><body><form action="/takelogin.php"><img src="/captcha.php?r=1"><input name="captcha"></form></body></html>';
    const site = fakeSite((c) => page(captcha, c.url));
    const e = await kinozal.login!('u', 'p', site.ctx).then(() => null, (x: unknown) => x);
    expect((e as Error).message).toBe('Kinozal просит капчу — войдите на сайте в браузере и попробуйте снова');
    expect(siteLoginCode(e)).toBe('captcha');
    const turnstile = fakeSite((c) => page('<form><div class="cf-turnstile" data-sitekey="x"></div></form>', c.url));
    expect(siteLoginCode(await kinozal.login!('u', 'p', turnstile.ctx).then(() => null, (x: unknown) => x))).toBe('captcha');
    expect(site.secrets).toEqual({});
  });

  it('reports Cloudflare, empty fields and a missing secret store', async () => {
    await expect(kinozal.login!('u', 'p', fakeSite((c) => page(CLOUDFLARE, c.url, 403)).ctx)).rejects.toThrow('Cloudflare');
    const site = fakeSite(server());
    await expect(kinozal.login!(' ', 'p', site.ctx)).rejects.toThrow('Введите логин и пароль');
    await expect(kinozal.login!('u', '', site.ctx)).rejects.toThrow('Введите логин и пароль');
    const bare = fakeSite(server(), null);
    await expect(kinozal.login!('u', 'p', bare.ctx)).rejects.toThrow('Вход доступен только в приложении Android');
    expect(site.calls.length + bare.calls.length).toBe(0);
  });

  it('an expired session signs in again once with the saved login; without one the search needs a login', async () => {
    const site = fakeSite(server(), CREDS);
    expect(await kinozal.search('маяк', site.ctx)).toHaveLength(4);
    expect(site.calls.map((c) => c.method + ' ' + c.url.split('?')[0])).toEqual(['GET ' + ME + 'browse.php', 'POST ' + ME + 'takelogin.php', 'GET ' + ME + 'browse.php']);
    expect(site.calls[1].form).toEqual({ username: 'test-user', password: 'test-pass' });
    expect(isLoginRequired(await kinozal.search('маяк', fakeSite(server()).ctx).then(() => null, (x: unknown) => x))).toBe(true);
    const refused = fakeSite(server({ loginPage: 'kinozal-login-error.html' }), CREDS);
    expect(isLoginRequired(await kinozal.search('маяк', refused.ctx).then(() => null, (x: unknown) => x))).toBe(true);
  });

  it('resolves a magnet from get_srv_details through the session; without a saved login it needs one', async () => {
    const site = fakeSite(server({ signedIn: true }), CREDS);
    const r = parseKinozal(parseHtml(fixture('kinozal-search.html')), ME)[0];
    expect(await kinozal.resolve!(r, site.ctx)).toBe('magnet:?xt=urn:btih:' + HASH + '&dn=' + encodeURIComponent(r.Title));
    expect(site.calls.map((c) => c.url)).toEqual([ME + 'get_srv_details.php?id=1900001&action=2']);
    expect(site.calls[0].opts).toEqual({ siteName: 'Kinozal' });
    expect(isLoginRequired(await kinozal.resolve!(r, fakeSite(server({ signedIn: true })).ctx).then(() => null, (x: unknown) => x))).toBe(true);
  });

  it('an answer without a hash that is not signed out goes straight to the .torrent (no sign-in per add)', async () => {
    const site = fakeSite(server({ signedIn: true, srv: '<ul><li>нет</li></ul>', torrent: TORRENT }), CREDS);
    const r = parseKinozal(parseHtml(fixture('kinozal-search.html')), ME)[0];
    const link = await kinozal.resolve!(r, site.ctx);
    expect(link.indexOf('omp-file:')).toBe(0);
    expect(takeStashedFile(link)![TORRENT.length - 2]).toBe(255);
    expect(site.calls.map((c) => c.method + ' ' + c.url)).toEqual(['GET ' + ME + 'get_srv_details.php?id=1900001&action=2', 'GET ' + ME + 'download.php?id=1900001']);
    expect(site.calls[1].opts).toEqual({ siteName: 'Kinozal', responseCharset: 'iso-8859-1' });
  });

  it('a signed-out answer signs in again once, then the hash; an HTML .torrent answer is an error', async () => {
    const r = parseKinozal(parseHtml(fixture('kinozal-search.html')), ME)[0];
    // signed out: get_srv_details is empty; the download page is the login form
    const signedOutSite = fakeSite((c: HttpCall) => {
      if (c.method === 'POST') return page(fixture('kinozal-search.html'), ME);
      if (c.url.indexOf('get_srv_details') >= 0) return page(fixture('kinozal-guest.html'), ME + 'login.php');
      return page(fixture('kinozal-guest.html'), c.url);
    }, CREDS);
    await expect(kinozal.resolve!(r, signedOutSite.ctx)).rejects.toThrow(KINOZAL_NO_FILE);
    expect(signedOutSite.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('logout forgets the cookies of every mirror and the saved login', async () => {
    const site = fakeSite(server(), CREDS);
    await kinozal.logout!(site.ctx);
    expect(site.cleared).toEqual([ME, GURU, TV]);
    expect(site.secrets).toEqual({});
  });

  it('checks a login staged by a transfer without storing it', async () => {
    const site = fakeSite(server(), { 'kinozal.pending.username': 'tv-user', 'kinozal.pending.password': 'tv-pass' });
    await kinozal.loginPending!(site.ctx);
    expect(site.calls[0].form).toEqual({ username: 'tv-user', password: 'tv-pass' });
    expect(site.secrets).toEqual({ 'kinozal.pending.username': 'tv-user', 'kinozal.pending.password': 'tv-pass' });
    await expect(kinozal.loginPending!(fakeSite(server()).ctx)).rejects.toThrow('Введите логин и пароль');
    expect(await kinozal.savedLogin!(fakeSite(server(), CREDS).ctx)).toEqual({ username: 'test-user', password: 'test-pass' });
  });
});

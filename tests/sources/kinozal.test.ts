import { describe, it, expect, beforeEach } from 'vitest';
import { kinozal, KINOZAL_NO_FILE, parseKinozal } from '../../src/sources/kinozal';
import { createSourceHttp } from '../../src/sources/http';
import type { NativeHttpRequest } from '../../src/sources/http';
import { parseHtml } from '../../src/sources/html';
import { reloadSourcePrefs, setCloudflareBypass } from '../../src/sources/store';
import { isLoginRequired } from '../../src/sources/types';
import { takeStashedFile } from '../../src/api/torrentFiles';
import { siteLoginCode } from '../../src/sources/siteLoginText';
import { fakeSite, fixture, page, CLOUDFLARE } from './fakeSite';
import type { HttpCall } from './fakeSite';

const BASE = 'https://kinozal.tv/';
const LOGIN_URL = BASE + 'takelogin.php';
const MY = BASE + 'my.php';
// test-only values, not a real account
const CREDS = { 'kinozal.username': 'test-user', 'kinozal.password': 'test-pass' };
const HASH = '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567';

/** A Kinozal that is signed in after a successful POST to takelogin.php. */
function server(opts: { loginPage?: string; signedIn?: boolean; srv?: string; torrent?: string } = {}) {
  let signedIn = !!opts.signedIn;
  return (c: HttpCall) => {
    if (c.method === 'POST' && c.url === LOGIN_URL) {
      if (opts.loginPage) return page(fixture(opts.loginPage), LOGIN_URL);
      signedIn = true;
      return page(fixture('kinozal-search.html'), BASE); // any signed-in page after the redirect
    }
    if (c.url.indexOf(BASE + 'get_srv_details.php') === 0) return page(signedIn ? (opts.srv === undefined ? fixture('kinozal-srv.html') : opts.srv) : '', c.url);
    if (c.url.indexOf(BASE + 'download.php') === 0) return page(signedIn && opts.torrent ? opts.torrent : fixture('kinozal-guest.html'), c.url);
    if (!signedIn) return page(fixture('kinozal-guest.html'), c.url);
    return page(fixture('kinozal-search.html'), c.url);
  };
}

beforeEach(() => {
  localStorage.removeItem('tsp.sources');
  reloadSourcePrefs();
});

describe('Kinozal', () => {
  it('is a built-in site behind Cloudflare that needs a login', () => {
    expect(kinozal.id).toBe('kinozal');
    expect(kinozal.name).toBe('Kinozal');
    expect(kinozal.kind).toBe('builtin');
    expect(kinozal.needsLogin).toBe(true);
    expect(kinozal.cloudflare).toBe(true);
    expect(kinozal.siteUrl).toBe(BASE);
  });

  it('parses the search rows: size, seeders, leechers, dates, category; skips broken rows; no pagination', () => {
    const now = new Date(2026, 9, 4, 12, 0, 0).getTime();
    const list = parseKinozal(parseHtml(fixture('kinozal-search.html')), BASE + 'browse.php', now);
    expect(list.map((r) => r.Title)).toEqual([
      'Северный маяк / Northern Lighthouse / 2025 / ДБ / WEB-DL (1080p)',
      'Тихая гавань (1 сезон: 1-8 серии из 8) / 2026 / ЛМ / WEBRip (720p)',
      'Лисья тропа / Fox Trail / 2024 / СТ / BDRip',
      'Звёздный пирог / 2026',
    ]);
    const [a, b, c, d] = list;
    expect(a.source).toBe('kinozal');
    expect(a.Tracker).toBe('Kinozal');
    expect(a.detailUrl).toBe(BASE + 'details.php?id=1900001');
    expect(a.Link).toBe(a.detailUrl);
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
    // missing fields: no size, no seeders, «сейчас»
    expect(d.sizeBytes).toBeUndefined();
    expect(d.Seed).toBe(0);
    expect(d.date).toBe(now);
    expect(d.Categories).toBe('');
    expect(parseKinozal(parseHtml('<html><body><p>Ничего не найдено</p></body></html>'), BASE)).toEqual([]);
  });

  it('searches with a windows-1251 query and every request carries the site options', async () => {
    const site = fakeSite(server({ signedIn: true }), CREDS);
    const list = await kinozal.search('маяк 2025', site.ctx);
    expect(list).toHaveLength(4);
    expect(site.calls).toHaveLength(1);
    expect(site.calls[0].url).toBe(BASE + 'browse.php?s=%EC%E0%FF%EA%202025&g=0&c=0&v=0&d=0&w=0&t=0&f=0');
    expect(site.calls[0].opts).toEqual({ siteName: 'Kinozal' });
    // with «Обходить проверку Cloudflare» on, the request asks for the pass
    setCloudflareBypass('kinozal', true);
    await kinozal.search('маяк', site.ctx);
    expect(site.calls[1].opts).toEqual({ siteName: 'Kinozal', cloudflare: true });
  });

  it('signs in with a windows-1251 form (also through the native layer) and stores the login only after the site accepted it', async () => {
    const site = fakeSite(server());
    expect(await kinozal.loggedIn!(site.ctx)).toBe(false);
    await kinozal.login!(' Киноман ', 'пароль 1', site.ctx);
    expect(site.calls[0]).toMatchObject({ method: 'POST', url: LOGIN_URL, form: { username: 'Киноман', password: 'пароль 1' } });
    expect(site.calls[0].opts).toEqual({ siteName: 'Kinozal', formCharset: 'windows-1251' });
    expect(site.secrets).toEqual({ 'kinozal.username': 'Киноман', 'kinozal.password': 'пароль 1' });
    expect(await kinozal.loggedIn!(site.ctx)).toBe(true);

    // the native plugin gets the charset of the form and returns the page already decoded (windows-1251 → UTF-8)
    const reqs: NativeHttpRequest[] = [];
    const http = createSourceHttp((req) => {
      reqs.push(req);
      return Promise.resolve({ status: 200, url: BASE, text: fixture('kinozal-search.html') });
    }, undefined, () => null);
    const store = fakeSite(server()).ctx.secrets!;
    await kinozal.login!('Киноман', 'p', { http, client: null, secrets: store });
    expect(reqs[0]).toMatchObject({ method: 'POST', url: LOGIN_URL, formCharset: 'windows-1251', form: { username: 'Киноман', password: 'p' } });
  });

  it('rejects a wrong password (refusal page, or a check page that is not signed in) and stores nothing', async () => {
    const site = fakeSite(server({ loginPage: 'kinozal-login-error.html' }));
    const e = await kinozal.login!('u', 'bad', site.ctx).then(() => null, (x: unknown) => x);
    expect((e as Error).message).toBe('Неверный логин или пароль');
    expect(siteLoginCode(e)).toBe('bad_login');
    expect(site.calls).toHaveLength(1);
    expect(site.secrets).toEqual({});
    // an answer that is neither: my.php decides
    const other = fakeSite(server({ loginPage: 'kinozal-guest.html' }));
    await expect(kinozal.login!('u', 'bad', other.ctx)).rejects.toThrow('Неверный логин или пароль');
    expect(other.calls.map((c) => c.url)).toEqual([LOGIN_URL, MY]);
    expect(other.secrets).toEqual({});
  });

  it('a captcha asks to sign in in the browser (no captcha solving)', async () => {
    const captcha = '<html><body><form action="/takelogin.php"><img src="/captcha.php?r=1"><input name="captcha"></form></body></html>';
    const site = fakeSite((c) => page(captcha, c.url));
    const e = await kinozal.login!('u', 'p', site.ctx).then(() => null, (x: unknown) => x);
    expect((e as Error).message).toBe('Kinozal просит капчу — войдите на сайте в браузере и попробуйте снова');
    expect(siteLoginCode(e)).toBe('captcha');
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
    const list = await kinozal.search('маяк', site.ctx);
    expect(list).toHaveLength(4);
    expect(site.calls.map((c) => c.method + ' ' + c.url.split('?')[0])).toEqual([
      'GET ' + BASE + 'browse.php',
      'POST ' + LOGIN_URL,
      'GET ' + BASE + 'browse.php',
    ]);
    expect(site.calls[1].form).toEqual({ username: 'test-user', password: 'test-pass' });
    const none = fakeSite(server());
    const e = await kinozal.search('маяк', none.ctx).then(() => null, (x: unknown) => x);
    expect(isLoginRequired(e)).toBe(true);
    // saved login refused now: the user has to act
    const refused = fakeSite(server({ loginPage: 'kinozal-login-error.html' }), CREDS);
    expect(isLoginRequired(await kinozal.search('маяк', refused.ctx).then(() => null, (x: unknown) => x))).toBe(true);
  });

  it('resolves a magnet from get_srv_details (signed in), never off the site', async () => {
    const site = fakeSite(server({ signedIn: true }), CREDS);
    const r = parseKinozal(parseHtml(fixture('kinozal-search.html')), BASE)[0];
    const link = await kinozal.resolve!(r, site.ctx);
    expect(link).toBe('magnet:?xt=urn:btih:' + HASH + '&dn=' + encodeURIComponent(r.Title));
    expect(site.calls.map((c) => c.url)).toEqual([BASE + 'get_srv_details.php?id=1900001&action=2']);
    expect(site.calls[0].opts).toEqual({ siteName: 'Kinozal' });
    await expect(kinozal.resolve!({ ...r, detailUrl: 'https://example.com/details.php?id=1' }, site.ctx)).rejects.toThrow('Неверный адрес');
    // no saved login: «нужен вход»
    const guest = fakeSite(server({ signedIn: true }));
    expect(isLoginRequired(await kinozal.resolve!(r, guest.ctx).then(() => null, (x: unknown) => x))).toBe(true);
  });

  it('without a hash signs in again, then takes the .torrent through the session; an HTML answer is an error', async () => {
    const torrent = 'd8:announce3:url4:infod4:name4:teste' + String.fromCharCode(200, 1, 255) + 'e';
    const site = fakeSite(server({ signedIn: true, srv: '<ul><li>нет</li></ul>', torrent }), CREDS);
    const r = parseKinozal(parseHtml(fixture('kinozal-search.html')), BASE)[0];
    const link = await kinozal.resolve!(r, site.ctx);
    expect(link.indexOf('omp-file:')).toBe(0);
    const bytes = takeStashedFile(link)!;
    expect(bytes[bytes.length - 2]).toBe(255);
    const urls = site.calls.map((c) => c.method + ' ' + c.url);
    expect(urls).toEqual([
      'GET ' + BASE + 'get_srv_details.php?id=1900001&action=2',
      'POST ' + LOGIN_URL,
      'GET ' + BASE + 'get_srv_details.php?id=1900001&action=2',
      'GET ' + BASE + 'download.php?id=1900001',
    ]);
    expect(site.calls[3].opts).toEqual({ siteName: 'Kinozal', responseCharset: 'iso-8859-1' });
    const html = fakeSite(server({ signedIn: true, srv: '' }), CREDS);
    await expect(kinozal.resolve!(r, html.ctx)).rejects.toThrow(KINOZAL_NO_FILE);
  });

  it('logout forgets the cookies and the saved login', async () => {
    const site = fakeSite(server(), CREDS);
    await kinozal.logout!(site.ctx);
    expect(site.cleared).toEqual([BASE]);
    expect(site.secrets).toEqual({});
  });

  it('checks a login staged by a transfer without storing it', async () => {
    const site = fakeSite(server(), { 'kinozal.pending.username': 'tv-user', 'kinozal.pending.password': 'tv-pass' });
    await kinozal.loginPending!(site.ctx);
    expect(site.calls[0].form).toEqual({ username: 'tv-user', password: 'tv-pass' });
    expect(site.secrets).toEqual({ 'kinozal.pending.username': 'tv-user', 'kinozal.pending.password': 'tv-pass' });
    await expect(kinozal.loginPending!(fakeSite(server()).ctx)).rejects.toThrow('Введите логин и пароль');
    const bad = fakeSite(server({ loginPage: 'kinozal-login-error.html' }), { 'kinozal.pending.username': 'a', 'kinozal.pending.password': 'b' });
    expect(siteLoginCode(await kinozal.loginPending!(bad.ctx).then(() => null, (x: unknown) => x))).toBe('bad_login');
    expect(await kinozal.savedLogin!(fakeSite(server(), CREDS).ctx)).toEqual({ username: 'test-user', password: 'test-pass' });
  });
});

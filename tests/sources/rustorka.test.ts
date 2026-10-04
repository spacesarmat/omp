import { describe, it, expect, beforeEach } from 'vitest';
import { parseRustorka, rustorka, RUSTORKA_NO_FILE } from '../../src/sources/rustorka';
import { parseHtml } from '../../src/sources/html';
import { reloadSourcePrefs, setCloudflareBypass } from '../../src/sources/store';
import { isLoginRequired } from '../../src/sources/types';
import { takeStashedFile } from '../../src/api/torrentFiles';
import { siteLoginCode } from '../../src/sources/siteLoginText';
import { fakeSite, fixture, page, CLOUDFLARE } from './fakeSite';
import type { HttpCall } from './fakeSite';

const FORUM = 'https://rustorka.com/forum/';
const LOGIN_URL = FORUM + 'login.php';
// test-only values, not a real account
const CREDS = { 'rustorka.username': 'test-user', 'rustorka.password': 'test-pass' };
const TORRENT = 'd8:announce3:url4:infod4:name4:teste' + String.fromCharCode(200, 1, 255) + 'e';

function server(opts: { loginPage?: string; signedIn?: boolean; file?: boolean; expired?: number } = {}) {
  let signedIn = !!opts.signedIn;
  return (c: HttpCall) => {
    if (c.method === 'POST' && c.url === LOGIN_URL) {
      if (opts.loginPage) return page(fixture(opts.loginPage), LOGIN_URL);
      signedIn = true;
      return page(fixture('rustorka-topic.html'), FORUM + 'index.php');
    }
    if (c.url.indexOf(FORUM + 'download.php') === 0) return page(signedIn && opts.file !== false ? TORRENT : fixture('rustorka-guest.html'), c.url);
    if (!signedIn) return page(fixture('rustorka-guest.html'), c.url);
    if (c.url.indexOf(FORUM + 'viewtopic.php') === 0) return page(fixture('rustorka-topic.html'), c.url);
    if (c.url.indexOf(FORUM + 'index.php') === 0) return page(fixture('rustorka-topic.html'), c.url);
    return page(fixture('rustorka-search.html'), c.url);
  };
}

beforeEach(() => {
  localStorage.removeItem('tsp.sources');
  reloadSourcePrefs();
});

describe('rustorka', () => {
  it('is a built-in site behind Cloudflare that needs a login', () => {
    expect(rustorka.id).toBe('rustorka');
    expect(rustorka.kind).toBe('builtin');
    expect(rustorka.needsLogin).toBe(true);
    expect(rustorka.cloudflare).toBe(true);
    expect(rustorka.siteUrl).toBe('https://rustorka.com/');
  });

  it('parses the tracker rows (bytes and unix dates from <u>, missing fields, rows on moderation skipped)', () => {
    const list = parseRustorka(parseHtml(fixture('rustorka-search.html')), FORUM + 'tracker.php');
    expect(list.map((r) => r.Title)).toEqual([
      'Северный маяк / Northern Lighthouse (2025) WEB-DL 1080p',
      'Тихая гавань (Сезон 1, серии 1-8 из 8) WEBRip 720p',
    ]);
    const [a, b] = list;
    expect(a.source).toBe('rustorka');
    expect(a.detailUrl).toBe(FORUM + 'viewtopic.php?t=5001');
    expect(a.Link).toBe(FORUM + 'download.php?id=7001');
    expect(a.Categories).toBe('Фильмы 2025');
    expect(a.Size).toBe('7.85 GB');
    expect(a.sizeBytes).toBe(8428932710);
    expect(a.Seed).toBe(153);
    expect(a.Peer).toBe(9);
    expect(a.date).toBe(1759500000 * 1000);
    expect(b.Seed).toBe(1204);
    expect(b.sizeBytes).toBe(Math.round(12.4 * 1024 * 1024 * 1024));
    expect(b.date).toBeUndefined();
    expect(parseRustorka(parseHtml('<table><tr><td>пусто</td></tr></table>'), FORUM)).toEqual([]);
  });

  it('searches with a windows-1251 query; an expired session signs in again once', async () => {
    const site = fakeSite(server(), CREDS);
    const list = await rustorka.search('маяк', site.ctx);
    expect(list).toHaveLength(2);
    expect(site.calls.map((c) => c.method + ' ' + c.url)).toEqual([
      'GET ' + FORUM + 'tracker.php?nm=%EC%E0%FF%EA&f%5B%5D=-1&o=1&s=2&tm=-1',
      'POST ' + LOGIN_URL,
      'GET ' + FORUM + 'tracker.php?nm=%EC%E0%FF%EA&f%5B%5D=-1&o=1&s=2&tm=-1',
    ]);
    expect(site.calls[1].form).toEqual({ login_username: 'test-user', login_password: 'test-pass', login: 'Вход' });
    expect(site.calls[1].opts).toEqual({ siteName: 'rustorka', formCharset: 'windows-1251' });
    setCloudflareBypass('rustorka', true);
    await rustorka.search('маяк', site.ctx);
    expect(site.calls[3].opts).toEqual({ siteName: 'rustorka', cloudflare: true });
    expect(isLoginRequired(await rustorka.search('маяк', fakeSite(server()).ctx).then(() => null, (x: unknown) => x))).toBe(true);
  });

  it('login: ok stores, a wrong password and a captcha store nothing', async () => {
    const ok = fakeSite(server());
    await rustorka.login!('user', 'pass', ok.ctx);
    expect(ok.secrets).toEqual({ 'rustorka.username': 'user', 'rustorka.password': 'pass' });
    const bad = fakeSite(server({ loginPage: 'rustorka-guest.html' }));
    const e = await rustorka.login!('user', 'bad', bad.ctx).then(() => null, (x: unknown) => x);
    expect(siteLoginCode(e)).toBe('bad_login');
    expect((e as Error).message).toBe('Неверный логин или пароль');
    expect(bad.calls).toHaveLength(1);
    expect(bad.secrets).toEqual({});
    const cap = fakeSite(server({ loginPage: 'rustorka-login-captcha.html' }));
    await expect(rustorka.login!('user', 'p', cap.ctx)).rejects.toThrow('rustorka просит капчу — войдите на сайте в браузере и попробуйте снова');
    expect(cap.secrets).toEqual({});
    await expect(rustorka.login!('u', 'p', fakeSite((c) => page(CLOUDFLARE, c.url, 403)).ctx)).rejects.toThrow('Cloudflare');
  });

  it('resolves the .torrent through the session (stashed for the upload), only from rustorka', async () => {
    const site = fakeSite(server({ signedIn: true }), CREDS);
    const r = parseRustorka(parseHtml(fixture('rustorka-search.html')), FORUM)[0];
    const link = await rustorka.resolve!(r, site.ctx);
    expect(link.indexOf('omp-file:')).toBe(0);
    expect(takeStashedFile(link)!.length).toBe(TORRENT.length);
    expect(site.calls.map((c) => c.url)).toEqual([FORUM + 'download.php?id=7001']);
    expect(site.calls[0].opts).toEqual({ siteName: 'rustorka', responseCharset: 'iso-8859-1' });
    await expect(rustorka.resolve!({ ...r, Link: 'https://evil.example/download.php?id=1' }, site.ctx)).rejects.toThrow('Неверный адрес');
    expect(isLoginRequired(await rustorka.resolve!(r, fakeSite(server({ signedIn: true })).ctx).then(() => null, (x: unknown) => x))).toBe(true);
  });

  it('an expired session signs in again for the file; without a file the topic magnet is used', async () => {
    const site = fakeSite(server(), CREDS);
    const r = parseRustorka(parseHtml(fixture('rustorka-search.html')), FORUM)[0];
    const link = await rustorka.resolve!(r, site.ctx);
    expect(link.indexOf('omp-file:')).toBe(0);
    expect(site.calls.map((c) => c.method + ' ' + c.url)).toEqual(['GET ' + FORUM + 'download.php?id=7001', 'POST ' + LOGIN_URL, 'GET ' + FORUM + 'download.php?id=7001']);
    const noFile = fakeSite(server({ signedIn: true, file: false }), CREDS);
    expect(await rustorka.resolve!(r, noFile.ctx)).toBe('magnet:?xt=urn:btih:0a1b2c3d4e5f60718293a4b5c6d7e8f901234567&dn=northern');
    // no magnet either
    const none = fakeSite((c: HttpCall) => {
      if (c.method === 'POST') return page(fixture('rustorka-topic.html'), FORUM);
      if (c.url.indexOf('viewtopic') >= 0) return page('<a href="./login.php?logout=1">Выход</a>', c.url);
      return page(fixture('rustorka-guest.html'), c.url);
    }, CREDS);
    await expect(rustorka.resolve!(r, none.ctx)).rejects.toThrow(RUSTORKA_NO_FILE);
  });

  it('logout and the staged login of a transfer', async () => {
    const site = fakeSite(server(), { ...CREDS, 'rustorka.pending.username': 'tv', 'rustorka.pending.password': 'tvp' });
    await rustorka.loginPending!(site.ctx);
    expect(site.calls[0].form).toEqual({ login_username: 'tv', login_password: 'tvp', login: 'Вход' });
    await rustorka.logout!(site.ctx);
    expect(site.cleared).toEqual([FORUM]);
    expect(site.secrets).toEqual({ 'rustorka.pending.username': 'tv', 'rustorka.pending.password': 'tvp' });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { nnmclub, nnmclubHosts } from '../../src/sources/nnmclub';
import { resetMirrors } from '../../src/sources/mirrors';
import { reloadSourcePrefs, setCloudflareBypass } from '../../src/sources/store';
import { siteLoginCode } from '../../src/sources/siteLoginText';
import { fakeSite, fixture, page, CLOUDFLARE } from './fakeSite';
import type { HttpCall } from './fakeSite';

const FORUM = 'https://nnmclub.to/forum/';
const LOGIN_URL = FORUM + 'login.php';
// test-only values, not a real account
const PASS = 'pa55-test-only';
const CREDS = { 'nnmclub.username': 'test-user', 'nnmclub.password': 'test-pass' };
/** phpBB 2 header of a signed-in user (synthesized; the real markup is checked on a device, Task 12). */
const SIGNED_IN = '<html><body><a href="login.php?logout=true&amp;sid=1">Выход [ test-user ]</a></body></html>';
/** The login page again after a wrong password (synthesized). */
const LOGIN_PAGE =
  '<html><body><form action="login.php" method="post"><input name="username"><input type="password" name="password"><input type="submit" name="login" value="Вход"></form></body></html>';
const CAPTCHA_PAGE = '<html><body><form action="login.php" method="post"><img src="//captcha.nnmclub.to/c.png"><input name="cap_code_1"></form></body></html>';

/** NNM-Club: the login accepts PASS and the staged «tvp» only; the tracker and the topics are open to guests. */
function server(opts: { loginPage?: string } = {}) {
  return (c: HttpCall) => {
    if (c.method === 'POST' && c.url === LOGIN_URL) {
      if (opts.loginPage) return page(opts.loginPage, LOGIN_URL);
      return c.form!.password === PASS || c.form!.password === 'tvp' ? page(SIGNED_IN, FORUM + 'index.php') : page(LOGIN_PAGE, LOGIN_URL);
    }
    if (c.url.indexOf(FORUM + 'tracker.php') === 0) return page(fixture('nnmclub-search.html'), c.url);
    if (c.url.indexOf(FORUM + 'viewtopic.php') === 0) return page(fixture('nnmclub-detail.html'), c.url);
    return page(LOGIN_PAGE, c.url);
  };
}

beforeEach(() => {
  localStorage.removeItem('tsp.sources');
  reloadSourcePrefs();
  resetMirrors();
});

describe('nnmclub', () => {
  it('is a built-in site behind Cloudflare whose login is optional', () => {
    expect(nnmclub.id).toBe('nnmclub');
    expect(nnmclub.name).toBe('NNM-Club');
    expect(nnmclub.kind).toBe('builtin');
    expect(nnmclub.needsLogin).toBeFalsy();
    expect(nnmclub.cloudflare).toBe(true);
    expect(nnmclub.siteUrl).toBe('https://nnmclub.to/');
    expect(nnmclub.siteUrls).toEqual(['https://nnmclub.to/']);
    expect(nnmclubHosts.hosts).toEqual(['nnmclub.to']);
  });

  it('searches the tracker and parses rows (no magnet on the list)', async () => {
    const site = fakeSite((c) => page(fixture('nnmclub-search.html'), c.url));
    const list = await nnmclub.search('матрица', site.ctx);
    expect(site.calls.map((c) => c.method + ' ' + c.url)).toEqual([
      'GET https://nnmclub.to/forum/tracker.php?nm=%D0%BC%D0%B0%D1%82%D1%80%D0%B8%D1%86%D0%B0',
    ]);
    expect(list).toHaveLength(3);
    const a = list[0];
    expect(a.source).toBe('nnmclub');
    expect(a.Tracker).toBe('NNM-Club');
    expect(a.Title).toBe('Матрица / The Matrix (1999) UHD BDRip [H.265/2160p] [4K, HDR10, DV 8.1, 10-bit] [handmade AI]');
    expect(a.detailUrl).toBe('https://nnmclub.to/forum/viewtopic.php?t=1892054');
    expect(a.Link).toBe(a.detailUrl);
    expect(a.Magnet).toBe('');
    expect(a.hash).toBeUndefined();
    expect(a.Categories).toBe('handmade * video');
    expect(a.Size).toBe('24.4 GB');
    expect(a.sizeBytes).toBe(26228254998);
    expect(a.Seed).toBe(19);
    expect(a.Peer).toBe(4);
    expect(a.date).toBe(1790365459 * 1000);
    expect(a.CreateDate).toBe(new Date(1790365459 * 1000).toISOString());
    expect(list[2].sizeBytes).toBe(33307120566);
    expect(list[2].Size).toBe('31 GB');
  });

  it('takes the magnet from the release page', async () => {
    const site = fakeSite((c) => page(fixture('nnmclub-detail.html'), c.url));
    const m = await nnmclub.magnet!('https://nnmclub.to/forum/viewtopic.php?t=1892054', site.ctx);
    expect(m).toBe('magnet:?xt=urn:btih:E65D3548F30476021969E0CE90F2815704AD6283');
    expect(site.calls[0].url).toBe('https://nnmclub.to/forum/viewtopic.php?t=1892054');
  });

  it('reports a release page without a magnet and a page it cannot read', async () => {
    const site = fakeSite((c) => page('<html><body>Тема не найдена</body></html>', c.url));
    await expect(nnmclub.magnet!('https://nnmclub.to/forum/viewtopic.php?t=1', site.ctx)).rejects.toThrow('На странице раздачи нет magnet-ссылки');
    await expect(nnmclub.search('x', site.ctx)).rejects.toThrow('Не удалось разобрать страницу сайта');
  });

  it('only opens release pages of nnmclub', async () => {
    const site = fakeSite((c) => page(fixture('nnmclub-detail.html'), c.url));
    await expect(nnmclub.magnet!('https://evil.example/viewtopic.php?t=1', site.ctx)).rejects.toThrow('Неверный адрес');
    expect(site.calls).toHaveLength(0);
  });

  it('returns nothing when the table has no rows', async () => {
    const empty =
      '<html><body><table class="forumline tablesorter"><thead><tr><th>Topic</th></tr></thead><tbody><tr><td class="row1" colspan="10">Не найдено</td></tr></tbody></table></body></html>';
    expect(await nnmclub.search('zzz', fakeSite((c) => page(empty, c.url)).ctx)).toEqual([]);
  });

  it('every request carries the site options: the Cloudflare pass only while its switch is on', async () => {
    const site = fakeSite(server());
    await nnmclub.search('x', site.ctx);
    await nnmclub.magnet!(FORUM + 'viewtopic.php?t=1892054', site.ctx);
    expect(site.calls.map((c) => c.opts)).toEqual([{ siteName: 'NNM-Club' }, { siteName: 'NNM-Club' }]);
    setCloudflareBypass('nnmclub', true);
    await nnmclub.search('x', site.ctx);
    expect(site.calls[2].opts).toEqual({ siteName: 'NNM-Club', cloudflare: true });
    await expect(nnmclub.search('x', fakeSite((c) => page(CLOUDFLARE, c.url, 403)).ctx)).rejects.toThrow('Cloudflare');
  });

  it('the feed stays a guest page without the Cloudflare pass (it runs in the background)', async () => {
    setCloudflareBypass('nnmclub', true);
    const site = fakeSite((c) => page(fixture('nnmclub-tracker.html'), c.url));
    await nnmclub.latest!(site.ctx, 'movie');
    expect(site.calls[0].opts).toBeUndefined();
  });

  it('searches as a guest: a saved login is never required and never posted by the search', async () => {
    const site = fakeSite(server(), CREDS);
    expect(await nnmclub.search('x', site.ctx)).toHaveLength(3);
    expect(site.calls.filter((c) => c.method === 'POST')).toEqual([]);
    expect(await nnmclub.search('x', fakeSite(server()).ctx)).toHaveLength(3);
  });

  it('signs in with a windows-1251 phpBB form and stores the login only after the site accepted it', async () => {
    const site = fakeSite(server());
    await nnmclub.login!('tester', PASS, site.ctx);
    expect(site.calls[0].method + ' ' + site.calls[0].url).toBe('POST ' + LOGIN_URL);
    expect(site.calls[0].form).toEqual({ username: 'tester', password: PASS, autologin: 'on', redirect: 'index.php', login: 'Вход' });
    expect(site.calls[0].opts).toEqual({ siteName: 'NNM-Club', formCharset: 'windows-1251' });
    expect(site.secrets).toEqual({ 'nnmclub.username': 'tester', 'nnmclub.password': PASS });
    expect(await nnmclub.loggedIn!(site.ctx)).toBe(true);
  });

  it('a wrong password and a captcha store nothing', async () => {
    const bad = fakeSite(server());
    const e = await nnmclub.login!('tester', 'wrong', bad.ctx).then(() => null, (x: unknown) => x);
    expect(siteLoginCode(e)).toBe('bad_login');
    expect((e as Error).message).toBe('Неверный логин или пароль');
    expect(bad.secrets).toEqual({});
    const cap = fakeSite(server({ loginPage: CAPTCHA_PAGE }));
    await expect(nnmclub.login!('tester', PASS, cap.ctx)).rejects.toThrow('NNM-Club просит капчу — нажмите «Войти через браузер»');
    expect(cap.secrets).toEqual({});
  });

  it('logout and the staged login of a transfer', async () => {
    const site = fakeSite(server(), { ...CREDS, 'nnmclub.pending.username': 'tv', 'nnmclub.pending.password': 'tvp' });
    await nnmclub.loginPending!(site.ctx);
    expect(site.calls[0].form).toEqual({ username: 'tv', password: 'tvp', autologin: 'on', redirect: 'index.php', login: 'Вход' });
    await nnmclub.logout!(site.ctx);
    expect(site.cleared).toEqual(['https://nnmclub.to/']);
    expect(site.secrets).toEqual({ 'nnmclub.pending.username': 'tv', 'nnmclub.pending.password': 'tvp' });
    expect(await nnmclub.savedLogin!(fakeSite(server(), CREDS).ctx)).toEqual({ username: 'test-user', password: 'test-pass' });
  });
});

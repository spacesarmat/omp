import { describe, it, expect } from 'vitest';
import { rutracker, RUTRACKER_CAPTCHA } from '../../src/sources/rutracker';
import { isLoginRequired } from '../../src/sources/types';
import { fakeSite, fixture, page, CLOUDFLARE } from './fakeSite';
import type { HttpCall } from './fakeSite';

const LOGIN_URL = 'https://rutracker.org/forum/login.php';
const SEARCH_URL = 'https://rutracker.org/forum/tracker.php?nm=';
const INDEX_URL = 'https://rutracker.org/forum/index.php';
// test-only values, not a real account
const CREDS = { 'rutracker.username': 'test-user', 'rutracker.password': 'test-pass' };

/** A rutracker that is signed in after a successful POST to login.php. */
function server(opts: { loginPage?: string; signedIn?: boolean } = {}) {
  let signedIn = !!opts.signedIn;
  return (c: HttpCall) => {
    if (c.method === 'POST' && c.url === LOGIN_URL) {
      if (opts.loginPage) return page(fixture(opts.loginPage), LOGIN_URL);
      signedIn = true;
      return page(fixture('rutracker-detail.html'), INDEX_URL); // any signed-in page after the redirect
    }
    if (!signedIn) return page(fixture('rutracker-guest.html'), c.url);
    if (c.url.indexOf(SEARCH_URL) === 0) return page(fixture('rutracker-search.html'), c.url);
    return page(fixture('rutracker-detail.html'), c.url);
  };
}

describe('rutracker', () => {
  it('is a built-in source that needs a login', () => {
    expect(rutracker.id).toBe('rutracker');
    expect(rutracker.name).toBe('rutracker');
    expect(rutracker.kind).toBe('builtin');
    expect(rutracker.needsLogin).toBe(true);
  });

  it('signs in with a windows-1251 form and keeps the credentials in the secret store only', async () => {
    const site = fakeSite(server());
    expect(await rutracker.loggedIn!(site.ctx)).toBe(false);
    await rutracker.login!('Пользователь', 'пароль 1', site.ctx);
    expect(site.calls).toHaveLength(1);
    const c = site.calls[0];
    expect(c.method).toBe('POST');
    expect(c.url).toBe(LOGIN_URL);
    expect(c.form).toEqual({ login_username: 'Пользователь', login_password: 'пароль 1', login: 'вход' });
    expect(c.opts && c.opts.formCharset).toBe('windows-1251');
    expect(site.secrets).toEqual({ 'rutracker.username': 'Пользователь', 'rutracker.password': 'пароль 1' });
    expect(await rutracker.loggedIn!(site.ctx)).toBe(true);
  });

  it('rejects a wrong password and does not store it', async () => {
    const site = fakeSite(server({ loginPage: 'rutracker-login-error.html' }));
    await expect(rutracker.login!('u', 'bad', site.ctx)).rejects.toThrow('Неверный логин или пароль');
    expect(site.secrets).toEqual({});
  });

  it('detects a captcha and asks to sign in in the browser', async () => {
    const site = fakeSite(server({ loginPage: 'rutracker-login-captcha.html' }));
    await expect(rutracker.login!('u', 'p', site.ctx)).rejects.toThrow(RUTRACKER_CAPTCHA);
    expect(RUTRACKER_CAPTCHA).toBe('rutracker просит капчу — войдите на сайте в браузере и попробуйте снова');
    expect(site.secrets).toEqual({});
  });

  it('reports a Cloudflare check, empty fields and a missing secret store', async () => {
    await expect(rutracker.login!('u', 'p', fakeSite((c) => page(CLOUDFLARE, c.url, 403)).ctx)).rejects.toThrow(
      'Сайт закрыт проверкой браузера (Cloudflare), попробуйте позже',
    );
    const site = fakeSite(server());
    await expect(rutracker.login!(' ', 'p', site.ctx)).rejects.toThrow('Введите логин и пароль');
    await expect(rutracker.login!('u', '', site.ctx)).rejects.toThrow('Введите логин и пароль');
    expect(site.calls).toHaveLength(0);
    const bare = fakeSite(server(), null);
    await expect(rutracker.login!('u', 'p', bare.ctx)).rejects.toThrow('Вход доступен только в приложении Android');
    expect(bare.calls).toHaveLength(0);
    expect(await rutracker.loggedIn!(bare.ctx)).toBe(false);
  });

  it('parses the search page of a signed-in user', async () => {
    const site = fakeSite(server({ signedIn: true }), CREDS);
    const list = await rutracker.search('северный маяк', site.ctx);
    expect(site.calls.map((c) => c.method + ' ' + c.url)).toEqual([
      'GET ' + SEARCH_URL + '%D1%81%D0%B5%D0%B2%D0%B5%D1%80%D0%BD%D1%8B%D0%B9%20%D0%BC%D0%B0%D1%8F%D0%BA',
    ]);
    // the row on moderation (no download link) is skipped
    expect(list).toHaveLength(2);
    const a = list[0];
    expect(a.source).toBe('rutracker');
    expect(a.Tracker).toBe('rutracker');
    expect(a.Title).toBe('Северный маяк / Northern Lighthouse (2025) WEB-DL 1080p');
    expect(a.detailUrl).toBe('https://rutracker.org/forum/viewtopic.php?t=6000001');
    expect(a.Link).toBe(a.detailUrl);
    expect(a.Magnet).toBe('');
    expect(a.Categories).toBe('HD Video');
    expect(a.sizeBytes).toBe(2469606195);
    expect(a.Size).toBe('2.3 GB');
    expect(a.Seed).toBe(15);
    expect(a.Peer).toBe(3);
    expect(a.date).toBe(1790000000 * 1000);
    // «12 дн» = no seeders for 12 days
    expect(list[1].Seed).toBe(0);
    expect(list[1].Peer).toBe(0);
    expect(list[1].Size).toBe('7 GB');
  });

  it('without a session or saved credentials asks for a login', async () => {
    const site = fakeSite(server());
    const e = await rutracker.search('x', site.ctx).then(
      () => null,
      (err: unknown) => err,
    );
    expect(isLoginRequired(e)).toBe(true);
    expect(site.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('signs in again once with the saved credentials when the session expired', async () => {
    const site = fakeSite(server(), CREDS);
    const list = await rutracker.search('x', site.ctx);
    expect(list).toHaveLength(2);
    expect(site.calls.map((c) => c.method + ' ' + c.url)).toEqual(['GET ' + SEARCH_URL + 'x', 'POST ' + LOGIN_URL, 'GET ' + SEARCH_URL + 'x']);
    expect(site.calls[1].form).toEqual({ login_username: 'test-user', login_password: 'test-pass', login: 'вход' });
  });

  it('treats a redirect to login.php as an expired session', async () => {
    let signedIn = false;
    const site = fakeSite((c) => {
      if (c.method === 'POST') {
        signedIn = true;
        return page(fixture('rutracker-detail.html'), INDEX_URL);
      }
      if (!signedIn) return page('<html><body><form action="login.php"></form></body></html>', LOGIN_URL + '?redirect=tracker.php');
      return page(fixture('rutracker-search.html'), c.url);
    }, CREDS);
    expect(await rutracker.search('x', site.ctx)).toHaveLength(2);
    expect(site.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('asks for a login when signing in again fails (wrong password or captcha)', async () => {
    for (const p of ['rutracker-login-error.html', 'rutracker-login-captcha.html']) {
      const site = fakeSite(server({ loginPage: p }), CREDS);
      const e = await rutracker.search('x', site.ctx).then(
        () => null,
        (err: unknown) => err,
      );
      expect(isLoginRequired(e)).toBe(true);
      expect(site.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    }
  });

  it('a Cloudflare check on search is an error, not a login', async () => {
    const site = fakeSite((c) => page(CLOUDFLARE, c.url, 403), CREDS);
    await expect(rutracker.search('x', site.ctx)).rejects.toThrow('Сайт закрыт проверкой браузера (Cloudflare)');
    expect(site.calls).toHaveLength(1);
  });

  it('takes the magnet from the release page, signing in again if needed', async () => {
    const site = fakeSite(server(), CREDS);
    const m = await rutracker.magnet!('https://rutracker.org/forum/viewtopic.php?t=6000001', site.ctx);
    expect(m).toBe('magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567&tr=http%3A%2F%2Fbt.t-ru.org%2Fann%3Fmagnet');
    expect(site.calls.map((c) => c.method)).toEqual(['GET', 'POST', 'GET']);
    await expect(rutracker.magnet!('https://evil.example/forum/viewtopic.php?t=1', site.ctx)).rejects.toThrow('Неверный адрес');
  });

  it('signs out: forgets the cookies and the credentials', async () => {
    const site = fakeSite(server(), CREDS);
    await rutracker.logout!(site.ctx);
    expect(site.cleared).toEqual(['https://rutracker.org/forum/']);
    expect(site.secrets).toEqual({});
    expect(await rutracker.loggedIn!(site.ctx)).toBe(false);
  });
});

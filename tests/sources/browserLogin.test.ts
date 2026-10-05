import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  BROWSER_HINT,
  browserSignedIn,
  browserKey,
  browserOutcome,
  canLoginOnPhone,
  isCaptchaError,
  phoneLoginRequest,
  setBrowserLoginPlatform,
  tvLoginRequest,
  type BrowserLoginPlatform,
  type BrowserOutcome,
  type BrowserSpec,
} from '../../src/sources/browserLogin';
import { kinozal, kinozalHosts } from '../../src/sources/kinozal';
import { rustorka } from '../../src/sources/rustorka';
import { rutracker, RUTRACKER_CAPTCHA } from '../../src/sources/rutracker';
import { resetMirrors } from '../../src/sources/mirrors';
import { reloadSourcePrefs } from '../../src/sources/store';
import { siteLoginCode } from '../../src/sources/siteLoginText';
import { CHALLENGE } from '../../src/sources/site';
import { isLoginRequired } from '../../src/sources/types';
import { fakeSite, page, CLOUDFLARE } from './fakeSite';

/** A fake platform: records what it was asked to open, answers `answer`. */
function fakePlatform(answer: BrowserOutcome | (() => Promise<BrowserOutcome>), pendingOk = true) {
  const asked: { spec: BrowserSpec; opts?: { askPhone?: boolean } }[] = [];
  const pendingAsked: string[] = [];
  const p: BrowserLoginPlatform = {
    phone: true,
    login: (spec, opts) => {
      asked.push({ spec, opts });
      return typeof answer === 'function' ? answer() : Promise.resolve(answer);
    },
    pending: (site) => {
      pendingAsked.push(site);
      return Promise.resolve({ ok: pendingOk, host: 'kinozal.tv' });
    },
  };
  return { p, asked, pendingAsked };
}

beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
  resetMirrors();
});
afterEach(() => setBrowserLoginPlatform(null));

// test-only values, not a real account
const CREDS = { 'kinozal.username': 'test-user', 'kinozal.password': 'test-pass' };

describe('browser login flows', () => {
  it('a signed-in browser session marks the site, forgets the saved password and adopts the mirror', async () => {
    const f = fakePlatform({ result: 'ok', host: 'kinozal.tv', via: 'here' });
    setBrowserLoginPlatform(f.p);
    const site = fakeSite(() => page('', 'https://kinozal.me/'), CREDS);
    const r = await kinozal.browserLogin!(site.ctx);
    expect(r.result).toBe('ok');
    const spec = f.asked[0].spec;
    // the login page on the active mirror, every mirror as a host, the check of a signed-in page
    expect(spec.url).toBe('https://kinozal.me/login.php');
    expect(spec.source).toBe('kinozal');
    expect(spec.hosts).toEqual(['kinozal.me', 'kinozal.guru', 'kinozal.tv']);
    expect(spec.check).toEqual({ loginPath: 'login.php', path: 'my.php', marker: 'logout.php?hash4u=', cookies: ['uid', 'pass'] });
    expect(site.secrets).toEqual({ 'kinozal.browser': '1' });
    expect(kinozalHosts.host()).toBe('kinozal.tv');
    expect(await kinozal.loggedIn!(site.ctx)).toBe(true);
    expect(await kinozal.browserSession!(site.ctx)).toBe(true);
    // the page never asked the site itself: the native side did
    expect(site.calls).toEqual([]);
  });

  it('cancel, busy and failure change nothing', async () => {
    for (const result of ['cancelled', 'busy', 'failed', 'store_failed'] as const) {
      setBrowserLoginPlatform(fakePlatform({ result }).p);
      const site = fakeSite(() => page('', 'https://kinozal.me/'), CREDS);
      expect((await kinozal.browserLogin!(site.ctx)).result).toBe(result);
      expect(site.secrets).toEqual(CREDS);
    }
    // a platform that throws, or none at all (LG): failed
    setBrowserLoginPlatform({ login: () => Promise.reject(new Error('x')) });
    expect((await rustorka.browserLogin!(fakeSite(() => page('', 'https://rustorka.com/')).ctx)).result).toBe('failed');
    setBrowserLoginPlatform(null);
    expect((await rustorka.browserLogin!(fakeSite(() => page('', 'https://rustorka.com/')).ctx)).result).toBe('failed');
  });

  it('logout clears the session cookies of every mirror and the marker; a password login replaces the session', async () => {
    setBrowserLoginPlatform(fakePlatform({ result: 'ok' }).p);
    const site = fakeSite(() => page('', 'https://kinozal.me/'));
    await kinozal.browserLogin!(site.ctx);
    await kinozal.logout!(site.ctx);
    expect(site.secrets).toEqual({});
    expect(site.cleared).toEqual(['https://kinozal.me/', 'https://kinozal.guru/', 'https://kinozal.tv/']);
    expect(await kinozal.loggedIn!(site.ctx)).toBe(false);

    // rutracker: the same
    const rut = fakeSite(() => page('', 'https://rutracker.org/'));
    await rutracker.browserLogin!(rut.ctx);
    expect(rut.secrets).toEqual({ [browserKey('rutracker')]: '1' });
    expect(await rutracker.loggedIn!(rut.ctx)).toBe(true);
    await rutracker.logout!(rut.ctx);
    expect(rut.secrets).toEqual({});
    expect(rut.cleared).toEqual(['https://rutracker.org/forum/']);
  });

  it('an expired browser session asks for a login again: the marker goes, the site says «нужен вход»', async () => {
    const site = fakeSite((c) => page('<form><input name="password"></form>', c.url), { 'kinozal.browser': '1' });
    expect(await kinozal.loggedIn!(site.ctx)).toBe(true);
    const e = await kinozal.search('x', site.ctx).then(() => null, (x: unknown) => x);
    expect(isLoginRequired(e)).toBe(true);
    expect(site.calls.filter((c) => c.method === 'POST')).toEqual([]);
    expect(site.secrets).toEqual({});
    expect(await kinozal.loggedIn!(site.ctx)).toBe(false);
    // rutracker the same
    const rut = fakeSite((c) => page('<html>guest</html>', c.url), { 'rutracker.browser': '1' });
    expect(isLoginRequired(await rutracker.search('x', rut.ctx).then(() => null, (x: unknown) => x))).toBe(true);
    expect(rut.secrets).toEqual({});
  });

  it('TV: a session from the phone is checked natively, only on one of the site hosts', async () => {
    const f = fakePlatform({ result: 'ok' });
    setBrowserLoginPlatform(f.p);
    const site = fakeSite(() => page('', 'https://kinozal.me/'));
    await kinozal.sessionPending!(site.ctx, 'kinozal.tv');
    expect(f.pendingAsked).toEqual(['kinozal']);
    await expect(kinozal.sessionPending!(site.ctx, 'evil.example')).rejects.toThrow();
    setBrowserLoginPlatform(fakePlatform({ result: 'ok' }, false).p);
    await expect(kinozal.sessionPending!(site.ctx, 'kinozal.tv')).rejects.toThrow();
  });
});

describe('a captcha on the form login', () => {
  it('an inline Turnstile on the login page is a captcha, not a Cloudflare block; the interstitial stays Cloudflare', async () => {
    const inline =
      '<html><head><title>Вход</title><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></head>' +
      '<body><form action="takelogin.php"><div class="cf-turnstile" data-sitekey="x"></div></form></body></html>';
    const k = fakeSite((c) => page(inline, c.url));
    const e = await kinozal.login!('u', 'p', k.ctx).then(() => null, (x: unknown) => x);
    expect(siteLoginCode(e)).toBe('captcha');
    expect(isCaptchaError(e)).toBe(true);
    const r = fakeSite((c) => page(inline, c.url));
    const re = await rutracker.login!('u', 'p', r.ctx).then(() => null, (x: unknown) => x);
    expect((re as Error).message).toBe(RUTRACKER_CAPTCHA);
    expect(isCaptchaError(re)).toBe(true);
    // the full Cloudflare page is still a Cloudflare block (the visible check), never a captcha suggestion
    const cf = fakeSite((c) => page(CLOUDFLARE, c.url));
    const ce = await rustorka.login!('u', 'p', cf.ctx).then(() => null, (x: unknown) => x);
    expect((ce as Error).message).toBe(CHALLENGE);
    expect(isCaptchaError(ce)).toBe(false);
    expect(isCaptchaError(new Error('Неверный логин или пароль'))).toBe(false);
  });
});

describe('requests and answers', () => {
  const spec: BrowserSpec = {
    url: 'https://kinozal.me/login.php',
    site: 'Kinozal',
    source: 'kinozal',
    hosts: ['kinozal.me'],
    check: { path: 'my.php', marker: 'm', loginPath: 'login.php' },
  };

  it('the phone sheet and the TV dialog carry the copy; the TV request names its TV', () => {
    const p = phoneLoginRequest(spec);
    expect(p.title).toBe('Вход на Kinozal');
    expect(p.text).toBe(BROWSER_HINT);
    expect(p.mode).toBe('phone');
    expect(p.forTv).toBeUndefined();
    const forTv = phoneLoginRequest(spec, { id: 'c1', tv: 'Гостиная' });
    expect(forTv.forTv).toBe('c1');
    expect(forTv.text).toContain('«Гостиная»');
    const tv = tvLoginRequest(spec, true);
    expect(tv.mode).toBe('tv');
    expect(tv.phone).toBe('Войти на телефоне');
    expect(tv.askPhone).toBe(true);
    expect(tv.errors!.UNVERIFIED).toBeTruthy();
    expect(tvLoginRequest(spec).askPhone).toBeUndefined();
  });

  it('both say the window closes by itself and carry the checking / not confirmed / retry copy', () => {
    for (const r of [phoneLoginRequest(spec), tvLoginRequest(spec)]) {
      expect(r.text).toContain('окно закроется само');
      expect(r.checking).toBe('Проверяю вход…');
      expect(r.notConfirmed).toContain('«Проверить ещё раз»');
      expect(r.retry).toBe('Проверить ещё раз');
    }
    expect(browserSignedIn('rutracker')).toBe('Вход в rutracker выполнен');
  });

  it('native answers are read strictly', () => {
    expect(browserOutcome({ result: 'ok', host: 'kinozal.tv', via: 'here' })).toEqual({ result: 'ok', host: 'kinozal.tv', via: 'here' });
    expect(browserOutcome({ result: 'ok', host: 'Evil Host/' })).toEqual({ result: 'ok' });
    expect(browserOutcome({ result: 'weird' })).toEqual({ result: 'failed' });
    expect(browserOutcome(null)).toEqual({ result: 'failed' });
    expect(browserOutcome({ result: 'done' })).toEqual({ result: 'cancelled', done: true });
    expect(browserOutcome({ result: 'store_failed' })).toEqual({ result: 'store_failed' });
    expect(canLoginOnPhone()).toBe(false);
    setBrowserLoginPlatform(fakePlatform({ result: 'ok' }).p);
    expect(canLoginOnPhone()).toBe(true);
  });
});

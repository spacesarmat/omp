import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { mockFetch, type MockResponse } from '../../tests/helpers/fetchMock';
import { SESSIONS_NOT_SENT } from '../src/screens/Sources';
import { SourceSite, SEND_LOGIN } from '../src/screens/SourceSite';
import { resetTo } from '../src/nav';
import { cancelWarmUp, disconnectTv, setTransport, type TvTransport } from '../src/tv/tvClient';
import { reloadTvs, saveTv, setActiveTv, type SavedTv } from '../src/tv/tvStore';
import { native, type OmpNativeApi, type TvCloudflareRequest } from '../src/platform/native';
import { toast } from '../src/ui/toast';
import { handleTvRequest, holdSignInScreen, phoneBrowserLogin, resetSignInScreens, resetTvRequests, signInScreenActive, SIGN_IN_GRACE_MS, type PhoneCloudflareDeps } from '../src/cloudflare';
import { setSourceOn } from '../../src/sources/store';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { reloadSourcePrefs, resetHealth } from '../../src/sources/store';
import { clearLog, logEntries } from '../../src/lib/log';
import { kinozal } from '../../src/sources/kinozal';
import { resetMirrors } from '../../src/sources/mirrors';
import {
  BROWSER_STORE_FAILED,
  BROWSER_CAPTCHA,
  BROWSER_DONE_TITLE,
  BROWSER_LOGIN,
  BROWSER_SENT_TV,
  setBrowserLoginPlatform,
  type BrowserLoginPlatform,
  type BrowserLoginRequest,
  type BrowserOutcome,
} from '../../src/sources/browserLogin';
import { fakeSite, page, type FakeSite, type HttpCall } from '../../tests/sources/fakeSite';

const TOKEN = '0123456789abcdef0123456789abcdef';
const ATV: SavedTv = { ip: '192.168.1.40', name: 'Гостиная', kind: 'atv', token: TOKEN, ctlPort: 8095 };
const BASE = 'http://192.168.1.40:8095';
const COOKIE = 'never-in-the-page';

let el: HTMLElement;
let site: FakeSite;
let fetched: { url: string; body: any }[];
let fetchAnswer: (body: any) => MockResponse;
let sessionCalls: { payload: any; sessions: { [id: string]: string[] } }[];
let pairedCalls: ({ url: string; token: string } | null)[];
let sessionAnswer: () => Promise<{ status: number; data: { [k: string]: unknown } | null; missing: string[] }>;
let logins: BrowserOutcome[];
const realSend = native.siteSessionSend;
const realPaired = native.pairedTv;

const noSsap: TvTransport = {
  tvConnect: () => Promise.reject(new Error('ssap used')),
  tvSend: () => Promise.reject(new Error('ssap used')),
  onTvMessage: () => () => {},
  onTvClosed: () => () => {},
  pointerConnect: () => Promise.reject(new Error('ssap used')),
  pointerSend: () => Promise.reject(new Error('ssap used')),
  tvDisconnect: () => Promise.resolve(),
};

/** Kinozal whose login form shows an inline Turnstile (a captcha). */
function captchaSite(c: HttpCall) {
  if (c.method === 'POST') {
    return page(
      '<html><head><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></head><body><form><div class="cf-turnstile"></div></form></body></html>',
      c.url,
    );
  }
  return page('<form><input name="password"></form>', c.url);
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

function mountWith(node: preact.ComponentChild) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(node, el));
  return flush();
}

const btn = (t: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent === t) as HTMLButtonElement | undefined;

function type(sel: string, v: string) {
  const i = el.querySelector(sel) as HTMLInputElement;
  act(() => {
    i.value = v;
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** The platform answers each «Войти через браузер» with the next outcome. */
function platform(): BrowserLoginPlatform {
  return { login: () => Promise.resolve(logins.shift() || { result: 'cancelled' }) };
}

beforeEach(() => {
  localStorage.clear();
  resetMirrors();
  reloadTvs();
  reloadSourcePrefs();
  resetHealth();
  clearLog();
  resetTvRequests();
  toast.value = '';
  fetched = [];
  sessionCalls = [];
  pairedCalls = [];
  resetSignInScreens();
  logins = [];
  fetchAnswer = () => ({ body: '{"ok":true}' });
  sessionAnswer = () => Promise.resolve({ status: 200, data: { ok: true, sessions: { kinozal: 'ok' } }, missing: [] });
  setTransport(noSsap);
  mockFetch((url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    fetched.push({ url, body });
    if (url === BASE + '/omp/info') return { body: JSON.stringify({ name: 'Гостиная', version: '0.15.0', paired: true, foreground: true }) };
    return fetchAnswer(body);
  });
  native.pairedTv = (t) => {
    pairedCalls.push(t);
    return Promise.resolve();
  };
  native.siteSessionSend = (o) => {
    sessionCalls.push(o as any);
    return sessionAnswer();
  };
  setBrowserLoginPlatform(platform());
  site = fakeSite(captchaSite);
  registerSource(kinozal);
  resetTo({ name: 'sourceSite', id: 'kinozal' });
});

afterEach(async () => {
  if (el) act(() => render(null, el));
  unregisterSource('kinozal');
  setBrowserLoginPlatform(null);
  native.siteSessionSend = realSend;
  native.pairedTv = realPaired;
  cancelWarmUp();
  await disconnectTv();
  setTransport(native);
});

describe('phone: «Войти через браузер» on the site screen', () => {
  it('is under the form; a captcha suggests it; a browser login shows «Вход выполнен в браузере»; «Выйти» clears it', async () => {
    await mountWith(<SourceSite id="kinozal" clearance={() => Promise.resolve(null)} ctx={() => site.ctx} />);
    expect(btn(BROWSER_LOGIN)).toBeTruthy();
    expect(el.textContent).not.toContain(BROWSER_CAPTCHA);
    type('#m-site-user', 'kino');
    type('#m-site-pass', 'secret-test');
    act(() => btn('Войти')!.click());
    await flush();
    // the form login hit a captcha: the suggestion comes, the button becomes the main one
    expect(el.querySelector('[data-hint="captcha"]')!.textContent).toBe(BROWSER_CAPTCHA);
    expect(btn(BROWSER_LOGIN)!.className).toContain('m-btn-primary');
    // cancelled: nothing changes
    logins = [{ result: 'cancelled' }];
    act(() => btn(BROWSER_LOGIN)!.click());
    await flush();
    expect(site.secrets).toEqual({});
    logins = [{ result: 'ok', host: 'kinozal.me' }];
    act(() => btn(BROWSER_LOGIN)!.click());
    await flush();
    expect(el.textContent).toContain(BROWSER_DONE_TITLE);
    expect(toast.value).toBe('Вход в Kinozal выполнен');
    // no password in this mode: only the marker
    expect(site.secrets).toEqual({ 'kinozal.browser': '1' });
    act(() => btn('Выйти')!.click());
    await flush();
    expect(site.secrets).toEqual({});
    expect(site.cleared.length).toBe(3);
    expect(btn(BROWSER_LOGIN)).toBeTruthy();
    // signed in, but the encrypted storage refused it: said so, no marker
    logins = [{ result: 'store_failed' }];
    act(() => btn(BROWSER_LOGIN)!.click());
    await flush();
    expect(toast.value).toBe(BROWSER_STORE_FAILED);
    expect(site.secrets).toEqual({});
    expect(el.textContent).not.toContain(BROWSER_DONE_TITLE);
  });

  it('«Передать вход на телевизор» of a browser session goes natively with the hosts, never a cookie in the page', async () => {
    site = fakeSite(captchaSite, { 'kinozal.browser': '1' });
    saveTv(ATV);
    setActiveTv(ATV.ip);
    await mountWith(<SourceSite id="kinozal" clearance={() => Promise.resolve(null)} ctx={() => site.ctx} />);
    expect(el.textContent).toContain(BROWSER_DONE_TITLE);
    act(() => btn(SEND_LOGIN)!.click());
    await flush();
    const c = sessionCalls[0];
    // the target is registered as the paired TV first; the send call itself names no address
    expect(pairedCalls[pairedCalls.length - 1]).toEqual({ url: BASE, token: TOKEN });
    expect((c as any).url).toBeUndefined();
    expect((c as any).token).toBeUndefined();
    expect(c.sessions).toEqual({ kinozal: ['kinozal.me', 'kinozal.guru', 'kinozal.tv'] });
    expect(c.payload.logins).toBeUndefined();
    expect(c.payload.sources).toEqual({ kinozal: false });
    expect(toast.value).toBe('Вход на Kinozal передан на телевизор');
    // the TV could not verify it: says so
    sessionAnswer = () => Promise.resolve({ status: 200, data: { ok: true, sessions: { kinozal: 'error' } }, missing: [] });
    act(() => btn(SEND_LOGIN)!.click());
    await flush();
    expect(toast.value).toContain('телевизор не подтвердил вход на Kinozal');
    // an older TV refuses the sessions: the rest goes over the page's own request, the phone says so
    sessionAnswer = () => Promise.resolve({ status: 400, data: { error: 'bad_request' }, missing: [] });
    act(() => btn(SEND_LOGIN)!.click());
    await flush();
    const plain = fetched.filter((f) => f.url === BASE + '/omp/sources');
    expect(plain.length).toBe(1);
    expect(plain[0].body.sessions).toBeUndefined();
    expect(toast.value).toContain(SESSIONS_NOT_SENT);
    expect(JSON.stringify(logEntries())).not.toContain(COOKIE);
  });
});

describe('phone: the TV asks «Войти на телефоне»', () => {
  function deps(n: Partial<OmpNativeApi>, toasts: string[]): PhoneCloudflareDeps {
    return {
      native: n as PhoneCloudflareDeps['native'],
      toast: (t) => toasts.push(t),
      tv: () => ATV,
      bypassOn: () => true,
      onVisible: () => () => {},
    };
  }

  it('opens the sheet for a known site and says the session went to the TV; anything else is declined', async () => {
    const sheets: BrowserLoginRequest[] = [];
    const declined: string[] = [];
    const toasts: string[] = [];
    const n = {
      siteBrowserLogin: (r: BrowserLoginRequest) => {
        sheets.push(r);
        return Promise.resolve({ result: 'ok', sent: true });
      },
      cloudflareDecline: (id: string) => {
        declined.push(id);
        return Promise.resolve();
      },
    };
    const req: TvCloudflareRequest = { id: 'c9', site: 'Kinozal', url: 'https://kinozal.tv/', kind: 'login', source: 'kinozal' };
    // a site this phone has turned off: declined without a sheet
    await handleTvRequest({ ...req, id: 'c8' }, deps(n, toasts));
    expect(declined).toEqual(['c8']);
    setSourceOn('kinozal', true);
    await handleTvRequest(req, deps(n, toasts));
    expect(sheets[0].forTv).toBe('c9');
    expect(sheets[0].mode).toBe('phone');
    expect(sheets[0].hosts).toContain('kinozal.tv');
    expect(sheets[0].text).toContain('«Гостиная»');
    expect(toasts).toEqual([BROWSER_SENT_TV]);
    // a root that is not the site's, or an unknown site
    await handleTvRequest({ ...req, id: 'c10', url: 'https://evil.example/' }, deps(n, toasts));
    await handleTvRequest({ ...req, id: 'c11', source: 'nosuch' }, deps(n, toasts));
    expect(declined).toEqual(['c8', 'c10', 'c11']);
    expect(sheets.length).toBe(1);
  });

  it('the phone listens for «Войти на телефоне» only on a sign-in screen and 5 minutes after it', () => {
    vi.useFakeTimers();
    try {
      expect(signInScreenActive()).toBe(false);
      const a = holdSignInScreen();
      const b = holdSignInScreen();
      expect(signInScreenActive()).toBe(true);
      a();
      a();
      b();
      vi.advanceTimersByTime(SIGN_IN_GRACE_MS - 1000);
      expect(signInScreenActive()).toBe(true);
      // back on the screen within the grace: still on, and the old timer does not end it
      const c = holdSignInScreen();
      vi.advanceTimersByTime(5000);
      expect(signInScreenActive()).toBe(true);
      c();
      vi.advanceTimersByTime(SIGN_IN_GRACE_MS + 1);
      expect(signInScreenActive()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the phone platform maps the native answer', async () => {
    const p = phoneBrowserLogin({ siteBrowserLogin: () => Promise.resolve({ result: 'ok', host: 'kinozal.me' }) });
    expect(await p.login({ url: 'https://kinozal.me/login.php', site: 'Kinozal', source: 'kinozal', hosts: ['kinozal.me'], check: { path: 'my.php', marker: 'm', loginPath: 'login.php' } })).toEqual({
      result: 'ok',
      host: 'kinozal.me',
    });
    const bad = phoneBrowserLogin({ siteBrowserLogin: () => Promise.reject(new Error('x')) });
    expect((await bad.login({ url: 'u', site: 's', source: 'kinozal', hosts: [], check: { path: 'a', marker: 'm', loginPath: 'b' } })).result).toBe('failed');
  });
});

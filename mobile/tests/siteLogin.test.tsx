import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { mockFetch, type MockResponse } from '../../tests/helpers/fetchMock';
import { loginsNotSent, rutrackerNotStored, Sources, sitesNotSent, transferPayload, withLoginsLabel } from '../src/screens/Sources';
import { setCloudflareBypass, setSourceOn } from '../../src/sources/store';
import { SourceSite, sendLogin, siteLoginNote } from '../src/screens/SourceSite';
import { resetTo } from '../src/nav';
import { cancelWarmUp, disconnectTv, setTransport, type TvTransport } from '../src/tv/tvClient';
import { reloadTvs, saveTv, setActiveTv, type SavedTv } from '../src/tv/tvStore';
import { native } from '../src/platform/native';
import { toast } from '../src/ui/toast';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { isSourceOn, reloadSourcePrefs, resetHealth } from '../../src/sources/store';
import { clearLog, logEntries } from '../../src/lib/log';
import { kinozal } from '../../src/sources/kinozal';
import { resetMirrors } from '../../src/sources/mirrors';
import { rustorka } from '../../src/sources/rustorka';
import { fakeSite, fixture, page, type FakeSite, type HttpCall } from '../../tests/sources/fakeSite';
import type { Source } from '../../src/sources/types';

const TOKEN = '0123456789abcdef0123456789abcdef';
const ATV: SavedTv = { ip: '192.168.1.40', name: 'Гостиная', kind: 'atv', token: TOKEN, ctlPort: 8095 };
const BASE = 'http://192.168.1.40:8095';
// test-only values, not a real account
const PASSWORD = 'pa55-test-only';
const LOGIN = 'https://kinozal.me/takelogin.php';

interface Call {
  url: string;
  method: string;
  body: any;
}

let calls: Call[];
let answer: (c: Call) => MockResponse;
let el: HTMLElement;
let site: FakeSite;

const noSsap: TvTransport = {
  tvConnect: () => Promise.reject(new Error('ssap used')),
  tvSend: () => Promise.reject(new Error('ssap used')),
  onTvMessage: () => () => {},
  onTvClosed: () => () => {},
  pointerConnect: () => Promise.reject(new Error('ssap used')),
  pointerSend: () => Promise.reject(new Error('ssap used')),
  tvDisconnect: () => Promise.resolve(),
};

/** Kinozal: accepts PASSWORD only. */
function kinozalSite(c: HttpCall) {
  if (c.method === 'POST' && c.url === LOGIN) return c.form!.password === PASSWORD ? page(fixture('kinozal-search.html'), 'https://kinozal.me/') : page(fixture('kinozal-login-error.html'), LOGIN);
  return page(fixture('kinozal-guest.html'), c.url);
}

const rutrackerFake: Source = {
  id: 'rutracker',
  name: 'rutracker',
  kind: 'builtin',
  needsLogin: true,
  search: () => Promise.resolve([]),
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  loggedIn: () => Promise.resolve(true),
};

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
const posts = () => calls.filter((c) => c.method === 'POST' && c.url === BASE + '/omp/sources');

function type(sel: string, v: string) {
  const i = el.querySelector(sel) as HTMLInputElement;
  act(() => {
    i.value = v;
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
  resetMirrors();
  reloadTvs();
  reloadSourcePrefs();
  resetHealth();
  clearLog();
  calls = [];
  answer = (c) => ({ body: JSON.stringify({ ok: true, logins: Object.keys(c.body.logins || {}).reduce((m: any, k) => ((m[k] = 'ok'), m), {}) }) });
  toast.value = '';
  setTransport(noSsap);
  mockFetch((url, init) => {
    const c: Call = { url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(c);
    if (url === BASE + '/omp/info') return { body: JSON.stringify({ name: 'Гостиная', version: '0.15.0', paired: true, foreground: true }) };
    return answer(c);
  });
  site = fakeSite(kinozalSite);
  registerSource(kinozal);
  registerSource(rustorka);
  resetTo({ name: 'sourceSite', id: 'kinozal' });
});

afterEach(async () => {
  if (el) act(() => render(null, el));
  unregisterSource('kinozal');
  unregisterSource('rustorka');
  unregisterSource('rutracker');
  cancelWarmUp();
  await disconnectTv();
  setTransport(native);
});

describe('phone: Kinozal site screen', () => {
  it('shows the login block per the mockup and signs in (password never kept), then «Выйти»', async () => {
    await mountWith(<SourceSite id="kinozal" clearance={() => Promise.resolve(null)} ctx={() => site.ctx} />);
    const card = el.querySelector('[data-site-card="login"]') as HTMLElement;
    expect(card.textContent).toContain('Вход на Kinozal');
    expect(card.textContent).toContain(siteLoginNote());
    expect(siteLoginNote()).toBe('Без входа сайт не отдаёт .torrent. Пароль хранится в зашифрованном хранилище телефона.');
    expect(el.textContent).toContain('Искать на Kinozal');
    expect(el.textContent).toContain('Обходить проверку Cloudflare');
    // no TV paired: no transfer button
    expect(btn(sendLogin())).toBeUndefined();
    type('#m-site-user', 'kino');
    type('#m-site-pass', 'wrong');
    act(() => btn('Войти')!.click());
    await flush();
    expect(el.querySelector('[role="alert"]')!.textContent).toBe('Неверный логин или пароль');
    expect((el.querySelector('#m-site-pass') as HTMLInputElement).value).toBe('');
    expect(site.secrets).toEqual({});
    type('#m-site-pass', PASSWORD);
    act(() => btn('Войти')!.click());
    await flush();
    expect(site.secrets).toEqual({ 'kinozal.username': 'kino', 'kinozal.password': PASSWORD });
    expect(isSourceOn(kinozal)).toBe(true);
    expect(el.textContent).toContain('Вход выполнен');
    act(() => btn('Выйти')!.click());
    await flush();
    expect(site.secrets).toEqual({});
    expect(btn('Войти')).toBeTruthy();
    expect(JSON.stringify(logEntries())).not.toContain(PASSWORD);
    expect(JSON.stringify(localStorage)).not.toContain(PASSWORD);
  });

  it('«Передать вход на телевизор» sends only this site\'s login and shows the TV\'s answer', async () => {
    site = fakeSite(kinozalSite, { 'kinozal.username': 'kino', 'kinozal.password': PASSWORD, 'rustorka.username': 'r', 'rustorka.password': PASSWORD });
    saveTv(ATV);
    setActiveTv(ATV.ip);
    await mountWith(<SourceSite id="kinozal" clearance={() => Promise.resolve(null)} ctx={() => site.ctx} />);
    act(() => btn(sendLogin())!.click());
    await flush();
    const p = posts()[0];
    expect(p.body.logins).toEqual({ kinozal: { username: 'kino', password: PASSWORD } });
    expect(p.body.rutracker).toBeUndefined();
    // only this site's switches; the other switches and FlareSolverr stay as they are on the TV
    expect(p.body.sources).toEqual({ kinozal: false });
    expect(p.body.cloudflare).toEqual({ kinozal: false });
    expect(p.body.flaresolverr).toBeUndefined();
    expect(toast.value).toBe('Вход на Kinozal передан на телевизор');
    answer = (c) => ({ body: JSON.stringify({ ok: true, logins: { kinozal: 'bad_login' } }) });
    act(() => btn(sendLogin())!.click());
    await flush();
    expect(toast.value).toBe('Kinozal не принял логин или пароль');
    // an older TV refuses the logins: the rest goes, the phone says so
    answer = (c) => (c.body.logins || c.body.cloudflare ? { status: 400, body: '{"error":"bad_request"}' } : { body: '{"ok":true}' });
    act(() => btn(sendLogin())!.click());
    await flush();
    // the same transfer without the language first (a v0.15 TV), then without the v0.15 parts
    expect(posts()[3].body.logins).toBeDefined();
    expect(posts()[4].body.logins).toBeUndefined();
    expect(toast.value).toContain(sitesNotSent());
    expect(JSON.stringify(logEntries())).not.toContain(PASSWORD);
  });
});

describe('phone: «Источники поиска» with the sites behind Cloudflare', () => {
  it('lists them in the one built-in list and sends their logins with rutracker\'s', async () => {
    registerSource(rutrackerFake);
    site = fakeSite(kinozalSite, { 'rutracker.username': 'rt', 'rutracker.password': PASSWORD, 'kinozal.username': 'kino', 'kinozal.password': PASSWORD });
    saveTv(ATV);
    setActiveTv(ATV.ip);
    answer = (c) => ({ body: JSON.stringify({ ok: true, rutracker: 'ok', logins: { kinozal: 'captcha' } }) });
    await mountWith(<Sources ctx={() => site.ctx} />);
    expect(el.querySelector('[data-group="cloudflare"]')).toBeNull();
    const group = el.querySelector('[data-group="builtin"]') as HTMLElement;
    expect(group.textContent).toContain('Kinozal');
    expect(group.textContent).toContain('rustorka');
    expect(group.querySelector('[data-source="rustorka"]')!.textContent).toContain('нужен вход · за Cloudflare');
    expect(el.textContent).toContain(withLoginsLabel(['Kinozal', 'rutracker']));
    act(() => btn('Передать на телевизор')!.click());
    await flush();
    const p = posts()[0];
    expect(p.body.rutracker).toEqual({ username: 'rt', password: PASSWORD });
    expect(p.body.logins).toEqual({ kinozal: { username: 'kino', password: PASSWORD } });
    expect(toast.value).toContain('Kinozal просит капчу — нажмите «Войти через браузер»');
    // the TV verified rutracker's login but could not write it: the site results still show
    answer = () => ({ body: JSON.stringify({ ok: true, rutracker: 'error', rutrackerNotStored: true, logins: { kinozal: 'ok' } }) });
    act(() => btn('Передать на телевизор')!.click());
    await flush();
    expect(toast.value).toContain(rutrackerNotStored());
    expect(toast.value.indexOf('Источники переданы.')).toBe(0);
  });

  it('a login the TV would refuse is left out on its own; the others still go', () => {
    setSourceOn('kinozal', true);
    setCloudflareBypass('kinozal', true);
    const list: Source[] = [kinozal, rustorka];
    const p = transferPayload(
      list,
      { username: 'rt', password: PASSWORD },
      undefined,
      null,
      { kinozal: { username: 'kino', password: 'p'.repeat(201) }, rustorka: { username: 'r', password: PASSWORD } },
    );
    expect(p.droppedLogins).toEqual(['kinozal']);
    expect(p.tooBig).toBe(false);
    expect(p.payload.rutracker).toEqual({ username: 'rt', password: PASSWORD });
    expect(p.payload.logins).toEqual({ rustorka: { username: 'r', password: PASSWORD } });
    expect(loginsNotSent(['Kinozal'], false)).toBe('Вход на Kinozal не передан: логин или пароль слишком длинный или с недопустимыми символами');
    expect(loginsNotSent(['rutracker', 'Kinozal'], true)).toBe('Входы на сайты не переданы: слишком много данных для телевизора');
  });
});

describe('phone: site screen in English', () => {
  beforeEach(() => applyLanguageSetting('en'));
  afterEach(() => applyLanguageSetting('ru'));
  const noCyrillic = () => expect(el.textContent).not.toMatch(/[А-Яа-яЁё]/);

  it('the Kinozal screen: title, switches, the login form and its errors', async () => {
    await mountWith(<SourceSite id="kinozal" clearance={() => Promise.resolve(null)} ctx={() => site.ctx} />);
    expect(el.querySelector('h1')!.textContent).toBe('Kinozal');
    expect(el.querySelector('[aria-label="Back"]')).toBeTruthy();
    expect(el.textContent).toContain('Search on Kinozal');
    expect(el.textContent).toContain('Bypass the Cloudflare check');
    const card = el.querySelector('[data-site-card="login"]') as HTMLElement;
    expect(card.querySelector('.m-sheet-title')!.textContent).toBe('Sign in to Kinozal');
    expect(card.textContent).toContain('Without signing in the site does not give out the .torrent. The password is kept in the phone’s encrypted storage.');
    expect(card.querySelector('label[for=m-site-user]')!.textContent).toBe('Login');
    expect(card.querySelector('label[for=m-site-pass]')!.textContent).toBe('Password');
    act(() => btn('Sign in')!.click());
    expect(el.querySelector('[role=alert]')!.textContent).toBe('Enter the login and password');
    noCyrillic();
  });

  it('an unknown source', async () => {
    await mountWith(<SourceSite id="nope" ctx={() => site.ctx} />);
    expect(el.querySelector('h1')!.textContent).toBe('Source');
    expect(el.textContent).toContain('Source not found');
    noCyrillic();
  });

  it('signed in: «Signed in», sign-out and the transfer to the TV', async () => {
    const atv: SavedTv = { ...ATV, name: 'Living room' };
    saveTv(atv);
    setActiveTv(atv.ip);
    site = fakeSite((c) => (c.method === 'POST' && c.url === LOGIN ? page(fixture('kinozal-search.html'), 'https://kinozal.me/') : page(fixture('kinozal-search.html'), c.url)));
    await mountWith(<SourceSite id="kinozal" clearance={() => Promise.resolve(null)} ctx={() => site.ctx} />);
    type('#m-site-user', 'kino');
    type('#m-site-pass', PASSWORD);
    act(() => btn('Sign in')!.click());
    await flush();
    expect(el.textContent).toContain('Signed in');
    expect(btn('Sign out')).toBeTruthy();
    expect(btn('Send the sign-in to the TV')).toBeTruthy();
    act(() => btn('Send the sign-in to the TV')!.click());
    await flush();
    expect(toast.value).toBe('The sign-in to Kinozal was sent to the TV');
    expect(logEntries().map((e) => e.x).join('|')).toContain('Sign-in to kinozal sent to the Android TV: ok');
    expect(JSON.stringify(logEntries())).not.toMatch(/[А-Яа-яЁё]/);
    noCyrillic();
  });

  it('the transfer notes and the toggles are English', () => {
    expect(withLoginsLabel(['Kinozal', 'rutracker'])).toBe('Together with the sign-in to Kinozal, rutracker');
    expect(loginsNotSent(['Kinozal'], false)).toBe('The sign-in to Kinozal was not sent: the login or password is too long or has invalid characters');
    expect(loginsNotSent(['Kinozal'], true)).toBe('Site sign-ins were not sent: too much data for the TV');
    expect(sitesNotSent()).toBe('Sign-ins to sites behind Cloudflare were not sent — update OMP on the TV');
    expect(rutrackerNotStored()).toBe('The TV could not save the rutracker sign-in: secure storage is unavailable');
    expect(siteLoginNote()).toContain('Without signing in');
    expect(sendLogin()).toBe('Send the sign-in to the TV');
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// @ts-ignore node builtins
import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';
import { Sources } from '../src/screens/Sources';
import { SourceSite } from '../src/screens/SourceSite';
import { tvLoginSource } from '../src/cloudflare';
import { currentRoute, resetTo } from '../src/nav';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { getHealth, isCloudflareBypassOn, isSourceOn, reloadSourcePrefs, resetHealth, setHealth } from '../../src/sources/store';
import { setBrowserLoginPlatform } from '../../src/sources/browserLogin';
import { kinozal } from '../../src/sources/kinozal';
import { rustorka } from '../../src/sources/rustorka';
import { nnmclub } from '../../src/sources/nnmclub';
import { resetMirrors } from '../../src/sources/mirrors';
import { fakeSite, fixture, page, type FakeSite, type HttpCall } from '../../tests/sources/fakeSite';
import type { Source } from '../../src/sources/types';

// test-only value, not a real account
const PASSWORD = 'pa55-test-only';
const CF = 'Сайт закрыт проверкой браузера (Cloudflare), попробуйте позже';
const CF_EN = 'The site is behind a browser check (Cloudflare), try later';
const KINOZAL_LOGIN = 'https://kinozal.me/takelogin.php';

let el: HTMLElement;
let site: FakeSite;

/** Kinozal: accepts PASSWORD only. */
function kinozalSite(c: HttpCall) {
  if (c.method === 'POST' && c.url === KINOZAL_LOGIN) {
    return c.form!.password === PASSWORD ? page(fixture('kinozal-search.html'), 'https://kinozal.me/') : page(fixture('kinozal-login-error.html'), KINOZAL_LOGIN);
  }
  return page(fixture('kinozal-guest.html'), c.url);
}

/** A built-in site without a login (its Cloudflare hint is the Jackett one). */
const plain: Source = { id: 'fake-plain', name: 'Anidub', kind: 'builtin', search: () => Promise.resolve([]) };

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

const screen = () => <Sources ctx={() => site.ctx} indexerEnv={() => ({ scan: null, readSettings: null, now: () => Date.now() })} />;
const sw = (label: string) => el.querySelector('[role="switch"][aria-label="' + label + '"]') as HTMLButtonElement;
const row = (name: string) => sw(name).closest('.m-src-row') as HTMLElement;
const item = (name: string) => sw(name).closest('.m-src-item') as HTMLElement;
const note = (name: string) => row(name).querySelector('.m-src-note') as HTMLElement | null;
const hint = (name: string) => item(name).querySelector('[data-hint="cloudflare"]') as HTMLElement | null;
const inRow = (name: string, text: string) => Array.from(row(name).querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement | undefined;
const inDialog = (text: string) => Array.from(el.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent === text) as HTMLButtonElement | undefined;
const click = (n: Element) => act(() => (n as HTMLElement).click());

function type(sel: string, v: string) {
  const i = el.querySelector(sel) as HTMLInputElement;
  act(() => {
    i.value = v;
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** The body of a CSS rule that starts a line of mobile.css ('' when there is none). */
function cssRule(css: string, selector: string): string {
  const m = new RegExp('(?:^|\\n)' + selector.replace(/\./g, '\\.') + '\\s*\\{([^}]*)\\}').exec(css);
  return m ? m[1] : '';
}

beforeEach(() => {
  localStorage.clear();
  resetMirrors();
  reloadSourcePrefs();
  resetHealth();
  resetTo({ name: 'sources' });
  site = fakeSite(kinozalSite);
  registerSource(kinozal);
  registerSource(rustorka);
  registerSource(nnmclub);
  registerSource(plain);
});

afterEach(() => {
  if (el) act(() => render(null, el));
  ['kinozal', 'rustorka', 'nnmclub', 'fake-plain'].forEach((id) => unregisterSource(id));
  setBrowserLoginPlatform(null);
});

describe('phone «Источники поиска»: one list, sign-in on the row', () => {
  it('every built-in site is in «Встроенные · на телефоне»; the sites with a login have «Войти» and the › to their screen', async () => {
    await mountWith(screen());
    expect(el.querySelector('[data-group="cloudflare"]')).toBeNull();
    expect(el.textContent).not.toContain('Сайты за Cloudflare');
    const group = el.querySelector('[data-group="builtin"]') as HTMLElement;
    for (const name of ['Kinozal', 'Rustorka', 'NNM-Club', 'Anidub']) expect(group.contains(sw(name))).toBe(true);
    for (const name of ['Kinozal', 'Rustorka', 'NNM-Club']) expect(inRow(name, 'Войти')).toBeTruthy();
    expect(inRow('Anidub', 'Войти')).toBeUndefined();
    expect(row('NNM-Club').querySelector('[data-open="nnmclub"]')).toBeTruthy();
    expect(row('Anidub').querySelector('[data-open]')).toBeNull();
    click(row('Kinozal').querySelector('[data-open="kinozal"]')!);
    expect(currentRoute.value).toEqual({ name: 'sourceSite', id: 'kinozal' });
  });

  it('a site behind Cloudflare says so in its note while the note is not an error', async () => {
    await mountWith(screen());
    expect(note('NNM-Club')!.textContent).toBe('Cloudflare');
    expect(note('NNM-Club')!.className).toBe('m-src-note');
    expect(note('Kinozal')!.textContent).toBe('нужен вход · Cloudflare');
    expect(note('Anidub')).toBeNull();
    act(() => setHealth('nnmclub', { state: 'ok', ms: 800, at: 1 }));
    expect(note('NNM-Club')!.textContent).toBe('работает · 0,8 с · Cloudflare');
    act(() => setHealth('nnmclub', { state: 'error', at: 2, message: CF }));
    expect(note('NNM-Club')!.textContent).toBe(CF);
    expect(note('NNM-Club')!.className).toBe('m-src-note bad');
  });

  it('under a site stopped by Cloudflare: a short hint about that site only', async () => {
    setHealth('nnmclub', { state: 'error', at: 1, message: CF });
    setHealth('fake-plain', { state: 'error', at: 1, message: CF });
    await mountWith(screen());
    expect(hint('NNM-Club')!.textContent).toBe('Войдите через браузер — кнопка «Войти»');
    expect(hint('NNM-Club')!.querySelector('button')).toBeNull();
    expect(hint('Kinozal')).toBeNull();
    const other = hint('Anidub')!;
    expect(other.querySelector('span')!.textContent).toBe('Подключите Anidub через Jackett, Prowlarr или FlareSolverr');
    for (const name of ['Kinozal', 'Rustorka']) expect(other.textContent).not.toContain(name);
    click(Array.from(other.querySelectorAll('button')).find((b) => b.textContent === 'Как')!);
    expect(currentRoute.value).toEqual({ name: 'faq', q: 'jackett' });
  });

  it('a site already signed in through the browser is told to sign in again', async () => {
    site = fakeSite(kinozalSite, { 'nnmclub.browser': '1' });
    setHealth('nnmclub', { state: 'error', at: 1, message: CF });
    await mountWith(screen());
    expect(hint('NNM-Club')!.textContent).toBe('Войдите через браузер заново — «Выйти», затем «Войти»');
  });

  it('exactly one general hint, at the bottom, naming no site', async () => {
    setHealth('nnmclub', { state: 'error', at: 1, message: CF });
    await mountWith(screen());
    const general = el.querySelectorAll('.m-hint-warn');
    expect(general.length).toBe(1);
    const text = general[0].textContent || '';
    expect(text).toContain('Сайт закрыт проверкой Cloudflare? Войдите на нём через браузер');
    for (const name of ['Kinozal', 'Rustorka', 'NNM-Club', 'rutracker']) expect(text).not.toContain(name);
    expect((el.textContent || '').split('Сайт закрыт проверкой Cloudflare?').length).toBe(2);
    expect(general[0]).toBe(el.querySelector('[data-route="sources"]')!.lastElementChild);
  });

  it('a two-line error note and the hint never share space: the hint is a sibling below the row, no negative margin, the row does not shrink', async () => {
    setHealth('nnmclub', { state: 'error', at: 1, message: CF });
    await mountWith(screen());
    // jsdom has no layout: the structure and the CSS rules carry the guarantee
    const box = item('NNM-Club');
    const r = row('NNM-Club');
    const h = hint('NNM-Club')!;
    expect(Array.from(box.children)).toEqual([r, h]);
    expect(r.contains(h)).toBe(false);
    expect(note('NNM-Club')!.textContent).toBe(CF);
    const css = readFileSync('mobile/src/mobile.css', 'utf8') as string;
    expect(cssRule(css, '.m-src-item')).toMatch(/flex-direction:\s*column/);
    expect(cssRule(css, '.m-src-row')).toMatch(/flex-shrink:\s*0/);
    expect(cssRule(css, '.m-src-hint')).toMatch(/margin:/);
    expect(cssRule(css, '.m-src-hint')).not.toMatch(/margin[^;]*-\d/);
  });

  it('«Войти» opens the sign-in sheet; a browser login turns the Cloudflare bypass on', async () => {
    setBrowserLoginPlatform({ login: () => Promise.resolve({ result: 'ok' }) });
    await mountWith(screen());
    click(inRow('Kinozal', 'Войти')!);
    expect(el.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('Вход на Kinozal');
    click(inDialog('Войти через браузер')!);
    await flush();
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(site.secrets).toEqual({ 'kinozal.browser': '1' });
    expect(isCloudflareBypassOn(kinozal)).toBe(true);
    expect(isSourceOn(kinozal)).toBe(true);
    expect(note('Kinozal')!.textContent).toBe('вход выполнен · Cloudflare');
    expect(inRow('Kinozal', 'Выйти')).toBeTruthy();
  });

  it('a password login leaves the bypass as it was', async () => {
    await mountWith(screen());
    click(inRow('Kinozal', 'Войти')!);
    type('[role="dialog"] input[name="username"]', 'kino');
    type('[role="dialog"] input[type="password"]', PASSWORD);
    click(inDialog('Войти')!);
    await flush();
    expect(site.secrets).toEqual({ 'kinozal.username': 'kino', 'kinozal.password': PASSWORD });
    expect(isCloudflareBypassOn(kinozal)).toBe(false);
    expect(note('Kinozal')!.textContent).toBe('вход выполнен · Cloudflare');
  });

  it('NNM-Club: «Выйти» brings back the plain note, never «нужен вход»', async () => {
    site = fakeSite(kinozalSite, { 'nnmclub.browser': '1' });
    await mountWith(screen());
    expect(note('NNM-Club')!.textContent).toBe('вход выполнен · Cloudflare');
    click(inRow('NNM-Club', 'Выйти')!);
    await flush();
    expect(site.secrets).toEqual({});
    expect(site.cleared).toEqual(['https://nnmclub.to/']);
    expect(getHealth('nnmclub')).toBeNull();
    expect(note('NNM-Club')!.textContent).toBe('Cloudflare');
    expect(inRow('NNM-Club', 'Войти')).toBeTruthy();
  });

  it('the NNM-Club screen has the login block with its own note; its browser login turns the bypass on', async () => {
    setBrowserLoginPlatform({ login: () => Promise.resolve({ result: 'ok' }) });
    resetTo({ name: 'sourceSite', id: 'nnmclub' });
    await mountWith(<SourceSite id="nnmclub" ctx={() => site.ctx} clearance={() => Promise.resolve(null)} />);
    const card = el.querySelector('[data-site-card="login"]') as HTMLElement;
    expect(card.textContent).toContain('Вход на NNM-Club');
    expect(card.textContent).toContain('Вход не обязателен: он помогает пройти проверку Cloudflare.');
    expect(card.textContent).not.toContain('Без входа сайт не отдаёт .torrent');
    expect(card.querySelector('[data-no-account]')).toBeTruthy();
    expect(el.querySelector('[data-bypass="off"]')).toBeTruthy();
    click(card.querySelector('[data-action="browser-login"]')!);
    await flush();
    expect(isCloudflareBypassOn(nnmclub)).toBe(true);
    expect(el.querySelector('[data-bypass="on"]')).toBeTruthy();
  });

  it('the TV «Войти на телефоне» may open NNM-Club', () => {
    expect(tvLoginSource({ id: 'c1', site: 'NNM-Club', url: 'https://nnmclub.to/', kind: 'login', source: 'nnmclub' })).toBe(nnmclub);
  });
});

/** rutracker: a password login (no Cloudflare), signed out. */
const rutrackerFake: Source = {
  id: 'rutracker',
  name: 'rutracker',
  kind: 'builtin',
  needsLogin: true,
  search: () => Promise.resolve([]),
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  loggedIn: () => Promise.resolve(false),
};

const LOGIN_NAMES = ['rutracker', 'Kinozal', 'Rustorka', 'NNM-Club'];
const rows = () => Array.from(el.querySelectorAll('[data-route="sources"] .m-src-row[data-source]')) as HTMLElement[];
const links = (r: HTMLElement) => Array.from(r.querySelectorAll('.m-src-status .m-src-link')) as HTMLButtonElement[];

describe('phone «Источники поиска»: one row style', () => {
  beforeEach(() => registerSource(rutrackerFake));
  afterEach(() => unregisterSource('rutracker'));

  it('every row with a login has a › and a status-line link; the rest have neither', async () => {
    site = fakeSite(kinozalSite, { 'nnmclub.browser': '1' });
    await mountWith(screen());
    for (const name of LOGIN_NAMES) {
      const r = row(name);
      expect(r.querySelector('.m-src-open [data-open]'), name).toBeTruthy();
      const l = links(r);
      expect(l.length, name).toBe(1);
      expect(l[0].tagName).toBe('BUTTON');
      expect(l[0].getAttribute('type')).toBe('button');
    }
    expect(links(row('rutracker'))[0].textContent).toBe('Войти');
    expect(links(row('NNM-Club'))[0].textContent).toBe('Выйти');
    // the link closes the status line: «нужен вход · Cloudflare · Войти»
    expect(row('Kinozal').querySelector('.m-src-status')!.textContent).toBe('нужен вход · Cloudflare · Войти');
    expect(row('NNM-Club').querySelector('.m-src-status')!.textContent).toBe('вход выполнен · Cloudflare · Выйти');
    expect(row('rutracker').querySelector('.m-src-status')!.textContent).toBe('нужен вход · Войти');
    expect(row('Anidub').querySelector('[data-open]')).toBeNull();
    expect(links(row('Anidub'))).toEqual([]);
    // rutracker's › leads to its own site screen too
    click(row('rutracker').querySelector('[data-open="rutracker"]')!);
    expect(currentRoute.value).toEqual({ name: 'sourceSite', id: 'rutracker' });
  });

  it('«Войти» in the status line opens the sign-in sheet, as the old pill did', async () => {
    await mountWith(screen());
    click(links(row('rutracker'))[0]);
    expect(el.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('Вход на rutracker');
  });

  it('a health or error note keeps its colour and the link follows it', async () => {
    setHealth('kinozal', { state: 'error', at: 1, message: CF });
    await mountWith(screen());
    const status = row('Kinozal').querySelector('.m-src-status') as HTMLElement;
    // Kinozal is signed out: «нужен вход» first; NNM-Club shows the Cloudflare error in red with «Войти» after it
    expect(status.textContent).toBe('нужен вход · Cloudflare · Войти');
    act(() => setHealth('nnmclub', { state: 'error', at: 2, message: CF }));
    const nnm = row('NNM-Club').querySelector('.m-src-status') as HTMLElement;
    expect(nnm.firstElementChild!.className).toBe('m-src-note bad');
    expect(nnm.lastElementChild!.className).toBe('m-src-link');
    act(() => setHealth('nnmclub', { state: 'ok', ms: 600, at: 3 }));
    expect(note('NNM-Club')!.className).toBe('m-src-note ok');
    expect(row('NNM-Club').querySelector('.m-src-status')!.textContent).toBe('работает · 0,6 с · Cloudflare · Войти');
  });

  it('no row has a pill button any more', async () => {
    setHealth('nnmclub', { state: 'error', at: 1, message: CF });
    await mountWith(screen());
    for (const r of rows()) expect(r.querySelector('.m-btn, .m-btn-sm'), r.getAttribute('data-source')!).toBeNull();
    expect(el.querySelector('[data-route="sources"] .m-src-card .m-btn-sm')).toBeNull();
  });

  it('the switches share one structure: the last two columns are the › slot and the switch', async () => {
    await mountWith(screen());
    const all = rows();
    expect(all.length).toBeGreaterThan(5);
    for (const r of all) {
      const kids = Array.from(r.children);
      const id = r.getAttribute('data-source')!;
      expect(kids.length, id).toBe(3);
      expect(kids[0].className, id).toBe('m-src-name');
      expect(kids[1].className, id).toBe('m-src-open');
      expect(kids[2].getAttribute('role'), id).toBe('switch');
      expect(kids[2].className, id).toMatch(/^m-switch( on)?$/);
    }
    const css = readFileSync('mobile/src/mobile.css', 'utf8') as string;
    // fixed columns, one height for every row, a 44px touch target for the links
    expect(cssRule(css, '.m-src-open')).toMatch(/flex:\s*0 0 44px/);
    expect(cssRule(css, '.m-src-row')).toMatch(/min-height:\s*56px/);
    expect(cssRule(css, '.m-src-row')).toMatch(/padding:\s*6px 0/);
    expect(cssRule(css, '.m-src-link')).toMatch(/min-height:\s*44px/);
    expect(cssRule(css, '.m-src-link')).toMatch(/color:\s*var\(--accent\)/);
  });

  it('the general hint is short and its FAQ link is the accent link', async () => {
    await mountWith(screen());
    const general = el.querySelector('[data-hint="general"]') as HTMLElement;
    const faq = general.querySelector('button') as HTMLButtonElement;
    expect(faq.className).toBe('m-link-btn');
    expect(faq.textContent).toBe('Вопросы и ответы');
    const text = general.querySelector('span')!.textContent || '';
    expect(text.split(/[.?!](\s|$)/).filter((x) => x && x.trim()).length).toBeLessThanOrEqual(2);
    for (const name of ['Kinozal', 'Rustorka', 'NNM-Club', 'rutracker', 'Anidub']) expect(text).not.toContain(name);
  });
});

describe('phone «Источники поиска» in English', () => {
  beforeEach(() => applyLanguageSetting('en'));
  afterEach(() => applyLanguageSetting('ru'));

  it('the notes, the hints and the sign-in on the row', async () => {
    setHealth('nnmclub', { state: 'error', at: 1, message: CF_EN });
    setHealth('fake-plain', { state: 'error', at: 1, message: CF_EN });
    await mountWith(screen());
    expect(note('Kinozal')!.textContent).toBe('sign-in needed · Cloudflare');
    expect(inRow('Kinozal', 'Sign in')).toBeTruthy();
    expect(hint('NNM-Club')!.textContent).toBe('Sign in with the browser — the “Sign in” button');
    const other = hint('Anidub')!;
    expect(other.querySelector('span')!.textContent).toBe('Connect Anidub through Jackett, Prowlarr or FlareSolverr');
    expect(other.querySelector('button')!.textContent).toBe('How');
    expect(el.querySelector('.m-hint-warn')!.textContent).toContain('Is the site blocked by Cloudflare? Sign in to it with the browser');
    expect(el.textContent).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('the new row style in English: «sign-in needed · Cloudflare · Sign in», the › and the FAQ link', async () => {
    registerSource(rutrackerFake);
    try {
      site = fakeSite(kinozalSite, { 'nnmclub.browser': '1' });
      await mountWith(screen());
      expect(row('Kinozal').querySelector('.m-src-status')!.textContent).toBe('sign-in needed · Cloudflare · Sign in');
      expect(row('NNM-Club').querySelector('.m-src-status')!.textContent).toBe('signed in · Cloudflare · Sign out');
      expect(row('rutracker').querySelector('.m-src-status')!.textContent).toBe('sign-in needed · Sign in');
      expect(row('rutracker').querySelector('[data-open="rutracker"]')!.getAttribute('aria-label')).toBe('Settings: rutracker');
      const general = el.querySelector('[data-hint="general"]') as HTMLElement;
      expect(general.textContent).toBe('Is the site blocked by Cloudflare? Sign in to it with the browser or connect Jackett, Prowlarr or FlareSolverr.Questions and answers');
      expect(el.querySelector('[data-route="sources"] .m-src-row .m-btn-sm')).toBeNull();
      expect(el.textContent).not.toMatch(/[А-Яа-яЁё]/);
    } finally {
      unregisterSource('rutracker');
    }
  });

  it('the NNM-Club screen note', async () => {
    await mountWith(<SourceSite id="nnmclub" ctx={() => site.ctx} clearance={() => Promise.resolve(null)} />);
    expect(el.querySelector('[data-site-card="login"]')!.textContent).toContain('Signing in is optional: it helps to get past the Cloudflare check.');
    expect(el.textContent).not.toMatch(/[А-Яа-яЁё]/);
  });
});

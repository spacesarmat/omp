import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, h } from 'preact';
import type { VNode } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { SourcesScreen } from '../../src/screens/Sources';
import { DialogHost } from '../../src/ui/dialog';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { reloadSourcePrefs, resetHealth, setCloudflareBypass, setSourceOn } from '../../src/sources/store';
import { siteLoginFromPhone } from '../../src/sources/transfer';
import { kinozal } from '../../src/sources/kinozal';
import { nnmclub } from '../../src/sources/nnmclub';
import { resetMirrors } from '../../src/sources/mirrors';
import { fakeSite, fixture, page, type FakeSite, type HttpCall } from '../sources/fakeSite';
import { browserCaptcha, browserLoginText, loginOnPhone, setBrowserLoginPlatform } from '../../src/sources/browserLogin';

// test-only value
const PASSWORD = 'pa55-test-only';
const LOGIN = 'https://kinozal.me/takelogin.php';
let host: HTMLElement;
let site: FakeSite;

function kinozalSite(c: HttpCall) {
  if (c.method === 'POST' && c.url === LOGIN) return c.form!.password === PASSWORD ? page(fixture('kinozal-search.html'), 'https://kinozal.me/') : page(fixture('kinozal-login-error.html'), LOGIN);
  return page(fixture('kinozal-guest.html'), c.url);
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount(node: VNode<any>) {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(h('div', {}, node, h(DialogHost, {})), host));
  await flush();
}

const byText = (t: string, root: Element = host) =>
  Array.from(root.querySelectorAll('.focusable')).find((n) => n.textContent === t) as HTMLElement | undefined;
const line = (id: string) => host.querySelector('[data-source="' + id + '"]') as HTMLElement;
const click = (n: Element) => act(() => (n as HTMLElement).click());
function type(input: HTMLInputElement, v: string) {
  act(() => {
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const screen = () => h(SourcesScreen, { ctx: () => site.ctx, clearance: () => Promise.resolve(null), scan: () => null, server: () => null });

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => undefined;
});
beforeEach(() => {
  localStorage.clear();
  resetMirrors();
  reloadSourcePrefs();
  resetHealth();
  site = fakeSite(kinozalSite);
  registerSource(kinozal);
});
afterEach(() => {
  Array.from(document.body.children).forEach((c) => act(() => render(null, c)));
  document.body.innerHTML = '';
  unregisterSource('kinozal');
  setBrowserLoginPlatform(null);
});

describe('Android TV: Kinozal login', () => {
  it('NNM-Club (an optional login) has «Войти» / «Выйти» on its row and never says «нужен вход»', async () => {
    registerSource(nnmclub);
    site = fakeSite(kinozalSite, { 'nnmclub.username': 'nnm', 'nnmclub.password': PASSWORD });
    try {
      await mount(screen());
      expect(line('nnmclub').textContent).not.toContain('нужен вход');
      click(byText('Выйти', line('nnmclub'))!);
      click(Array.from(host.querySelectorAll('.dialog-option')).find((n) => n.textContent === 'Выйти')!);
      await flush();
      expect(site.secrets).toEqual({});
      expect(line('nnmclub').textContent).not.toContain('нужен вход');
      expect(line('nnmclub').textContent).toContain('ищет без обхода Cloudflare');
      click(byText('Войти', line('nnmclub'))!);
      expect((host.querySelector('.login-dialog') as HTMLElement).textContent).toContain('Вход на NNM-Club');
    } finally {
      unregisterSource('nnmclub');
    }
  });

  it('the generic login dialog signs in to Kinozal (wrong password first) and «Выйти» forgets it', async () => {
    await mount(screen());
    expect(line('kinozal').textContent).toContain('нужен вход');
    click(byText('Войти', line('kinozal'))!);
    const dialog = host.querySelector('.login-dialog') as HTMLElement;
    expect(dialog.textContent).toContain('Вход на Kinozal');
    const [user, pass] = Array.from(dialog.querySelectorAll('input')) as HTMLInputElement[];
    type(user, 'kino');
    type(pass, 'wrong');
    click(byText('Войти', dialog)!);
    await flush();
    expect(dialog.textContent).toContain('Неверный логин или пароль');
    expect(site.secrets).toEqual({});
    type(pass, PASSWORD);
    click(byText('Войти', dialog)!);
    await flush();
    expect(host.querySelector('.login-dialog')).toBeNull();
    expect(site.secrets).toEqual({ 'kinozal.username': 'kino', 'kinozal.password': PASSWORD });
    // signed in: searched (through the pass once its switch is on); one row, one switch
    expect(line('kinozal').textContent).toContain('ищет без обхода Cloudflare');
    expect(host.querySelectorAll('[data-source="kinozal"]').length).toBe(1);
    click(byText('Выйти', line('kinozal'))!);
    click(Array.from(host.querySelectorAll('.dialog-option')).find((n) => n.textContent === 'Выйти')!);
    await flush();
    expect(site.secrets).toEqual({});
    expect(line('kinozal').textContent).toContain('нужен вход');
  });

  it('«Войти через браузер» and «Войти на телефоне» in the login dialog; a captcha suggests them', async () => {
    const asked: (boolean | undefined)[] = [];
    let next = 'cancelled';
    setBrowserLoginPlatform({ phone: true, login: (_s, o) => (asked.push(o && o.askPhone), Promise.resolve({ result: next as 'ok' })) });
    site = fakeSite((c) =>
      c.method === 'POST' ? page('<html><head><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></head><body><div class="cf-turnstile"></div></body></html>', c.url) : page('', c.url),
    );
    await mount(screen());
    click(byText('Войти', line('kinozal'))!);
    const dialog = host.querySelector('.login-dialog') as HTMLElement;
    expect(byText(browserLoginText(), dialog)).toBeTruthy();
    expect(byText(loginOnPhone(), dialog)).toBeTruthy();
    const [user, pass] = Array.from(dialog.querySelectorAll('input')) as HTMLInputElement[];
    type(user, 'kino');
    type(pass, 'x');
    click(byText('Войти', dialog)!);
    await flush();
    expect(dialog.textContent).toContain(browserCaptcha());
    click(byText(loginOnPhone(), dialog)!);
    await flush();
    // cancelled: the dialog stays
    expect(host.querySelector('.login-dialog')).toBeTruthy();
    next = 'ok';
    click(byText(browserLoginText(), host.querySelector('.login-dialog')!)!);
    await flush();
    expect(asked).toEqual([true, undefined]);
    expect(host.querySelector('.login-dialog')).toBeNull();
    expect(site.secrets).toEqual({ 'kinozal.browser': '1' });
    expect(byText('Выйти', line('kinozal'))).toBeTruthy();
  });

  it('a login from the phone shows «вход передан с телефона» in both rows until it is typed on the TV', async () => {
    site = fakeSite(kinozalSite, { 'kinozal.username': 'kino', 'kinozal.password': PASSWORD });
    localStorage.setItem('tsp.sourcesTransferLogins', JSON.stringify({ kinozal: true }));
    setSourceOn('kinozal', true);
    setCloudflareBypass('kinozal', true);
    await mount(screen());
    expect(line('kinozal').textContent).toContain('вход передан с телефона');
    const cf = host.querySelector('[data-cf-site="kinozal"]') as HTMLElement;
    expect(cf.textContent).toContain('обход Cloudflare · вход передан с телефона');
    click(byText('Выйти', line('kinozal'))!);
    click(Array.from(host.querySelectorAll('.dialog-option')).find((n) => n.textContent === 'Выйти')!);
    await flush();
    expect(siteLoginFromPhone('kinozal')).toBe(false);
  });
});

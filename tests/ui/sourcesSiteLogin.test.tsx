import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, h } from 'preact';
import type { VNode } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { SourcesScreen } from '../../src/screens/Sources';
import { DialogHost } from '../../src/ui/dialog';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { reloadSourcePrefs, resetHealth, setCloudflareBypass } from '../../src/sources/store';
import { siteLoginFromPhone } from '../../src/sources/transfer';
import { kinozal } from '../../src/sources/kinozal';
import { fakeSite, fixture, page, type FakeSite, type HttpCall } from '../sources/fakeSite';

// test-only value
const PASSWORD = 'pa55-test-only';
const LOGIN = 'https://kinozal.tv/takelogin.php';
let host: HTMLElement;
let site: FakeSite;

function kinozalSite(c: HttpCall) {
  if (c.method === 'POST' && c.url === LOGIN) return page(fixture(c.form!.password === PASSWORD ? 'kinozal-search.html' : 'kinozal-login-error.html'), LOGIN);
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
  reloadSourcePrefs();
  resetHealth();
  site = fakeSite(kinozalSite);
  registerSource(kinozal);
});
afterEach(() => {
  Array.from(document.body.children).forEach((c) => act(() => render(null, c)));
  document.body.innerHTML = '';
  unregisterSource('kinozal');
});

describe('Android TV: Kinozal login', () => {
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
    expect(line('kinozal').textContent).toContain('вход выполнен');
    click(byText('Выйти', line('kinozal'))!);
    click(Array.from(host.querySelectorAll('.dialog-option')).find((n) => n.textContent === 'Выйти')!);
    await flush();
    expect(site.secrets).toEqual({});
    expect(line('kinozal').textContent).toContain('нужен вход');
  });

  it('a login from the phone shows «вход передан с телефона» in both rows until it is typed on the TV', async () => {
    site = fakeSite(kinozalSite, { 'kinozal.username': 'kino', 'kinozal.password': PASSWORD });
    localStorage.setItem('tsp.sourcesTransferLogins', JSON.stringify({ kinozal: true }));
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

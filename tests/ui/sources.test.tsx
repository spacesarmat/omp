import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import type { VNode } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { SourcesScreen } from '../../src/screens/Sources';
import { SettingsScreen } from '../../src/screens/Settings';
import { DialogHost } from '../../src/ui/dialog';
import { tvLoginHint } from '../../src/ui/TrackerLoginDialog';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { getHealth, isSourceOn, reloadSourcePrefs, resetHealth, setHealth } from '../../src/sources/store';
import { applyRemoteSources } from '../../src/sources/transfer';
import { currentRoute, resetTo } from '../../src/ui/nav';
import { dispatchKey } from '../../src/ui/keys';
import type { Source, SourceContext } from '../../src/sources/types';

const w = window as unknown as { Capacitor?: unknown };
// test-only value
const PASSWORD = 'pa55-test-only';
let host: HTMLElement;
let logged = false;
const login = vi.fn();
const logout = vi.fn();

function tracker(): Source {
  return {
    id: 'fake-tracker',
    name: 'rutracker',
    kind: 'builtin',
    needsLogin: true,
    search: () => Promise.resolve([]),
    login: (u, p, ctx) => login(u, p, ctx),
    logout: (ctx) => logout(ctx),
    loggedIn: () => Promise.resolve(logged),
  };
}

const open: Source = { id: 'fake-open', name: 'nnmclub', kind: 'builtin', search: () => Promise.resolve([]) };

const offline = (): SourceContext => ({
  http: { get: () => Promise.reject(new Error('x')), post: () => Promise.reject(new Error('x')), clearCookies: () => Promise.resolve() },
  client: null,
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

async function mount(node: VNode<any> = h(SourcesScreen, { now: Date.now })) {
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

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => undefined;
});
beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
  resetHealth();
  logged = false;
  login.mockReset().mockImplementation(() => {
    logged = true;
    return Promise.resolve();
  });
  logout.mockReset().mockImplementation(() => {
    logged = false;
    return Promise.resolve();
  });
  registerSource(open);
  registerSource(tracker());
});
afterEach(() => {
  Array.from(document.body.children).forEach((c) => act(() => render(null, c)));
  document.body.innerHTML = '';
  unregisterSource('fake-open');
  unregisterSource('fake-tracker');
  delete w.Capacitor;
});

describe('Android TV «Источники поиска»', () => {
  it('lists TorrServer and built-in sources with their states and the phone hint', async () => {
    setHealth('fake-open', { state: 'ok', ms: 800, at: 1 });
    await mount();
    const text = host.textContent || '';
    expect(text).toContain('Источники поиска');
    expect(text).toContain('rutor (поиск TorrServer)');
    expect(text).toContain('Jackett / Prowlarr (Torznab)');
    expect(text).toContain('«Передать на телевизор»');
    expect(text).toContain('Передач с телефона ещё не было');
    expect(line('fake-open').textContent).toContain('работает · 0,8 с');
    expect(line('fake-tracker').textContent).toContain('нужен вход');
    expect(line('fake-tracker').textContent).toContain('Войти');
  });

  it('toggles a source with OK', async () => {
    await mount();
    const row = line('fake-open').querySelector('.src-row') as HTMLElement;
    expect(row.textContent).toContain('вкл');
    click(row);
    expect(isSourceOn({ id: 'fake-open' })).toBe(false);
    expect(row.textContent).toContain('выключен');
    const ts = Array.from(host.querySelectorAll('.src-row')).find((n) => (n.textContent || '').indexOf('rutor (поиск TorrServer)') === 0)!;
    click(ts);
    expect(isSourceOn({ id: 'ts-rutor' })).toBe(false);
    expect(ts.querySelector('.src-switch')!.className).toBe('src-switch');
  });

  it('signs in through the dialog and keeps no password on the page', async () => {
    await mount();
    click(byText('Войти')!);
    const dialog = host.querySelector('.login-dialog') as HTMLElement;
    expect(dialog.textContent).toContain('Вход на rutracker');
    expect(dialog.textContent).toContain(tvLoginHint());
    expect(dialog.textContent).toContain('Логин и пароль хранятся только на этом телевизоре в зашифрованном виде.');
    const [user, pass] = Array.from(dialog.querySelectorAll('input')) as HTMLInputElement[];
    expect(pass.type).toBe('password');
    // empty fields: no request
    click(byText('Войти', dialog)!);
    expect(dialog.textContent).toContain('Введите логин и пароль');
    expect(login).not.toHaveBeenCalled();
    type(user, ' test-user ');
    type(pass, PASSWORD);
    click(byText('Войти', dialog)!);
    await flush();
    expect(login).toHaveBeenCalledTimes(1);
    expect(login.mock.calls[0][0]).toBe('test-user');
    expect(login.mock.calls[0][1]).toBe(PASSWORD);
    expect(host.querySelector('.login-dialog')).toBeNull();
    expect(isSourceOn({ id: 'fake-tracker', needsLogin: true })).toBe(true);
    expect(line('fake-tracker').textContent).toContain('вход выполнен');
    expect(line('fake-tracker').textContent).toContain('Выйти');
    expect(host.innerHTML).not.toContain(PASSWORD);
    expect(JSON.stringify(localStorage)).not.toContain(PASSWORD);
  });

  it('shows the error of a failed sign-in and closes on «Отмена»', async () => {
    login.mockReset().mockImplementation(() => Promise.reject(new Error('Неверный логин или пароль')));
    await mount();
    click(byText('Войти')!);
    const dialog = host.querySelector('.login-dialog') as HTMLElement;
    const [user, pass] = Array.from(dialog.querySelectorAll('input')) as HTMLInputElement[];
    type(user, 'u');
    type(pass, PASSWORD);
    click(byText('Войти', dialog)!);
    await flush();
    expect(dialog.textContent).toContain('Неверный логин или пароль');
    expect(pass.value).toBe('');
    click(byText('Отмена', dialog)!);
    expect(host.querySelector('.login-dialog')).toBeNull();
  });

  it('logs out after a confirmation', async () => {
    logged = true;
    await mount();
    expect(line('fake-tracker').textContent).toContain('вход выполнен');
    click(byText('Выйти')!);
    const yes = Array.from(host.querySelectorAll('.dialog-option')).find((n) => n.textContent === 'Выйти')!;
    click(yes);
    await flush();
    expect(logout).toHaveBeenCalledTimes(1);
    expect(getHealth('fake-tracker')!.state).toBe('login');
    expect(line('fake-tracker').textContent).toContain('Войти');
  });

  it('shows the last transfer from the phone, also when it arrives on screen', async () => {
    await mount();
    await act(async () => {
      await applyRemoteSources({ id: 's1', sources: { 'fake-open': false }, rutracker: false, phone: 'Pixel 8', at: 0 }, [open], offline);
    });
    await flush();
    expect(host.textContent).toMatch(/Последняя передача: сегодня \d\d:\d\d · «Pixel 8»/);
    expect(line('fake-open').textContent).toContain('выключен');
  });
});

describe('login note and Back', () => {
  it('a sign-in on the TV replaces «вход передан с телефона»', async () => {
    localStorage.setItem('tsp.sourcesTransfer', JSON.stringify({ at: Date.now(), phone: 'Pixel', rutracker: true }));
    logged = true;
    await mount();
    expect(line('fake-tracker').textContent).toContain('вход передан с телефона');
    // sign out and in again with the remote
    click(byText('Выйти')!);
    click(Array.from(host.querySelectorAll('.dialog-option')).find((n) => n.textContent === 'Выйти')!);
    await flush();
    click(byText('Войти')!);
    const dialog = host.querySelector('.login-dialog') as HTMLElement;
    const [user, pass] = Array.from(dialog.querySelectorAll('input')) as HTMLInputElement[];
    type(user, 'u');
    type(pass, PASSWORD);
    click(byText('Войти', dialog)!);
    await flush();
    expect(line('fake-tracker').textContent).toContain('вход выполнен');
    expect(line('fake-tracker').textContent).not.toContain('передан с телефона');
  });

  it('Back closes the login dialog', async () => {
    await mount();
    click(byText('Войти')!);
    expect(host.querySelector('.login-dialog')).not.toBeNull();
    act(() => {
      expect(dispatchKey('back', new KeyboardEvent('keydown'))).toBe(true);
    });
    expect(host.querySelector('.login-dialog')).toBeNull();
  });
});

describe('Settings entry', () => {
  it('opens the screen on Android TV only', async () => {
    resetTo({ name: 'settings' });
    await mount(h(SettingsScreen, {}));
    expect(byText('Источники поиска')).toBeUndefined();
    act(() => render(null, host));
    w.Capacitor = { getPlatform: () => 'android' };
    await mount(h(SettingsScreen, {}));
    click(byText('Источники поиска')!);
    expect(currentRoute.value.name).toBe('sources');
  });
});

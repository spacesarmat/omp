import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Sources } from '../src/screens/Sources';
import { Settings } from '../src/screens/Settings';
import { currentRoute, resetTo } from '../src/nav';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { getHealth, isSourceOn, reloadSourcePrefs, resetHealth, setHealth } from '../../src/sources/store';
import { localServer } from '../src/server/localServer';
import type { Source } from '../../src/sources/types';

const PASSWORD = 'pa55-secret-word';
let el: HTMLElement;

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

async function mount(node = <Sources />) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(node, el));
  await flush();
}

const btn = (t: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent === t) as HTMLButtonElement | undefined;
const sw = (label: string) => el.querySelector('[role="switch"][aria-label="' + label + '"]') as HTMLButtonElement;
const row = (name: string) => sw(name).closest('.m-src-row') as HTMLElement;
const click = (n: Element) => act(() => (n as HTMLElement).click());
function type(input: HTMLInputElement, v: string) {
  act(() => {
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

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

beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
  resetHealth();
  resetTo({ name: 'settings' });
  logged = false;
  login.mockReset().mockImplementation(() => {
    logged = true;
    return Promise.resolve();
  });
  logout.mockReset().mockImplementation(() => {
    logged = false;
    return Promise.resolve();
  });
  registerSource({ id: 'fake-open', name: 'nnmclub', kind: 'builtin', search: () => Promise.resolve([]) });
  registerSource(tracker());
});

afterEach(() => {
  if (el) act(() => render(null, el));
  unregisterSource('fake-open');
  unregisterSource('fake-tracker');
  vi.restoreAllMocks();
});

describe('Sources screen', () => {
  it('groups TorrServer and built-in sources and shows the hint', async () => {
    await mount();
    const labels = Array.from(el.querySelectorAll('.m-set-label')).map((n) => n.textContent);
    expect(labels).toEqual(['Через TorrServer', 'Встроенные · на телефоне']);
    expect(sw('rutor (поиск TorrServer)')).toBeTruthy();
    expect(sw('Jackett / Prowlarr (Torznab)')).toBeTruthy();
    expect(sw('nnmclub')).toBeTruthy();
    expect(el.textContent).toContain('Kinozal, seedoff, rustorka, labtor и другие закрытые трекеры подключайте через Jackett или Prowlarr в TorrServer');
    click(btn('Вопросы и ответы')!);
    expect(currentRoute.value).toEqual({ name: 'faq' });
  });

  it('shows the state after the last search', async () => {
    setHealth('fake-open', { state: 'ok', ms: 800, at: 1 });
    setHealth('ts-torznab', { state: 'error', at: 1, message: 'Источник не отвечает' });
    await mount();
    expect(row('nnmclub').textContent).toContain('работает · 0,8 с');
    expect(row('Jackett / Prowlarr (Torznab)').textContent).toContain('не отвечает');
    act(() => setHealth('fake-open', { state: 'error', at: 2, message: 'Сайт закрыт проверкой браузера (Cloudflare), попробуйте позже' }));
    expect(row('nnmclub').textContent).toContain('Сайт закрыт проверкой браузера (Cloudflare), попробуйте позже');
  });

  it('switches are saved', async () => {
    await mount();
    expect(sw('nnmclub').getAttribute('aria-checked')).toBe('true');
    expect(sw('rutracker').getAttribute('aria-checked')).toBe('false');
    click(sw('nnmclub'));
    expect(sw('nnmclub').getAttribute('aria-checked')).toBe('false');
    expect(isSourceOn({ id: 'fake-open' })).toBe(false);
    expect(JSON.parse(localStorage.getItem('tsp.sources')!)).toEqual({ 'fake-open': { on: false } });
  });

  it('rutracker: «нужен вход», then «Войти» signs in through the sheet', async () => {
    await mount();
    expect(row('rutracker').textContent).toContain('нужен вход');
    click(btn('Войти')!);
    const dialog = el.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-label')).toBe('Вход на rutracker');
    expect(dialog.textContent).toContain('Логин и пароль хранятся только на этом телефоне в зашифрованном виде и отправляются только на rutracker.');
    const user = dialog.querySelector('input[name="username"]') as HTMLInputElement;
    const pass = dialog.querySelector('input[type="password"]') as HTMLInputElement;
    expect(pass).toBeTruthy();
    type(user, 'reader');
    type(pass, PASSWORD);
    click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Войти')!);
    await flush();
    expect(login).toHaveBeenCalledWith('reader', PASSWORD, expect.anything());
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(row('rutracker').textContent).toContain('работает');
    expect(getHealth('fake-tracker')!.state).toBe('ok');
    expect(sw('rutracker').getAttribute('aria-checked')).toBe('true');
    expect(btn('Выйти')).toBeTruthy();
    for (let i = 0; i < localStorage.length; i++) expect(localStorage.getItem(localStorage.key(i)!)).not.toContain(PASSWORD);
  });

  it('a login error stays inline and the password field is emptied', async () => {
    login.mockImplementation(() => Promise.reject(new Error('Неверный логин или пароль')));
    await mount();
    click(btn('Войти')!);
    const dialog = el.querySelector('[role="dialog"]') as HTMLElement;
    type(dialog.querySelector('input[name="username"]') as HTMLInputElement, 'reader');
    const pass = dialog.querySelector('input[type="password"]') as HTMLInputElement;
    type(pass, PASSWORD);
    click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Войти')!);
    await flush();
    expect(dialog.querySelector('[role="alert"]')!.textContent).toBe('Неверный логин или пароль');
    expect(pass.value).toBe('');
    expect(row('rutracker').textContent).toContain('нужен вход');
  });

  it('empty fields are not sent', async () => {
    await mount();
    click(btn('Войти')!);
    const dialog = el.querySelector('[role="dialog"]') as HTMLElement;
    click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Войти')!);
    await flush();
    expect(login).not.toHaveBeenCalled();
    expect(dialog.querySelector('[role="alert"]')!.textContent).toBe('Введите логин и пароль');
  });

  it('«Отмена» closes the sheet and forgets the typed password', async () => {
    await mount();
    click(btn('Войти')!);
    let pass = el.querySelector('input[type="password"]') as HTMLInputElement;
    type(pass, PASSWORD);
    click(btn('Отмена')!);
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(pass.value).toBe('');
    click(btn('Войти')!);
    pass = el.querySelector('input[type="password"]') as HTMLInputElement;
    expect(pass.value).toBe('');
    expect(login).not.toHaveBeenCalled();
  });

  it('«Выйти» signs out', async () => {
    logged = true;
    await mount();
    expect(btn('Выйти')).toBeTruthy();
    click(btn('Выйти')!);
    await flush();
    expect(logout).toHaveBeenCalled();
    expect(btn('Войти')).toBeTruthy();
    expect(row('rutracker').textContent).toContain('нужен вход');
  });
});

describe('Settings → «Источники поиска»', () => {
  it('opens the sources screen; updates stay first', async () => {
    localServer.value = { supported: false, running: false };
    await mount(<Settings />);
    const labels = Array.from(el.querySelectorAll('.m-set-label')).map((n) => n.textContent);
    expect(labels[0]).toBe('Обновление');
    const b = Array.from(el.querySelectorAll('button')).find((x) => (x.textContent || '').indexOf('Источники поиска') >= 0)!;
    click(b);
    expect(currentRoute.value).toEqual({ name: 'sources' });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Faq } from '../src/screens/Faq';
import { Settings } from '../src/screens/Settings';
import { FAQ } from '../src/faq';
import { currentRoute, resetTo, routeStack } from '../src/nav';
import { HB_REPO_URL } from '../../src/lib/updateInfo';
import { localServer } from '../src/server/localServer';

function mount(ui: preact.VNode): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  act(() => render(ui, el));
  return el;
}
const q = (el: HTMLElement, t: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('.m-faq-q')).find((b) => b.textContent!.includes(t))!;

beforeEach(() => {
  localStorage.clear();
  localServer.value = { supported: false, running: false };
  resetTo({ name: 'settings' });
});
afterEach(() => vi.restoreAllMocks());

describe('Faq', () => {
  it('renders the sections and collapsed questions', () => {
    const el = mount(<Faq />);
    for (const t of ['Установка', 'Сервер', 'Подключение', 'Проблемы', 'Плеер']) expect(el.textContent).toContain(t);
    const buttons = el.querySelectorAll('.m-faq-q');
    expect(buttons.length).toBe(FAQ.reduce((n, s) => n + s.items.length, 0));
    buttons.forEach((b) => expect(b.getAttribute('aria-expanded')).toBe('false'));
    expect(el.querySelector('.m-faq-a')).toBeNull();
  });

  it('opens one answer at a time', async () => {
    const el = mount(<Faq />);
    await act(async () => q(el, 'Android TV?').click());
    expect(q(el, 'Android TV?').getAttribute('aria-expanded')).toBe('true');
    expect(el.textContent).toContain('неизвестных источников');
    await act(async () => q(el, 'Нет звука').click());
    expect(q(el, 'Android TV?').getAttribute('aria-expanded')).toBe('false');
    expect(q(el, 'Нет звука').getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelectorAll('.m-faq-a').length).toBe(1);
    await act(async () => q(el, 'Нет звука').click());
    expect(el.querySelector('.m-faq-a')).toBeNull();
  });

  it('shows the Homebrew repository URL', async () => {
    const el = mount(<Faq />);
    await act(async () => q(el, 'Homebrew Channel').click());
    expect(el.textContent).toContain(HB_REPO_URL);
  });

  it('opens links externally', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const el = mount(<Faq />);
    await act(async () => q(el, 'Что такое TorrServer').click());
    await act(async () => el.querySelector<HTMLButtonElement>('.m-faq-a .m-link')!.click());
    expect(open).toHaveBeenCalledWith('https://github.com/YouROK/TorrServer', '_system');
  });

  it('back button goes back', async () => {
    const el = mount(<Faq />);
    resetTo({ name: 'settings' });
    routeStack.value = routeStack.value.concat({ name: 'faq' });
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Назад"]')!.click());
    expect(currentRoute.value.name).toBe('settings');
  });
});

describe('Settings entry', () => {
  it('navigates to the FAQ', async () => {
    const el = mount(<Settings />);
    const row = Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.includes('Вопросы и ответы'))!;
    await act(async () => row.click());
    expect(currentRoute.value.name).toBe('faq');
  });
});

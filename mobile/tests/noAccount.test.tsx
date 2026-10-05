import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';
import { TrackerLogin } from '../src/ui/TrackerLogin';
import { setNoAccountActions } from '../src/ui/NoAccount';
import type { Source } from '../../src/sources/types';

const CYR = /[А-Яа-яЁё]/;
let el: HTMLElement;

function mount(source: Source) {
  el = document.createElement('div');
  document.body.appendChild(el);
  act(() => render(<TrackerLogin source={source} ctx={() => ({}) as never} onClose={() => {}} onDone={() => {}} />, el));
}
const src = (id: string, name: string) => ({ id, name, kind: 'builtin', login: async () => {}, search: async () => [] }) as unknown as Source;

afterEach(() => {
  act(() => render(null, el));
  document.body.innerHTML = '';
  setNoAccountActions();
  applyLanguageSetting('ru');
});

describe('phone login: «Нет аккаунта?»', () => {
  it('shows the line and opens the registration page', () => {
    const opened: string[] = [];
    setNoAccountActions({ openUrl: (u) => opened.push(u) });
    mount(src('rutracker', 'rutracker'));
    const link = el.querySelector('[data-no-account]') as HTMLElement;
    expect(link.textContent).toBe('Нет аккаунта? Зарегистрироваться на rutracker');
    act(() => link.click());
    expect(opened).toEqual(['https://rutracker.org/forum/profile.php?mode=register']);
  });

  it('Kinozal uses its active mirror', () => {
    const opened: string[] = [];
    setNoAccountActions({ openUrl: (u) => opened.push(u) });
    const s = { ...src('kinozal', 'Kinozal'), siteUrl: 'https://kinozal.guru/' } as Source;
    mount(s);
    act(() => (el.querySelector('[data-no-account]') as HTMLElement).click());
    expect(opened).toEqual(['https://kinozal.guru/signup.php']);
  });

  it('English, no Cyrillic', () => {
    applyLanguageSetting('en');
    mount(src('rutracker', 'rutracker'));
    expect((el.querySelector('[data-no-account]') as HTMLElement).textContent).toBe('No account? Sign up on rutracker');
    expect(el.innerHTML).not.toMatch(CYR);
  });

  it('nothing for a site without registration', () => {
    mount(src('rutor', 'rutor'));
    expect(el.querySelector('[data-no-account]')).toBeNull();
  });
});

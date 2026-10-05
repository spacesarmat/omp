import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { applyLanguageSetting } from '../../src/i18n';
import { TrackerLoginDialog } from '../../src/ui/TrackerLoginDialog';
import type { Source } from '../../src/sources/types';

const CYR = /[А-Яа-яЁё]/;
let host: HTMLElement;

function mount(source: Source) {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(h(TrackerLoginDialog, { source, ctx: () => ({}) as any, onClose: () => undefined, onDone: () => undefined }), host));
}
const src = (id: string, name: string): Source => ({ id, name, kind: 'builtin', needsLogin: true, search: () => Promise.resolve([]), login: () => Promise.resolve() });

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => undefined;
});
afterEach(() => {
  act(() => render(null, host));
  document.body.innerHTML = '';
  applyLanguageSetting('ru');
});

describe('TV login dialog: «Нет аккаунта?»', () => {
  it('shows a QR of the registration page with the caption', () => {
    mount(src('rutracker', 'rutracker'));
    expect(host.querySelector('.login-noacct svg.qr')).toBeTruthy();
    expect(host.textContent).toContain('Нет аккаунта? Наведите камеру телефона, чтобы зарегистрироваться на rutracker');
  });

  it('English caption has no Cyrillic', () => {
    applyLanguageSetting('en');
    mount(src('rustorka', 'rustorka'));
    expect(host.querySelector('.login-noacct svg.qr')).toBeTruthy();
    expect(host.textContent).toContain('No account? Point your phone camera here to sign up on rustorka');
    expect(host.textContent).not.toMatch(CYR);
  });

  it('no QR for a site without a registration page', () => {
    mount(src('rutor', 'rutor'));
    expect(host.querySelector('.login-noacct')).toBeNull();
  });
});

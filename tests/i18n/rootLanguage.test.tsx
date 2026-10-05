import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { App } from '../../src/app';
import { App as PhoneApp } from '../../mobile/src/app';
import { resetTo as tvResetTo } from '../../src/ui/nav';
import { resetTo as phoneResetTo } from '../../mobile/src/nav';
import { t, applyLanguageSetting } from '../../src/i18n';
import { resetSettings } from '../../src/store/settings';

let state = 'one';
function PropLess() {
  return <span class="pl">{t('common.all') + ' ' + state}</span>;
}
function Parent(props: { n: number }) {
  return <div>{props.n}<PropLess /></div>;
}

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => undefined;
});
afterEach(() => {
  resetSettings();
  applyLanguageSetting('ru');
  Array.from(document.body.children).forEach((c) => render(null, c));
  document.body.innerHTML = '';
});

describe('t() does not subscribe components to the language', () => {
  it('a prop-less component that calls t() and reads plain data re-renders with its parent', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    state = 'one';
    act(() => render(h(Parent, { n: 1 }), host));
    expect(host.querySelector('.pl')!.textContent).toBe('Все one');
    state = 'two';
    act(() => render(h(Parent, { n: 2 }), host));
    expect(host.querySelector('.pl')!.textContent).toBe('Все two');
  });
});

describe('a language change remounts the app roots', () => {
  it('TV root', () => {
    tvResetTo({ name: 'settings' } as any);
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => render(h(App, {}), host));
    const before = host.querySelector('.app');
    expect(host.textContent).toContain('Язык');
    act(() => applyLanguageSetting('en'));
    expect(host.querySelector('.app')).not.toBe(before);
    expect(host.textContent).toContain('Language');
  });

  it('phone root', () => {
    phoneResetTo({ name: 'settings' });
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => render(h(PhoneApp, {}), host));
    expect(host.textContent).toContain('Язык');
    act(() => applyLanguageSetting('en'));
    expect(host.textContent).toContain('Language');
    expect(host.textContent).not.toContain('Язык');
  });
});

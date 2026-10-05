import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { SettingsScreen } from '../../src/screens/Settings';
import { settings, resetSettings } from '../../src/store/settings';
import { lang } from '../../src/i18n';

function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(h(SettingsScreen, {}), host));
  return host;
}

function languageRow(host: HTMLElement): HTMLElement {
  const row = Array.from(host.querySelectorAll('.choice-row')).find((n) => {
    const l = n.querySelector('.choice-label');
    return !!l && (l.textContent === 'Язык' || l.textContent === 'Language');
  });
  expect(row).toBeTruthy();
  return row as HTMLElement;
}

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => undefined;
});
afterEach(() => {
  resetSettings();
  Array.from(document.body.children).forEach((c) => render(null, c));
  document.body.innerHTML = '';
});

describe('TV Settings: language', () => {
  it('a press cycles Как в системе → Русский → English → Как в системе and the UI follows', () => {
    const host = mount();
    const value = () => languageRow(host).querySelector('.choice-value')!.textContent;
    expect(value()).toBe('Как в системе');
    act(() => languageRow(host).click());
    expect(settings.value.language).toBe('ru');
    expect(value()).toBe('Русский');
    act(() => languageRow(host).click());
    expect(settings.value.language).toBe('en');
    expect(lang.value).toBe('en');
    expect(languageRow(host).querySelector('.choice-label')!.textContent).toBe('Language');
    expect(value()).toBe('English');
    act(() => languageRow(host).click());
    expect(settings.value.language).toBe('system');
    expect(value()).toBe('Как в системе');
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Settings } from '../src/screens/Settings';
import { syncNativeLanguage } from '../src/app';
import { native } from '../src/platform/native';
import { resetTo } from '../src/nav';
import { settings, resetSettings } from '../../src/store/settings';
import { lang, applyLanguageSetting } from '../../src/i18n';

function mount(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  act(() => render(<Settings />, el));
  return el;
}

const row = (el: HTMLElement) => el.querySelector('[data-row="language"]') as HTMLButtonElement;

beforeEach(() => {
  localStorage.clear();
  resetSettings();
  resetTo({ name: 'settings' });
});
afterEach(() => {
  act(() => render(null, document.getElementById('app')!));
  resetSettings();
});

describe('phone language switch', () => {
  it('the «Язык» row shows the setting and opens a sheet with the three choices', () => {
    const el = mount();
    expect(row(el).textContent).toContain('Язык');
    expect(row(el).textContent).toContain('Как в системе');
    act(() => row(el).click());
    const radios = Array.from(el.querySelectorAll('[role="dialog"] [role="radio"]')) as HTMLButtonElement[];
    expect(radios.map((r) => r.textContent)).toEqual(['Как в системе', 'Русский', 'English']);
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
  });

  it('a choice stores the setting and the UI switches at once', () => {
    const el = mount();
    act(() => row(el).click());
    const english = Array.from(el.querySelectorAll('[role="dialog"] [role="radio"]')).find((r) => r.textContent === 'English') as HTMLButtonElement;
    act(() => english.click());
    expect(settings.value.language).toBe('en');
    expect(lang.value).toBe('en');
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(row(el).textContent).toContain('Language');
    expect(row(el).textContent).toContain('English');
    act(() => row(el).click());
    const system = Array.from(el.querySelectorAll('[role="dialog"] [role="radio"]')).find((r) => r.textContent === 'As on the device') as HTMLButtonElement;
    act(() => system.click());
    expect(settings.value.language).toBe('system');
    expect(lang.value).toBe('ru');
    expect(row(el).textContent).toContain('Язык');
  });
});

describe('native language', () => {
  it('setLanguage is a no-op off-device and never throws', async () => {
    await expect(native.setLanguage('en')).resolves.toBeUndefined();
  });

  it('the app sends the resolved language on start and whenever it changes', () => {
    const sent: string[] = [];
    const stop = syncNativeLanguage((l) => {
      sent.push(l);
      return Promise.resolve();
    });
    expect(sent).toEqual(['ru']);
    applyLanguageSetting('en');
    expect(sent).toEqual(['ru', 'en']);
    stop();
    applyLanguageSetting('ru');
    expect(sent).toEqual(['ru', 'en']);
  });
});

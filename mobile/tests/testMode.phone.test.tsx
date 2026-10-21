import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('../../src/version', () => ({ APP_VERSION: '0.20.6-beta.1' }));

import { Settings } from '../src/screens/Settings';
import { TestModeHost } from '../src/testmode/host';
import { resetTo } from '../src/nav';
import { resetSettings, settings, updateSettings } from '../../src/store/settings';
import { toast } from '../src/ui/toast';

afterEach(() => {
  resetSettings();
  resetTo({ name: 'connect' });
  document.body.className = '';
  document.body.innerHTML = '';
});

function mount(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  act(() => {
    render(
      <div>
        <Settings />
        <TestModeHost />
      </div>,
      el,
    );
  });
  return el;
}

describe('phone test mode', () => {
  it('offers a label size slider next to the switch on a beta build', () => {
    resetTo({ name: 'settings' });
    const el = mount();
    const row = el.querySelector('[data-code="P11.20"]') as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('Размер меток');
    expect(row.textContent).toContain('12 px');
    const range = row.querySelector('input[type="range"]') as HTMLInputElement;
    expect([range.min, range.max, range.step, range.value]).toEqual(['8', '24', '1', '12']);
    act(() => {
      range.value = '9';
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(settings.value.testLabelPhonePx).toBe(9);
    expect(row.textContent).toContain('9 px');
  });

  it('shows the switch on a beta build and the screen code after it is on', () => {
    resetTo({ name: 'settings' });
    const el = mount();
    const row = el.querySelector('[data-code="P11.19"]') as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('Режим тестирования');
    expect(document.body.classList.contains('test-labels')).toBe(false);
    expect(el.querySelector('.test-screen-badge')).toBeNull();
    const sw = row.querySelector('[role="switch"]') as HTMLElement;
    act(() => { sw.click(); });
    expect(settings.value.testMode).toBe(true);
    expect(document.body.classList.contains('test-labels')).toBe(true);
    const badge = el.querySelector('.test-screen-badge') as HTMLElement;
    expect(badge.textContent).toBe('P11');
    act(() => { badge.click(); });
    expect(toast.value).toContain('P11');
  });

  it('hides the switch again when test mode is turned off', () => {
    resetTo({ name: 'settings' });
    updateSettings({ testMode: true });
    const el = mount();
    expect(el.querySelector('.test-screen-badge')).toBeTruthy();
    updateSettings({ testMode: false });
    act(() => {
      render(
        <div>
          <Settings />
          <TestModeHost />
        </div>,
        el,
      );
    });
    expect(document.body.classList.contains('test-labels')).toBe(false);
  });
});

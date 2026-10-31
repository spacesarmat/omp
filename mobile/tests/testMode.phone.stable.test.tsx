import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

// a stable version no matter what package.json says (a beta release bumps it to x.y.z-beta.N)
vi.mock('../../src/version', () => ({ APP_VERSION: '0.20.5' }));

import { Settings } from '../src/screens/Settings';
import { TestModeHost } from '../src/testmode/host';
import { resetTo } from '../src/nav';
import { resetSettings, updateSettings } from '../../src/store/settings';

afterEach(() => {
  resetSettings();
  resetTo({ name: 'connect' });
  document.body.className = '';
  document.body.innerHTML = '';
});

describe('phone test mode on a stable build', () => {
  it('hides the switch and the screen code even if the setting was left on', () => {
    updateSettings({ testMode: true });
    resetTo({ name: 'settings' });
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
    expect(el.querySelector('[data-code="P11.19"]')).toBeNull();
    expect(el.querySelector('[data-code="P11.20"]')).toBeNull();
    expect(el.textContent).not.toContain('Режим тестирования');
    expect(el.querySelector('.test-screen-badge')).toBeNull();
    expect(document.body.classList.contains('test-labels')).toBe(false);
  });
});
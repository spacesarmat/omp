import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';

// a stable version no matter what package.json says (a beta release bumps it to x.y.z-beta.N)
vi.mock('../../src/version', () => ({ APP_VERSION: '0.20.5' }));

import { SettingsScreen } from '../../src/screens/Settings';
import { resetSettings, updateSettings } from '../../src/store/settings';
import { ScreenCodeBadge } from '../../src/testmode/badge';
import { routeStack } from '../../src/ui/nav';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!(Element.prototype as { scrollIntoView?: () => void }).scrollIntoView) {
    (Element.prototype as { scrollIntoView: () => void }).scrollIntoView = () => undefined;
  }
});

afterEach(() => {
  resetSettings();
  routeStack.value = [{ name: 'connect' }];
  document.body.innerHTML = '';
});

describe('test mode on a stable build', () => {
  it('hides the switch and every label', () => {
    updateSettings({ testMode: true });
    routeStack.value = [{ name: 'settings' }];
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => { render(h('div', null, h(SettingsScreen, null), h(ScreenCodeBadge, null)), host); });
    expect(host.textContent).not.toContain('Режим тестирования');
    expect(host.textContent).not.toContain('Test mode');
    expect(host.textContent).not.toContain('Размер меток');
    expect(host.querySelector('[data-fk="set-test-size"]')).toBeNull();
    expect(host.querySelector('.test-badge')).toBeNull();
    expect(host.querySelector('.test-screen-badge')).toBeNull();
  });
});

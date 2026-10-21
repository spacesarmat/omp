import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, h, type VNode } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';

vi.mock('../../src/version', () => ({ APP_VERSION: '0.20.6-beta.1' }));

import { SettingsScreen } from '../../src/screens/Settings';
import { resetSettings, settings, updateSettings } from '../../src/store/settings';
import { ScreenCodeBadge } from '../../src/testmode/badge';
import { routeStack } from '../../src/ui/nav';
import { ToastHost } from '../../src/ui/toast';

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

function mount(node: VNode): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => { render(node, host); });
  return host;
}

describe('test mode on a beta build', () => {
  it('shows the switch, then the codes, and a pointer click copies the screen code', () => {
    const host = mount(h(SettingsScreen, {}));
    const row = Array.from(host.querySelectorAll('.choice-row')).find((n) => {
      const label = n.querySelector('.choice-label');
      return !!label && label.textContent === 'Режим тестирования';
    }) as HTMLElement;
    expect(row).toBeTruthy();
    expect(host.querySelector('.test-badge')).toBeNull();
    act(() => { row.click(); });
    expect(settings.value.testMode).toBe(true);
    const badge = row.querySelector('.test-badge');
    expect(badge && badge.textContent).toBe('S05.29.1');
    expect(badge!.getAttribute('data-fk')).toBeNull();
    expect(badge!.closest('[data-fk]')!.getAttribute('data-fk')).toBe('set-test-mode');

    updateSettings({ testMode: true });
    routeStack.value = [{ name: 'settings' }];
    const corner = mount(h('div', null, h(ScreenCodeBadge, null), h(ToastHost, null)));
    const screen = corner.querySelector('.test-screen-badge') as HTMLElement;
    expect(screen.querySelector('.test-badge')!.textContent).toBe('S05');
    expect(screen.getAttribute('data-fk')).toBeNull();
    act(() => { screen.click(); });
    expect(corner.textContent).toContain('Код S05');
  });
});

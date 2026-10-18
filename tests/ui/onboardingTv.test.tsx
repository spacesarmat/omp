import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, h } from 'preact';
import type { ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { init, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { OnboardingScreen } from '../../src/ui/OnboardingScreen';
import { SettingsScreen } from '../../src/screens/Settings';
import { currentRoute, resetTo } from '../../src/ui/nav';
import { settings, updateSettings } from '../../src/store/settings';
import { removeServer, servers, setActiveServer } from '../../src/store/servers';
import { dispatchKey } from '../../src/ui/keys';
import {
  ONBOARDING_VERSION,
  onboardingForce,
  onboardingReady,
  onboardingVisible,
  pauseOnboarding,
  resetOnboardingRuntime,
  resumeOnboarding,
} from '../../src/onboarding/gate';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  localStorage.clear();
  resetOnboardingRuntime();
  updateSettings({ onboardingVersion: 0 });
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(null);
  resetTo({ name: 'library' });
  document.body.innerHTML = '';
});

async function mount(node: ComponentChild): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    render(node, host);
  });
  return host;
}

describe('TV onboarding', () => {
  it('shows on first launch, moves with the remote, and skip stores the version', async () => {
    expect(onboardingVisible('tv', 'library')).toBe(false);
    resumeOnboarding();
    onboardingReady.value = true;
    expect(onboardingVisible('tv', 'library')).toBe(true);
    expect(onboardingVisible('tv', 'player')).toBe(false);

    const host = await mount(h(OnboardingScreen, {}));
    expect(host.querySelector('[data-onboarding="tv"]')!.getAttribute('data-slide')).toBe('welcome');
    expect(host.textContent).toContain('Пропустить');
    expect(host.textContent).toContain('Далее');
    expect(host.querySelector('[data-fk="onb-skip"]')).toBeTruthy();
    expect(host.querySelector('[data-fk="onb-next"]')).toBeTruthy();

    expect(dispatchKey('left', new KeyboardEvent('keydown'))).toBe(true);
    expect(dispatchKey('right', new KeyboardEvent('keydown'))).toBe(true);
    expect(host.querySelector('[data-step]')!.getAttribute('data-step')).toBe('0');
    setFocus('onb-next');

    await act(async () => {
      (host.querySelector('[data-fk="onb-next"]') as HTMLElement).click();
    });
    expect(host.querySelector('[data-step]')!.getAttribute('data-step')).toBe('1');
    await act(async () => {
      dispatchKey('back', new KeyboardEvent('keydown'));
    });
    expect(host.querySelector('[data-step]')!.getAttribute('data-step')).toBe('0');
    await act(async () => {
      dispatchKey('back', new KeyboardEvent('keydown'));
    });
    expect(settings.value.onboardingVersion).toBe(ONBOARDING_VERSION);
    expect(JSON.parse(localStorage.getItem('tsp.settings')!).onboardingVersion).toBe(ONBOARDING_VERSION);
    expect(onboardingVisible('tv', 'library')).toBe(false);
  });

  it('waits out a player launch, then the last step offers connect', async () => {
    onboardingReady.value = true;
    pauseOnboarding();
    expect(onboardingVisible('tv', 'library')).toBe(false);
    resumeOnboarding();
    const host = await mount(h(OnboardingScreen, {}));
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        (host.querySelector('[data-fk="onb-next"]') as HTMLElement).click();
      });
    }
    expect(host.querySelector('[data-slide]')!.getAttribute('data-slide')).toBe('ready');
    expect(host.textContent).toContain('Подключить сервер');
    await act(async () => {
      (host.querySelector('[data-fk="onb-next"]') as HTMLElement).click();
    });
    expect(currentRoute.value.name).toBe('connect');
    expect(settings.value.onboardingVersion).toBe(ONBOARDING_VERSION);
  });

  it('Settings replays it', async () => {
    updateSettings({ onboardingVersion: ONBOARDING_VERSION });
    const host = await mount(h(SettingsScreen, {}));
    expect(onboardingForce.value).toBe(false);
    const row = host.querySelector('[data-fk="set-onboarding"]') as HTMLElement;
    expect(row.textContent).toContain('Показать знакомство с приложением');
    await act(async () => row.click());
    expect(onboardingForce.value).toBe(true);
    expect(onboardingVisible('tv', 'settings')).toBe(true);
  });
});

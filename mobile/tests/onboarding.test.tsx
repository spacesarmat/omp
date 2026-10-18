import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import type { ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { App } from '../src/app';
import { Settings } from '../src/screens/Settings';
import { Onboarding } from '../src/ui/Onboarding';
import { currentRoute, resetTo } from '../src/nav';
import { settings, updateSettings } from '../../src/store/settings';
import { applyLanguageSetting } from '../../src/i18n';
import { activeServer, addServer, removeServer, servers, setActiveServer } from '../../src/store/servers';
import { EPISODES_ID } from '../../src/monitor/types';
import { openNewsLink } from '../src/monitor/ui';
import {
  ONBOARDING_VERSION,
  onboardingHold,
  onboardingReady,
  onboardingVisible,
  resetOnboardingRuntime,
} from '../../src/onboarding/gate';

const roots: HTMLElement[] = [];

function mount(node: ComponentChild): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  roots.push(el);
  act(() => {
    render(node, el);
  });
  return el;
}

async function mountApp(): Promise<HTMLElement> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  roots.push(el);
  // Effects start the magnet / billing / notification intakes. Their promises settle after this
  // act returns, and only then is the tour allowed to show.
  await act(async () => {
    render(<App />, el);
  });
  const deadline = Date.now() + 1000;
  while (!onboardingReady.value && Date.now() < deadline) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  await act(async () => {});
  return el;
}

/** The same gate the phone shell uses, without the rest of the app. */
function Tour() {
  const route = currentRoute.value.name;
  return onboardingVisible('phone', route) ? <Onboarding /> : null;
}

beforeEach(() => {
  localStorage.clear();
  resetOnboardingRuntime();
  updateSettings({ onboardingVersion: 0, language: 'ru' });
  applyLanguageSetting('ru');
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(null);
  resetTo({ name: 'library' });
});

afterEach(() => {
  for (const el of roots.splice(0)) render(null, el);
  document.body.innerHTML = '';
});

describe('phone onboarding', () => {
  it('shows once on first launch; skip stores the version and does not return', async () => {
    const el = await mountApp();
    const tour = el.querySelector('[data-onboarding="phone"]');
    expect(onboardingReady.value).toBe(true);
    expect(currentRoute.value.name).toBe('library');
    expect(onboardingHold.value).toBeNull();
    expect(tour!.getAttribute('data-slide')).toBe('welcome');
    expect(tour!.textContent).toContain('Пропустить');
    expect(tour!.textContent).toContain('Далее');
    expect(tour!.textContent).toContain('1 из 6');
    await act(async () => {
      (el.querySelector('[data-action="skip"]') as HTMLButtonElement).click();
    });
    expect(settings.value.onboardingVersion).toBe(ONBOARDING_VERSION);
    expect(JSON.parse(localStorage.getItem('tsp.settings')!).onboardingVersion).toBe(ONBOARDING_VERSION);
    expect(el.querySelector('[data-onboarding]')).toBeNull();

    render(null, el);
    const again = await mountApp();
    expect(again.querySelector('[data-onboarding]')).toBeNull();
  });

  it('does not cover the audiobook player or a notification deep link', async () => {
    resetTo({ name: 'audiobookPlayer', hash: 'a'.repeat(40), token: 1 });
    onboardingReady.value = true;
    const player = mount(<Tour />);
    expect(player.querySelector('[data-onboarding]')).toBeNull();

    resetTo({ name: 'library' });
    const home = mount(<Tour />);
    expect(home.querySelector('[data-slide]')).toBeTruthy();
    render(null, home);

    setActiveServer(addServer({ url: 'http://192.168.1.5:8090', name: 'Home' }).id);
    openNewsLink('omp:news?sub=' + EPISODES_ID + '&finding=k');
    expect(currentRoute.value.name).toBe('news');
    expect(onboardingHold.value).toBe('news');
    const news = mount(<Tour />);
    expect(news.querySelector('[data-onboarding]')).toBeNull();
    resetTo({ name: 'library' });
    const after = mount(<Tour />);
    expect(after.querySelector('[data-onboarding]')).toBeTruthy();
  });

  it('Next walks the screens; the last one connects a server and stores the version', async () => {
    onboardingReady.value = true;
    const el = mount(<Tour />);
    const seen: string[] = [el.textContent || ''];
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        (el.querySelector('[data-action="next"]') as HTMLButtonElement).click();
      });
      seen.push(el.textContent || '');
    }
    const all = seen.join('\n');
    expect(all).toContain('Аудиокниги');
    expect(all).toContain('Звук в фоне');
    expect(all).toContain('Jackett');
    expect(el.querySelector('[data-slide]')!.getAttribute('data-slide')).toBe('ready');
    expect(el.querySelector('[data-action="connect"]')).toBeTruthy();
    expect(el.textContent).toContain('Подключить сервер');
    await act(async () => {
      (el.querySelector('[data-action="connect"]') as HTMLButtonElement).click();
    });
    expect(settings.value.onboardingVersion).toBe(ONBOARDING_VERSION);
    expect(currentRoute.value.name).toBe('connect');
    expect(el.querySelector('[data-onboarding]')).toBeNull();
  });

  it('Settings replays the tour after it was finished', async () => {
    updateSettings({ onboardingVersion: ONBOARDING_VERSION });
    onboardingReady.value = true;
    resetTo({ name: 'settings' });
    const el = mount(
      <>
        <Settings />
        <Tour />
      </>,
    );
    expect(el.querySelector('[data-onboarding]')).toBeNull();
    const row = el.querySelector('[data-row="onboarding"]') as HTMLButtonElement;
    expect(row.textContent).toContain('Показать знакомство с приложением');
    await act(async () => row.click());
    expect(el.querySelector('[data-slide]')!.getAttribute('data-slide')).toBe('welcome');
    await act(async () => {
      (el.querySelector('[data-action="skip"]') as HTMLButtonElement).click();
    });
    expect(el.querySelector('[data-onboarding]')).toBeNull();
    expect(settings.value.onboardingVersion).toBe(ONBOARDING_VERSION);
    expect(activeServer.value).toBeNull();
  });

  it('uses the English labels', () => {
    applyLanguageSetting('en');
    onboardingReady.value = true;
    resetTo({ name: 'settings' });
    const el = mount(
      <>
        <Settings />
        <Tour />
      </>,
    );
    expect(el.querySelector('[data-row="onboarding"]')!.textContent).toContain('Show onboarding');
    expect(el.textContent).toContain('Skip');
    expect(el.textContent).toContain('Next');
    applyLanguageSetting('ru');
  });
});

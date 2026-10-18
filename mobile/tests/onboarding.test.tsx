import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import type { ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { App } from '../src/app';
import { Settings } from '../src/screens/Settings';
import { Onboarding } from '../src/ui/Onboarding';
import { Setup } from '../src/ui/Setup';
import { HintHost, useHint } from '../src/ui/Hint';
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
  openOnboarding,
  resetOnboardingRuntime,
  setupVisible,
} from '../../src/onboarding/gate';
import { resetHints } from '../../src/onboarding/hints';
import { mockFetch } from '../../tests/helpers/fetchMock';

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

function SetupGate() {
  const route = currentRoute.value.name;
  return setupVisible(route, !!activeServer.value) ? <Setup /> : null;
}

function HintPage() {
  useHint('catalog');
  useHint('mine');
  return (
    <>
      <button type="button" data-hint-anchor="catalog">search</button>
      <button type="button" data-hint-anchor="mine">mine</button>
      <HintHost blocked={false} />
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  resetOnboardingRuntime();
  updateSettings({ onboardingVersion: 0, language: 'ru', setupDone: false, seenHints: {} });
  applyLanguageSetting('ru');
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(null);
  resetTo({ name: 'library' });
});

afterEach(() => {
  for (const el of roots.splice(0)) render(null, el);
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('phone onboarding', () => {
  it('shows setup on first launch without a server; skip stores that and does not return', async () => {
    const el = await mountApp();
    const setup = el.querySelector('[data-setup]');
    expect(onboardingReady.value).toBe(true);
    expect(setup!.getAttribute('data-setup')).toBe('where');
    expect(el.querySelector('[data-onboarding="phone"]')).toBeNull();
    expect(setup!.textContent).toContain('Где TorrServer?');
    expect(setup!.textContent).toContain('На этом телефоне');
    expect(setup!.textContent).toContain('В домашней сети');
    expect(setup!.textContent).toContain('QR с телевизора');
    expect(setup!.textContent).toContain('Пропустить');
    await act(async () => {
      (el.querySelector('[data-action="skip"]') as HTMLButtonElement).click();
    });
    expect(settings.value.setupDone).toBe(true);
    expect(JSON.parse(localStorage.getItem('tsp.settings')!).setupDone).toBe(true);
    expect(el.querySelector('[data-setup]')).toBeNull();

    render(null, el);
    const again = await mountApp();
    expect(again.querySelector('[data-setup]')).toBeNull();
    expect(again.querySelector('[data-onboarding="phone"]')).toBeNull();
  });

  it('does not show setup when a server is already saved', async () => {
    setActiveServer(addServer({ url: 'http://192.168.1.5:8090', name: 'Home' }).id);
    const el = await mountApp();
    expect(el.querySelector('[data-setup]')).toBeNull();
    expect(el.querySelector('[data-onboarding="phone"]')).toBeNull();
  });

  it('does not cover the audiobook player or a notification deep link', async () => {
    resetTo({ name: 'audiobookPlayer', hash: 'a'.repeat(40), token: 1 });
    onboardingReady.value = true;
    const player = mount(<SetupGate />);
    expect(player.querySelector('[data-setup]')).toBeNull();

    resetTo({ name: 'library' });
    const home = mount(<SetupGate />);
    expect(home.querySelector('[data-setup]')).toBeTruthy();
    render(null, home);

    setActiveServer(addServer({ url: 'http://192.168.1.5:8090', name: 'Home' }).id);
    openNewsLink('omp:news?sub=' + EPISODES_ID + '&finding=k');
    expect(currentRoute.value.name).toBe('news');
    expect(onboardingHold.value).toBe('news');
    const news = mount(<SetupGate />);
    expect(news.querySelector('[data-setup]')).toBeNull();
  });

  it('a failed address can be retried', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    onboardingReady.value = true;
    const el = mount(<Setup />);
    await act(async () => {
      (el.querySelector('[data-setup-choice="home"]') as HTMLButtonElement).click();
    });
    const input = el.querySelector('[data-setup-address]') as HTMLInputElement;
    await act(async () => {
      input.value = '192.168.1.10:8090';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      (el.querySelector('[data-action="connect"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(el.querySelector('[data-result="fail"]')).toBeTruthy();
    await act(async () => {
      (el.querySelector('[data-action="retry"]') as HTMLButtonElement).click();
    });
    expect(el.querySelector('[data-setup]')!.getAttribute('data-setup')).toBe('network');
  });

  it('Next walks the screens; the last one connects a server and stores the version', async () => {
    openOnboarding();
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
    expect(el.querySelector('[data-row="reset-hints"]')!.textContent).toContain('Сбросить подсказки');
    updateSettings({ seenHints: { catalog: true } });
    await act(async () => {
      (el.querySelector('[data-row="reset-hints"]') as HTMLButtonElement).click();
    });
    expect(settings.value.seenHints.catalog).toBeUndefined();
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
    openOnboarding();
    resetTo({ name: 'settings' });
    const el = mount(
      <>
        <Settings />
        <Tour />
      </>,
    );
    expect(el.querySelector('[data-row="onboarding"]')!.textContent).toContain('Show onboarding');
    expect(el.querySelector('[data-row="reset-hints"]')!.textContent).toContain('Reset hints');
    expect(el.textContent).toContain('Skip');
    expect(el.textContent).toContain('Next');
    applyLanguageSetting('ru');
  });

  it('shows each hint once, then again after the reset', async () => {
    const el = mount(<HintPage />);
    expect(el.querySelector('[data-hint]')!.getAttribute('data-hint')).toBe('catalog');
    await act(async () => {
      (el.querySelector('[data-action="hint-dismiss"]') as HTMLButtonElement).click();
    });
    expect(settings.value.seenHints.catalog).toBe(true);
    expect(el.querySelector('[data-hint]')!.getAttribute('data-hint')).toBe('mine');
    await act(async () => {
      (el.querySelector('[data-action="hint-dismiss"]') as HTMLButtonElement).click();
    });
    expect(el.querySelector('[data-hint]')).toBeNull();
    render(null, el);
    const again = mount(<HintPage />);
    expect(again.querySelector('[data-hint]')).toBeNull();
    resetHints();
    const restored = mount(<HintPage />);
    expect(restored.querySelector('[data-hint]')!.getAttribute('data-hint')).toBe('catalog');
  });
});

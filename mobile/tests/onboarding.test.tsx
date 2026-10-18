import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import type { ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { App } from '../src/app';
import { Settings } from '../src/screens/Settings';
import { Onboarding } from '../src/ui/Onboarding';
import { Setup } from '../src/ui/Setup';
import { HintHost, useHint } from '../src/ui/Hint';
import { placeCoachMark } from '../src/ui/hintPlace';
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
import { closeWhatsNew } from '../../src/store/whatsNew';
import { WhatsNewSheet } from '../src/ui/WhatsNewSheet';
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
  document.documentElement.classList.remove('m-hint-hold');
  closeWhatsNew();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

let catalogTop = 72;
let mineTop = 72;

function installGeometry(): void {
  catalogTop = 72;
  mineTop = 72;
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(844);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const id = this.getAttribute('data-hint-anchor');
    if (id === 'catalog') return new DOMRect(300, catalogTop, 44, 44);
    if (id === 'mine') return new DOMRect(40, mineTop, 80, 36);
    if (id) return new DOMRect(24, catalogTop, 44, 44);
    if (this.classList.contains('m-hint')) return new DOMRect(0, 0, 280, 100);
    return new DOMRect(0, 0, 0, 0);
  });
}

async function frames(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

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
    installGeometry();
    const el = mount(<HintPage />);
    const mark = el.querySelector('.m-hint')!;
    expect(mark.getAttribute('data-hint')).toBe('catalog');
    expect(mark.getAttribute('data-place')).toBe('below');
    expect(mark.querySelector('[data-hint-arrow]')).toBeTruthy();
    expect(mark.querySelector('p')!.textContent).toBe('Поиск фильма или сериала — эта кнопка. «Добавить» ищет по трекерам.');
    expect(mark.querySelector('[data-action="hint-dismiss"]')!.textContent).toBe('Понятно');
    await act(async () => {
      (el.querySelector('[data-action="hint-dismiss"]') as HTMLButtonElement).click();
    });
    expect(settings.value.seenHints.catalog).toBe(true);
    expect(el.querySelector('[data-hint]')!.getAttribute('data-hint')).toBe('mine');
    expect(el.querySelector('[data-hint-arrow]')).toBeTruthy();
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

  it('uses the English coach-mark copy', () => {
    installGeometry();
    applyLanguageSetting('en');
    const el = mount(<HintPage />);
    expect(el.querySelector('.m-hint p')!.textContent).toBe('Search for a movie or a series is this button. Add searches the trackers.');
    expect(el.querySelector('[data-action="hint-dismiss"]')!.textContent).toBe('Got it');
    applyLanguageSetting('ru');
  });

  it('clears the status bar: a control tucked under it is skipped, and «Мои» is drawn underneath', async () => {
    installGeometry();
    catalogTop = 70;
    const el = mount(<HintPage />);
    expect(el.querySelector('.m-hint')).toBeTruthy();
    const probe = el.querySelector('.m-hint-insets') as HTMLElement;
    probe.style.paddingTop = '200px';
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    // the switch is inside the status bar, so there is nothing on screen to point at
    expect(el.querySelector('.m-hint')).toBeNull();
    expect(settings.value.seenHints.catalog).toBeUndefined();

    probe.style.paddingTop = '48px';
    catalogTop = 72;
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    const hint = el.querySelector('.m-hint') as HTMLElement;
    expect(hint.getAttribute('data-hint')).toBe('catalog');
    expect(hint.getAttribute('data-place')).toBe('below');
    expect(Number.parseFloat(hint.style.top)).toBeGreaterThanOrEqual(48 + 8);
    expect(hint.querySelector('[data-hint-arrow]')).toBeTruthy();
  });

  it('follows the control on scroll and hides when it leaves the screen', async () => {
    installGeometry();
    const el = mount(<HintPage />);
    const spot = () =>
      placeCoachMark(
        { top: catalogTop, left: 300, width: 44, height: 44, right: 344, bottom: catalogTop + 44 },
        { width: 280, height: 100 },
        390,
        844,
      );
    const hint = () => el.querySelector('.m-hint') as HTMLElement | null;
    expect(hint()!.style.top).toBe(Math.round(spot()!.top) + 'px');
    expect(hint()!.style.left).toBe(Math.round(spot()!.left) + 'px');
    expect((hint()!.querySelector('[data-hint-arrow]') as HTMLElement).style.left).toBe(Math.round(spot()!.arrow) + 'px');

    const top0 = hint()!.style.top;
    catalogTop = 220;
    await act(async () => {
      document.dispatchEvent(new Event('scroll'));
    });
    expect(Number.parseFloat(hint()!.style.top)).toBeGreaterThan(Number.parseFloat(top0));
    expect(hint()!.style.top).toBe(Math.round(spot()!.top) + 'px');
    expect(settings.value.seenHints.catalog).toBeUndefined();

    catalogTop = -400;
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
    });
    // mine is still on screen; catalog stays the queued hint and is not replaced
    expect(hint()).toBeNull();
    expect(document.documentElement.classList.contains('m-hint-hold')).toBe(false);

    catalogTop = 72;
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(hint()!.getAttribute('data-hint')).toBe('catalog');
    expect(hint()!.style.top).toBe(Math.round(spot()!.top) + 'px');
  });

  it('waits out a sheet, and Close still dismisses it', async () => {
    installGeometry();
    const el = mount(
      <>
        <HintPage />
        <WhatsNewSheet />
      </>,
    );
    expect(el.querySelector('.m-hint')).toBeTruthy();
    await act(async () => {
      const { whatsNew } = await import('../../src/store/whatsNew');
      whatsNew.value = {
        title: 'Что нового в 0.20.4-beta.4',
        auto: false,
        entries: [{ version: '0.20.4-beta.4', items: ['Подсказки'] }],
      };
    });
    await frames();
    expect(el.querySelector('[role="dialog"]')).toBeTruthy();
    expect(el.querySelector('.m-hint')).toBeNull();
    expect(document.documentElement.classList.contains('m-hint-hold')).toBe(true);
    expect(settings.value.seenHints.catalog).toBeUndefined();
    const close = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Закрыть') as HTMLButtonElement;
    expect(close.className).toContain('m-btn-primary');
    await act(async () => {
      close.click();
    });
    await frames();
    expect(el.querySelector('.m-sheet')).toBeNull();
    expect(el.querySelector('.m-hint')!.getAttribute('data-hint')).toBe('catalog');
    expect(document.documentElement.classList.contains('m-hint-hold')).toBe(false);
    expect(settings.value.seenHints.catalog).toBeUndefined();
  });

  it('queues the same way for the tour, setup, and any other dialog', async () => {
    installGeometry();
    const tour = mount(
      <>
        <HintPage />
        <Onboarding />
      </>,
    );
    expect(tour.querySelector('[data-onboarding="phone"]')).toBeTruthy();
    expect(tour.querySelector('.m-hint')).toBeNull();
    render(null, tour);

    const setup = mount(
      <>
        <HintPage />
        <Setup />
      </>,
    );
    expect(setup.querySelector('[data-onboarding="setup"]')).toBeTruthy();
    expect(setup.querySelector('.m-hint')).toBeNull();
    render(null, setup);

    const el = mount(<HintPage />);
    expect(el.querySelector('.m-hint')).toBeTruthy();
    await act(async () => {
      const dialog = document.createElement('div');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('data-test-overlay', '');
      document.body.appendChild(dialog);
    });
    await frames();
    expect(el.querySelector('.m-hint')).toBeNull();
    await act(async () => {
      document.querySelector('[data-test-overlay]')!.remove();
    });
    await frames();
    expect(el.querySelector('.m-hint')!.getAttribute('data-hint')).toBe('catalog');
  });

  it('stays off «Сейчас играет» and while blocked, and the TV shell has none', () => {
    installGeometry();
    resetTo({ name: 'nowPlaying' });
    const playing = mount(<HintPage />);
    expect(playing.querySelector('.m-hint')).toBeNull();

    resetTo({ name: 'library' });
    function Blocked() {
      useHint('catalog');
      return (
        <>
          <button type="button" data-hint-anchor="catalog">search</button>
          <HintHost blocked={true} />
        </>
      );
    }
    const blocked = mount(<Blocked />);
    expect(blocked.querySelector('.m-hint')).toBeNull();

    const tv = readFileSync(resolve('src/app.tsx'), 'utf8');
    expect(tv).not.toContain('HintHost');
    expect(tv).not.toContain('useHint');
    expect(tv).not.toContain('data-hint-anchor');
    const css = readFileSync(resolve('mobile/src/mobile.css'), 'utf8');
    const z = (rule: string) => {
      const m = new RegExp(rule + '\\s*\\{[^}]*z-index:\\s*(\\d+)').exec(css);
      if (!m) throw new Error('no z-index in ' + rule);
      return Number(m[1]);
    };
    expect(z('\\.m-hint')).toBeLessThan(z('\\.m-sheet-host'));
    expect(z('\\.m-hint')).toBeLessThan(z('\\.m-onb'));
    expect(css).toContain('html.m-hint-hold .m-hint');
    expect(css).toContain('.m-hint-arrow');
  });
});

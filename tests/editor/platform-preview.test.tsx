import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultFlow, createDefaultTheme } from '../../design/defaults';
import type { DesktopRouteId } from '../../desktop/src/shell/routes';
import type { DesktopPreviewProps } from '../../desktop/src/preview/DesktopPreview';
import { PhonePreview } from '../../desktop/src/preview/PhonePreview';
import { TvPreview } from '../../desktop/src/preview/TvPreview';
import { platformKind } from '../../src/platform/env';
import { lang } from '../../src/i18n';
import { settings } from '../../src/store/settings';

const BASE = '0000000000000000000000000000000000000000';
let host: HTMLDivElement;

function props(route: DesktopRouteId, target: DesktopPreviewProps['target']): DesktopPreviewProps {
  const theme = createDefaultTheme(BASE);
  theme.overrides.push({ id: `page-${target}`, scope: 'target', target, tokens: { '--omp-color-background': '#112233' } });
  return {
    target,
    route,
    format: 'landscape',
    language: 'ru',
    mode: 'design',
    serverConnected: false,
    state: 'default',
    theme,
    flow: createDefaultFlow(BASE),
    onSelect: () => undefined,
    onNavigate: () => undefined,
    onTrace: () => undefined,
  };
}

function mount(element: h.JSX.Element): void {
  act(() => render(element, host));
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.restoreAllMocks();
});

describe('platform previews', () => {
  it('applies interactive state overrides on phone and TV components', () => {
    for (const target of ['android-phone', 'android-tv'] as const) {
      const config = props('settings', target);
      config.state = 'hover';
      config.theme.overrides.push({ id: `hover-${target}`, scope: 'state', state: 'hover', target, tokens: { '--omp-color-panel': '#112233' } });
      if (target === 'android-phone') mount(h(PhonePreview, config));
      else mount(h(TvPreview, config));

      const page = host.querySelector('[data-design-state="hover"]')!;
      expect(page.getAttribute('data-design-state')).toBe('hover');
      const button = host.querySelector<HTMLElement>('[data-design-id="button"]')!;
      expect(button.getAttribute('data-design-overrides')).toContain(`hover-${target}`);
      expect(getComputedStyle(button).getPropertyValue('--omp-color-panel').trim()).toBe('#112233');
    }
  });

  it('refreshes internal overrides when interactive state changes after mount', () => {
    for (const target of ['android-phone', 'android-tv'] as const) {
      const config = props('settings', target);
      config.theme.overrides.push({ id: `live-${target}`, scope: 'state', state: 'hover', target, tokens: { '--omp-color-panel': '#112233' } });
      if (target === 'android-phone') mount(h(PhonePreview, config));
      else mount(h(TvPreview, config));
      expect(host.querySelector('[data-design-id="button"]')!.getAttribute('data-design-overrides')).not.toContain(`live-${target}`);

      config.state = 'hover';
      if (target === 'android-phone') mount(h(PhonePreview, config));
      else mount(h(TvPreview, config));

      expect(host.querySelector('[data-design-id="button"]')!.getAttribute('data-design-overrides')).toContain(`live-${target}`);
    }
  });

  it('renders every phone route with the active page override', () => {
    for (const route of ['library', 'news', 'search', 'remote', 'settings', 'connect'] as const) {
      mount(h(PhonePreview, props(route, 'android-phone')));
      const page = host.querySelector('[data-design-id="legacy-page"]')!;
      expect(page.getAttribute('data-design-overrides')).toContain('page-android-phone');
      expect(page.getAttribute('data-design-target')).toBe('android-phone');
    }
  });

  it('marks internal phone and TV components with active overrides', () => {
    mount(h(PhonePreview, props('settings', 'android-phone')));
    expect(host.querySelector('button.m-btn')!.getAttribute('data-design-id')).toBe('button');
    expect(host.querySelector('button.m-btn')!.getAttribute('data-design-overrides')).toContain('page-android-phone');

    mount(h(TvPreview, props('settings', 'android-tv')));
    expect(host.querySelector('.choice-row')!.getAttribute('data-design-id')).toBe('choice-row');
    expect(host.querySelector('.choice-row')!.getAttribute('data-design-overrides')).toContain('page-android-tv');
  });

  it('rebinds phone and TV control aliases to element color overrides', () => {
    for (const target of ['android-phone', 'android-tv'] as const) {
      const config = props('settings', target);
      config.theme.overrides.push({
        id: `colors-${target}`,
        scope: 'element',
        target,
        screenId: 'settings',
        elementId: 'button',
        format: 'landscape',
        tokens: { '--omp-color-accent': '#112233', '--omp-color-text': '#ddeeff' },
      });
      if (target === 'android-phone') mount(h(PhonePreview, config));
      else mount(h(TvPreview, config));

      const button = host.querySelector<HTMLElement>('[data-design-id="button"]')!;
      expect(getComputedStyle(button).getPropertyValue('--omp-color-accent').trim()).toBe('#112233');
      expect(getComputedStyle(button).getPropertyValue('--omp-color-text').trim()).toBe('#ddeeff');
      expect(button.style.getPropertyValue('--accent')).toBe('var(--omp-color-accent)');
      expect(button.style.getPropertyValue('--text')).toBe('var(--omp-color-text)');
    }
  });

  it('keeps page element colors inherited by phone control aliases', () => {
    const config = props('settings', 'android-phone');
    config.theme.overrides.push({
      id: 'page-text-color',
      scope: 'element',
      target: 'android-phone',
      screenId: 'settings',
      elementId: 'legacy-page',
      format: 'landscape',
      tokens: { '--omp-color-text': '#ddeeff' },
    });
    mount(h(PhonePreview, config));

    const button = host.querySelector<HTMLElement>('[data-design-id="button"]')!;
    expect(getComputedStyle(button).getPropertyValue('--omp-color-text').trim()).toBe('#ddeeff');
    expect(button.style.getPropertyValue('--text')).toBe('var(--omp-color-text)');
  });

  it('renders every TV route with the matching platform kind and restores it on unmount', () => {
    for (const target of ['android-tv', 'lg-webos'] as const) {
      for (const route of ['library', 'search', 'settings', 'connect'] as const) {
        mount(h(TvPreview, props(route, target)));
        expect(platformKind()).toBe(target === 'android-tv' ? 'androidtv' : 'webos');
        const page = host.querySelector('[data-design-id="legacy-page"]')!;
        expect(page.getAttribute('data-design-overrides')).toContain(`page-${target}`);
        expect(page.getAttribute('data-design-target')).toBe(target);
        act(() => render(null, host));
        expect(platformKind()).toBe('webos');
      }
    }
  });

  it('selects phone and TV controls without running their real actions', () => {
    const previous = settings.value;
    try {
      const onSelect = vi.fn();
      mount(h(PhonePreview, { ...props('settings', 'android-phone'), onSelect }));
      const before = settings.value.prebufferOnMetered;
      host.querySelector<HTMLElement>('[data-row="prebuffer"] .m-switch')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(settings.value.prebufferOnMetered).toBe(before);
      expect(onSelect).toHaveBeenCalledWith('button');

      mount(h(TvPreview, { ...props('settings', 'android-tv'), onSelect }));
      const tvBefore = settings.value;
      host.querySelector<HTMLElement>('.choice-row')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(settings.value).toBe(tvBefore);
    } finally {
      settings.value = previous;
    }
  });

  it('preserves the default click action for preview text fields', () => {
    mount(h(PhonePreview, props('search', 'android-phone')));
    const input = host.querySelector<HTMLInputElement>('input')!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });

    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('replaces a fixture without restoring stale state', () => {
    const previous = lang.value;
    mount(h(PhonePreview, props('settings', 'android-phone')));
    mount(h(PhonePreview, { ...props('settings', 'android-phone'), language: 'en' }));
    expect(lang.value).toBe('en');
    act(() => render(null, host));
    expect(lang.value).toBe(previous);
  });

  it('moves TV library to connect when no server is selected', () => {
    const onNavigate = vi.fn();
    mount(h(TvPreview, { ...props('library', 'android-tv'), onNavigate }));

    expect(onNavigate).toHaveBeenCalledWith('connect');
  });
});

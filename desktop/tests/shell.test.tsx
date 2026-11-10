import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultFlow, createDefaultTheme } from '../../design/defaults';
import { activeOverrideIds } from '../../design/theme';
import type { DesktopDesignTarget, DesignFormat } from '../../design/schema';
import type { InteractionTrace } from '../../design/interaction';
import { lang } from '../../src/i18n';
import { activeServerId, servers } from '../../src/store/servers';
import { setTorrServerTransport } from '../../src/api/torrserver';
import { createPreviewTransport } from '../src/preview/native';
import { installPreviewFixture } from '../src/preview/fixtures';
import { designOverrideAttrs } from '../src/shell/designScope';
import { DESKTOP_ROUTES, DESKTOP_SCREEN_SUPPORT, type DesktopRouteId } from '../src/shell/routes';
import { DesktopPreview, type DesktopPreviewProps } from '../src/preview/DesktopPreview';

vi.mock('../../mobile/src/platform/native', async () => await import('../src/preview/native'));

const BASE = '0000000000000000000000000000000000000000';
let host: HTMLDivElement;
let cleanupFixture: (() => void) | undefined;

function previewProps(overrides: Partial<DesktopPreviewProps> = {}): DesktopPreviewProps {
  return {
    target: 'desktop-windows',
    route: 'settings',
    format: 'landscape',
    language: 'ru',
    mode: 'design',
    serverConnected: false,
    theme: createDefaultTheme(BASE),
    flow: createDefaultFlow(BASE),
    onSelect: () => undefined,
    onNavigate: () => undefined,
    onTrace: () => undefined,
    ...overrides,
  };
}

function mount(props: DesktopPreviewProps): void {
  act(() => {
    render(h(DesktopPreview, props), host);
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  cleanupFixture = installPreviewFixture({ serverConnected: false, language: 'ru' });
});

afterEach(() => {
  act(() => render(null, host));
  cleanupFixture?.();
  cleanupFixture = undefined;
  host.remove();
  setTorrServerTransport(null);
  vi.restoreAllMocks();
});

describe('desktop preview shell', () => {
  it('selects an element in design mode without executing an action', () => {
    const selected: string[] = [];
    const navigated: DesktopRouteId[] = [];
    mount(previewProps({ onSelect: (id) => selected.push(id), onNavigate: (id) => navigated.push(id) }));
    host.querySelector('[data-design-id="settings-continue"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(selected).toEqual(['settings-continue']);
    expect(navigated).toEqual([]);
  });

  it('dispatches one conditional navigation in simulate mode', () => {
    const navigated: DesktopRouteId[] = [];
    mount(previewProps({ mode: 'simulate', onNavigate: (id) => navigated.push(id) }));
    host.querySelector('[data-design-id="settings-continue"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(navigated).toEqual(['connect']);
  });

  it('uses the connected fixture to navigate to library', () => {
    const navigated: DesktopRouteId[] = [];
    mount(previewProps({ mode: 'simulate', serverConnected: true, onNavigate: (id) => navigated.push(id) }));
    host.querySelector('[data-design-id="settings-continue"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(navigated).toEqual(['library']);
  });

  it('shows all main menu destinations and support levels', () => {
    mount(previewProps());
    const text = host.textContent || '';
    for (const label of ['Каталог', 'Новое', 'Поиск', 'Пульт', 'Настройки']) expect(text).toContain(label);
    expect(DESKTOP_ROUTES.find((route) => route.id === 'connect')?.menu).toBe(false);
    expect(DESKTOP_SCREEN_SUPPORT.settings).toBe('logic');
    expect(DESKTOP_SCREEN_SUPPORT.library).toBe('preview');
  });

  it('switches format and language with a remounted preview', () => {
    mount(previewProps({ format: 'portrait', language: 'en' }));
    expect(host.querySelector('[data-design-format="portrait"]')).not.toBeNull();
    expect(host.querySelector('[data-action="toggle-sidebar"]')).not.toBeNull();
    expect(host.textContent).toContain('Settings');
  });

  it('returns active override ids in resolver order', () => {
    const theme = createDefaultTheme(BASE);
    theme.overrides.push({ id: 'win', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#111111' } });
    const context = { target: 'desktop-windows' as DesktopDesignTarget, screenId: 'settings', elementId: 'sidebar', format: 'landscape' as DesignFormat, state: 'default' as const };
    expect(designOverrideAttrs(theme, context)['data-design-overrides']).toBe(activeOverrideIds(theme, context).join(' '));
  });

  it('restores stores and blocks real HTTP during fixture use', async () => {
    cleanupFixture?.();
    const originalServers = servers.value;
    const originalActive = activeServerId.value;
    const originalLanguage = lang.value;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    cleanupFixture = installPreviewFixture({ serverConnected: true, language: 'en' });
    expect(activeServerId.value).toBe('fixture-server');
    expect(lang.value).toBe('en');
    const calls: string[] = [];
    const transport = createPreviewTransport((command) => calls.push(command));
    const response = await transport('native_http', { request: { url: 'https://fixture.invalid/private' } });
    expect(response).toMatchObject({ status: 503 });
    expect(calls).toEqual(['native_http']);
    expect(fetchSpy).not.toHaveBeenCalled();
    cleanupFixture();
    cleanupFixture = undefined;
    expect(servers.value).toEqual(originalServers);
    expect(activeServerId.value).toBe(originalActive);
    expect(lang.value).toBe(originalLanguage);
  });
});

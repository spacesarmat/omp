import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { options, render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init, setFocus, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { LibraryScreen } from '../../src/screens/Library';
import { SettingsScreen } from '../../src/screens/Settings';
import { ToastHost } from '../../src/ui/toast';
import { servers, activeServerId, addServer, setActiveServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { mockFetch } from '../helpers/fetchMock';
import { DEVMODE_HOURS, REMINDER_BEFORE_HOURS } from '../../src/lib/installPlan';

const HOUR = 3600 * 1000;
const LEAD = (DEVMODE_HOURS - REMINDER_BEFORE_HOURS) * HOUR;
const w = window as unknown as { Capacitor?: unknown; PalmServiceBridge?: unknown };
let calls: { uri: string; params: any }[] = [];

function fakeBridge() {
  calls = [];
  w.PalmServiceBridge = function (this: any) {
    this.call = (uri: string, params: string) => {
      calls.push({ uri, params: JSON.parse(params) });
      setTimeout(() => this.onservicecallback(JSON.stringify({ returnValue: true })), 0);
    };
  };
}

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  activeServerId.value = null;
  document.body.innerHTML = '';
  mockFetch(() => ({ body: '[]' }));
  const a = addServer({ url: '10.0.0.2' });
  setActiveServer(a.id);
  torrents.value = [{ hash: 'a1', title: 'Alpha movie', timestamp: 2 }] as any;
});
afterEach(() => {
  delete w.PalmServiceBridge;
  delete w.Capacitor;
  localStorage.clear();
  Array.from(document.body.children).forEach((c) => render(null, c));
  document.body.innerHTML = '';
});

function mountLib() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(h(LibraryScreen, {}), host);
  const toasts = document.createElement('div');
  document.body.appendChild(toasts);
  render(h(ToastHost, {}), toasts);
  return host;
}
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });

describe('Developer Mode expiry banner', () => {
  it('hidden while the window is fresh, shown near the end, extend opens Developer Mode and hides it', async () => {
    localStorage.setItem('omp.devmode.extendAt', JSON.stringify(Date.now()));
    let host = mountLib();
    await flush();
    expect(host.querySelector('[data-fk="lib-devmode-extend"]')).toBeNull();
    render(null, host);
    host.remove();

    localStorage.setItem('omp.devmode.extendAt', JSON.stringify(Date.now() - LEAD));
    host = mountLib();
    await flush();
    const btn = host.querySelector('[data-fk="lib-devmode-extend"]') as HTMLElement;
    expect(btn).toBeTruthy();
    expect(btn.closest('.banner-row')!.textContent).toContain('режим разработчика');
    fakeBridge();
    await act(async () => {
      btn.click();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(calls[0]).toEqual({ uri: 'luna://com.webos.applicationManager/launch', params: { id: 'com.palmdts.devmode' } });
    expect(host.querySelector('[data-fk="lib-devmode-extend"]')).toBeNull();
    expect(document.body.textContent).toContain('нажмите в нём Extend');
  });
  it('rechecks the expiry while the catalog stays open', async () => {
    const prevRender = options.debounceRendering;
    // Preact paints on requestAnimationFrame. Under fake timers that frame is not a reliable 16ms
    // timer, so the banner sometimes never appears. Render in the same turn as setState.
    options.debounceRendering = (cb) => cb();
    vi.useFakeTimers();
    try {
      const start = Date.now();
      localStorage.setItem('omp.devmode.extendAt', JSON.stringify(start));
      const host = mountLib();
      // let the catalog effect install its 10s timer before the clock jumps
      await act(async () => { await Promise.resolve(); });
      await act(async () => { vi.advanceTimersByTime(50); });
      expect(host.querySelector('[data-fk="lib-devmode-extend"]')).toBeNull();
      vi.setSystemTime(start + LEAD + 1000);
      await act(async () => {
        vi.advanceTimersByTime(10000);
        vi.advanceTimersByTime(10000);
      });
      expect(host.querySelector('[data-fk="lib-devmode-extend"]')).toBeTruthy();
    } finally {
      options.debounceRendering = prevRender;
      vi.useRealTimers();
    }
  });
});

describe('Settings Developer Mode button', () => {
  it('webOS: launches Developer Mode and restarts the window', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => render(h(SettingsScreen, {}), host));
    const btn = host.querySelector('[data-fk="set-devmode-extend"]') as HTMLElement;
    expect(btn).toBeTruthy();
    fakeBridge();
    await act(async () => {
      btn.click();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(calls[0]).toEqual({ uri: 'luna://com.webos.applicationManager/launch', params: { id: 'com.palmdts.devmode' } });
  });
  it('Android TV: no Developer Mode button', () => {
    w.Capacitor = { getPlatform: () => 'android' };
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => render(h(SettingsScreen, {}), host));
    expect(host.querySelector('[data-fk="set-devmode-extend"]')).toBeNull();
  });
  it('D-pad reaches the new button from the update row', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => render(h(SettingsScreen, {}), host));
    const arrow = (keyCode: number, key: string) => act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { keyCode, key, bubbles: true } as KeyboardEventInit));
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    act(() => setFocus('set-update'));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    await arrow(40, 'ArrowDown');
    expect(getCurrentFocusKey()).toBe('set-devmode-extend');
    await arrow(39, 'ArrowRight');
    expect(getCurrentFocusKey()).toBe('set-onboarding');
    await arrow(37, 'ArrowLeft');
    expect(getCurrentFocusKey()).toBe('set-devmode-extend');
  });
});
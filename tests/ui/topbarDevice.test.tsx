import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';

const native = { plugin: null as any };
vi.mock('../../src/platform/androidNative', async (orig) => ({
  ...(await orig<typeof import('../../src/platform/androidNative')>()),
  nativePlugin: () => native.plugin,
}));

import { TopBar } from '../../src/ui/TopBar';
import { deviceName, loadDeviceName, resetDeviceName, WEBOS_FALLBACK_NAME } from '../../src/platform/deviceName';
// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  (Element.prototype as any).scrollIntoView = () => undefined;
});

/** A webOS Luna bridge answering getSystemSettings with `reply` (or an error). */
function luna(reply: object | null) {
  const calls: { uri: string; params: any }[] = [];
  (window as any).PalmServiceBridge = function Bridge(this: any) {
    this.call = (uri: string, params: string) => {
      calls.push({ uri, params: JSON.parse(params) });
      setTimeout(() => this.onservicecallback(JSON.stringify(reply || { returnValue: false, errorText: 'denied' })), 0);
    };
  };
  return calls;
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await act(() => new Promise((r) => setTimeout(r, 0)));
};

function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    render(h(TopBar as any, {
      tab: 'all', onTab: vi.fn(), view: 'large', sort: 'new', searchOpen: false,
      onSearch: vi.fn(), onView: vi.fn(), onSort: vi.fn(), onFocused: vi.fn(),
    }), host);
  });
  return host;
}

beforeEach(() => {
  resetDeviceName();
  native.plugin = null;
  delete (window as any).PalmServiceBridge;
});
afterEach(() => {
  act(() => { document.querySelectorAll('body > div').forEach((d) => render(null, d)); });
  document.body.innerHTML = '';
  delete (window as any).PalmServiceBridge;
});

describe('device name under the logo (TV top bar)', () => {
  it('Android TV: the native tvName, shown in a small line under the logo', async () => {
    native.plugin = { tvName: vi.fn(() => Promise.resolve({ name: 'Dune HD Pro Vision 4K Solo' })) };
    const host = mount();
    await flush();
    const line = host.querySelector('.topbar-home .topbar-device')!;
    expect(line.textContent).toBe('Dune HD Pro Vision 4K Solo');
    expect(line.getAttribute('title')).toBe('Dune HD Pro Vision 4K Solo');
    // once per app run
    mount();
    await flush();
    expect(native.plugin.tvName).toHaveBeenCalledTimes(1);
  });

  it('no line while the name is unknown (browser, failed lookup)', async () => {
    const host = mount();
    await flush();
    expect(host.querySelector('.topbar-device')).toBeNull();
    resetDeviceName();
    native.plugin = { tvName: vi.fn(() => Promise.reject(new Error('no'))) };
    const again = mount();
    await flush();
    expect(again.querySelector('.topbar-device')).toBeNull();
  });

  it('LG webOS: the TV name from the system settings, else «LG webOS TV»', async () => {
    const calls = luna({ returnValue: true, settings: { deviceName: '  Гостиная  OLED ' } });
    await loadDeviceName();
    expect(deviceName.value).toBe('Гостиная OLED');
    expect(calls[0].uri).toBe('luna://com.webos.settingsservice/getSystemSettings');
    expect(calls[0].params).toEqual({ category: 'network', keys: ['deviceName'] });
    resetDeviceName();
    luna(null);
    await loadDeviceName();
    expect(deviceName.value).toBe(WEBOS_FALLBACK_NAME);
    resetDeviceName();
    luna({ returnValue: true, settings: {} });
    await loadDeviceName();
    expect(deviceName.value).toBe(WEBOS_FALLBACK_NAME);
  });

  it('keeps the bar: an absolutely placed muted line with an ellipsis', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    const rule = /\.topbar-device \{([^}]*)\}/.exec(css)![1];
    ['position: absolute', 'color: var(--muted)', 'white-space: nowrap', 'text-overflow: ellipsis', 'overflow: hidden', 'max-width: 220px', 'font-size: 17px']
      .forEach((p) => expect(rule).toContain(p));
    expect(/\.topbar \{[^}]*height: 92px/.test(css)).toBe(true);
  });
});

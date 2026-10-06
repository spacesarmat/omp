import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init, setFocus } from '@noriginmedia/norigin-spatial-navigation';

vi.mock('../../src/platform/env', () => ({ platformKind: () => 'webos' }));

import { FaqScreen } from '../../src/screens/Faq';
import { SettingsScreen } from '../../src/screens/Settings';
import { FAQ, itemFor } from '../../src/faq/faq';
import { routeStack, currentRoute, goBack } from '../../src/ui/nav';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
let host: HTMLElement;
function mount(node: any) {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(node, host));
}
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  routeStack.value = [{ name: 'connect' }];
});

const hasUrl = (it: (typeof FAQ)[number]) =>
  itemFor(it, 'lg').short.concat(itemFor(it, 'lg').more).some((l) => typeof l !== 'string' || /https?:\/\//.test(l));

describe('TV FAQ', () => {
  it('lists LG questions and hides phone-only ones', async () => {
    mount(h(FaqScreen, {}));
    await flush();
    expect(host.querySelector('[data-fk="faq-lg-devmode"]')).toBeTruthy();
    const phoneOnly = FAQ.filter((it) => it.devices.indexOf('lg') < 0)[0];
    expect(host.querySelector('[data-fk="faq-' + phoneOnly.id + '"]')).toBeNull();
    expect(host.querySelectorAll('.faq-list .list-item').length).toBe(FAQ.filter((it) => it.devices.indexOf('lg') >= 0).length);
  });

  it('shows a QR when the focused answer has a link, and none otherwise', async () => {
    mount(h(FaqScreen, {}));
    await flush();
    const lg = FAQ.filter((it) => it.devices.indexOf('lg') >= 0);
    const withUrl = lg.filter(hasUrl)[0];
    const without = lg.filter((it) => !hasUrl(it))[0];
    expect(withUrl).toBeTruthy();
    await act(async () => { setFocus('faq-' + withUrl.id); });
    await flush();
    expect(host.querySelector('.faq-answer .qr')).toBeTruthy();
    await act(async () => { setFocus('faq-' + without.id); });
    await flush();
    expect(host.querySelector('.faq-answer .qr')).toBeNull();
  });

  it('Settings opens the FAQ and Back returns to Settings', async () => {
    routeStack.value = [{ name: 'settings' }];
    mount(h(SettingsScreen, {}));
    await flush();
    const b = host.querySelector('[data-fk="set-faq"]') as HTMLElement;
    expect(b).toBeTruthy();
    await act(async () => { b.click(); });
    expect(currentRoute.value.name).toBe('faq');
    goBack();
    expect(currentRoute.value.name).toBe('settings');
  });
});

describe('FAQ link extraction', () => {
  it('drops trailing punctuation from the QR payload', async () => {
    const { firstUrl } = await import('../../src/screens/Faq');
    expect(firstUrl(['Open https://example.com/a.'])).toBe('https://example.com/a');
    expect(firstUrl(['(see https://example.com/a/b)'])).toBe('https://example.com/a/b');
    expect(firstUrl(['x', { text: 'l', url: 'https://e.org/z' }])).toBe('https://e.org/z');
  });
});

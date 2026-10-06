import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init, setFocus } from '@noriginmedia/norigin-spatial-navigation';

vi.mock('../../src/platform/env', () => ({ platformKind: () => 'webos' }));

import { FaqScreen } from '../../src/screens/Faq';
import { SettingsScreen } from '../../src/screens/Settings';
import { FAQ, SECTIONS, itemFor } from '../../src/faq/faq';
// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';
import { t } from '../../src/i18n';
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

const lgItems = () => FAQ.filter((it) => it.devices.indexOf('lg') >= 0 || (it.devices.indexOf('common') >= 0 && it.devices.indexOf('phone') < 0));
const lgSections = () => SECTIONS.filter((s) => lgItems().some((it) => it.section === s.id));
const press = (keyCode: number, key: string) =>
  act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: keyCode, key: key, bubbles: true } as KeyboardEventInit)); });
const focusedKey = () => {
  const el = host.querySelector('.faq-q.focused');
  return el ? el.getAttribute('data-fk') : null;
};

describe('TV FAQ', () => {
  it('shows section chips for this device and only the questions of the chosen section', async () => {
    mount(h(FaqScreen, {}));
    await flush();
    const chips = Array.prototype.map.call(host.querySelectorAll('.faq-chip'), (c: Element) => c.textContent) as string[];
    expect(chips).toEqual(lgSections().map((s) => s.label));
    expect(host.querySelector('.faq-chip.on')!.textContent).toBe(lgSections()[0].label);
    const first = lgItems().filter((it) => it.section === lgSections()[0].id);
    expect(host.querySelectorAll('.faq-list .faq-q').length).toBe(first.length);
    expect(focusedKey()).toBe('faq-' + first[0].id);
    // phone-only questions and phone features sharing the general tag stay hidden
    expect(host.querySelector('[data-fk="faq-backup"]')).toBeNull();
    expect(host.querySelector('[data-fk="faq-lg-devmode"]')).toBeTruthy();
  });

  it('Right and Left switch the section and focus its first question', async () => {
    mount(h(FaqScreen, {}));
    await flush();
    const secs = lgSections();
    await press(39, 'ArrowRight');
    await flush();
    expect(host.querySelector('.faq-chip.on')!.textContent).toBe(secs[1].label);
    const second = lgItems().filter((it) => it.section === secs[1].id);
    expect(host.querySelectorAll('.faq-list .faq-q').length).toBe(second.length);
    expect(focusedKey()).toBe('faq-' + second[0].id);
    await press(37, 'ArrowLeft');
    await flush();
    expect(host.querySelector('.faq-chip.on')!.textContent).toBe(secs[0].label);
    await press(37, 'ArrowLeft');
    await flush();
    expect(host.querySelector('.faq-chip.on')!.textContent).toBe(secs[0].label);
  });

  it('shows a QR when the focused answer has a link, and the phone line otherwise', async () => {
    mount(h(FaqScreen, {}));
    await flush();
    const install = lgItems().filter((it) => it.section === 'install');
    const withUrl = install.filter(hasUrl)[0];
    const without = install.filter((it) => !hasUrl(it))[0];
    expect(withUrl).toBeTruthy();
    expect(without).toBeTruthy();
    await act(async () => { setFocus('faq-' + withUrl.id); });
    await flush();
    expect(host.querySelector('.faq-answer .qr')).toBeTruthy();
    expect(host.querySelector('.faq-answer')!.textContent).toContain(t('faq.qrCaption'));
    expect(host.querySelector('.faq-phone')).toBeNull();
    await act(async () => { setFocus('faq-' + without.id); });
    await flush();
    expect(host.querySelector('.faq-answer .qr')).toBeNull();
    expect(host.querySelector('.faq-phone')!.textContent).toBe(t('faq.fullOnPhone'));
    expect(host.querySelector('.faq-answer h2')!.textContent).toBe(itemFor(without, 'lg').q);
  });

  it('numbered lines keep their numbers as an ordered list', async () => {
    const { answerBlocks } = await import('../../src/screens/Faq');
    const b = answerBlocks(['Intro', '1. One', '2. Two', 'Tail', '3. Three']);
    expect(b).toEqual([
      { kind: 'p', text: 'Intro' },
      { kind: 'ol', start: 1, items: ['One', 'Two'] },
      { kind: 'p', text: 'Tail' },
      { kind: 'ol', start: 3, items: ['Three'] },
    ]);
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

describe('TV FAQ layout', () => {
  it('the question panel is its own scroller, the focus ring is inset and the title is the Help key', async () => {
    const css = readFileSync('src/styles.css', 'utf8');
    expect(/\.faq-list \{[^}]*width: 700px[^}]*overflow-y: auto/.test(css)).toBe(true);
    expect(/\.faq-q\.focused \{[^}]*transform: none[^}]*box-shadow: inset/.test(css)).toBe(true);
    mount(h(FaqScreen, {}));
    await flush();
    expect(host.querySelector('.faq-list .faq-q')).toBeTruthy();
    expect(host.querySelector('h1')!.textContent).toBe(t('tvSettings.help'));
    expect(host.querySelector('.hints')!.textContent).toBe(t('faq.hintQuestion') + ' · ' + t('faq.hintSection') + ' · ' + t('faq.hintBack'));
  });

  it('scrolls whole rows into view with the panel padding', async () => {
    const { rowScrollTop } = await import('../../src/screens/Faq');
    // the first row sits at the padding: the list stays at the top
    expect(rowScrollTop(40, 600, 18, 60, 18)).toBe(0);
    // a row below the view ends one padding above the bottom
    expect(rowScrollTop(0, 600, 700, 60, 18)).toBe(700 + 60 + 18 - 600);
    // a row cut at the top starts one padding below the top
    expect(rowScrollTop(500, 600, 400, 60, 18)).toBe(382);
    // a fully visible row does not move the list
    expect(rowScrollTop(100, 600, 300, 60, 18)).toBe(100);
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

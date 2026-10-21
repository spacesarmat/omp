import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, h, type VNode } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';

vi.mock('../../src/version', () => ({ APP_VERSION: '0.20.6-beta.2' }));

import { SettingsScreen } from '../../src/screens/Settings';
import { DEFAULT_SETTINGS, resetSettings, sanitizeSettings, settings, updateSettings } from '../../src/store/settings';
import { ScreenCodeBadge } from '../../src/testmode/badge';
import { collectElementLabels, ElementLabelsHost, paintElementLabels } from '../../src/testmode/elements';
import { phoneLabelPx, tvLabelPx } from '../../src/testmode/active';
import { routeStack } from '../../src/ui/nav';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!(Element.prototype as { scrollIntoView?: () => void }).scrollIntoView) {
    (Element.prototype as { scrollIntoView: () => void }).scrollIntoView = () => undefined;
  }
});

afterEach(() => {
  resetSettings();
  routeStack.value = [{ name: 'connect' }];
  document.body.innerHTML = '';
  document.body.className = '';
  vi.useRealTimers();
});

function mount(node: VNode<any>): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => { render(node, host); });
  return host;
}

const PAGE =
  '<div class="screen">' +
  '<div class="button test-anchor">coded</div>' +
  '<div class="button">plain</div>' +
  '<div class="art">loose poster</div>' +
  '<div class="views-tiles">' +
  '<div class="tile"><div class="art"></div></div>' +
  '<div class="tile"><div class="art"></div></div>' +
  '</div>' +
  '<div class="views-tiles"><div class="tile"><div class="art"></div></div></div>' +
  '<div class="dialog"><div class="list-item">a</div><div class="list-item">b</div><span class="test-badge">D12</span></div>' +
  '</div>';

describe('element codes', () => {
  it('counts rows, posters, cards and buttons in page order and skips coded controls', () => {
    const root = document.createElement('div');
    root.innerHTML = PAGE;
    const codes = collectElementLabels(root, 'S01', false).map((l) => l.code);
    expect(codes).toEqual([
      'S01.R#1', 'S01.R#2',
      'S01.P#1', 'S01.R1.P#1', 'S01.R1.P#2', 'S01.R2.P#1',
      'S01.R1.C#1', 'S01.R1.C#2', 'S01.R2.C#1',
      'D12.L#1', 'D12.L#2',
      'S01.B#1',
    ]);
    expect(collectElementLabels(root, '', false)).toEqual([]);
  });

  it('uses the sheet code on the phone and leaves controls with data-code alone', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="m-grid"><div class="m-poster"></div><div class="m-poster"></div></div>' +
      '<button class="m-btn" data-code="P11.13">coded</button>' +
      '<div data-code="PD07"><button class="m-btn">ok</button></div>';
    const codes = collectElementLabels(root, 'P02', true).map((l) => l.code);
    expect(codes).toEqual(['P02.R#1', 'P02.R1.P#1', 'P02.R1.P#2', 'PD07.B#1']);
  });

  it('paints visible elements in 1920 coordinates of the scaled TV root', () => {
    document.body.innerHTML =
      '<div class="app"><div class="test-screen-badge"><span class="test-badge">S01</span></div>' +
      '<div class="art" id="a"></div><div class="art" id="off"></div><div class="test-el-layer" id="layer"></div></div>';
    const app = document.querySelector('.app') as HTMLElement;
    Object.defineProperty(app, 'offsetWidth', { configurable: true, value: 1920 });
    const rect = (l: number, t: number, w: number, hh: number) => () => ({
      left: l, top: t, width: w, height: hh, right: l + w, bottom: t + hh, x: l, y: t, toJSON: () => ({}),
    }) as DOMRect;
    app.getBoundingClientRect = rect(0, 0, 3840, 2160);
    (document.getElementById('a') as HTMLElement).getBoundingClientRect = rect(200, 400, 300, 450);
    (document.getElementById('off') as HTMLElement).getBoundingClientRect = rect(0, 0, 0, 0);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 3840 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 2160 });
    const layer = document.getElementById('layer') as HTMLElement;
    paintElementLabels(layer, false);
    expect(layer.children.length).toBe(1);
    const label = layer.children[0] as HTMLElement;
    expect(label.textContent).toBe('S01.P#1');
    expect(label.style.left).toBe('100px');
    expect(label.style.top).toBe('200px');
    expect(label.className).toBe('test-el');
  });

  it('keeps every TV size at 24px or more, «Средний» on the phone is the old size', () => {
    expect(tvLabelPx('small')).toBeGreaterThanOrEqual(24);
    expect(tvLabelPx('small')).toBeLessThan(tvLabelPx('medium'));
    expect(tvLabelPx('medium')).toBeLessThan(tvLabelPx('large'));
    expect(phoneLabelPx('medium')).toBe(24);
  });
});

describe('label size setting on a beta build', () => {
  it('sits under the switch, cycles and is saved', () => {
    const host = mount(h(SettingsScreen, {}));
    const row = Array.from(host.querySelectorAll('.choice-row')).find((n) => {
      const label = n.querySelector('.choice-label');
      return !!label && label.textContent === 'Размер меток';
    }) as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.getAttribute('data-fk')).toBe('set-test-size');
    expect(row.textContent).toContain('Средний');
    act(() => { row.click(); });
    expect(settings.value.testLabelSize).toBe('large');
    act(() => { updateSettings({ testMode: true }); });
    const badge = row.querySelector('.test-badge');
    expect(badge && badge.textContent).toBe('S05.30.3');
  });

  it('paints the body size class and the overlay only while test mode is on', () => {
    routeStack.value = [{ name: 'settings' }];
    const host = mount(h('div', { class: 'app' }, h(ScreenCodeBadge, null), h(ElementLabelsHost, null)));
    expect(host.querySelector('.test-el-layer')).toBeNull();
    expect(document.body.className).not.toContain('test-size-');
    act(() => { updateSettings({ testMode: true }); });
    expect(document.body.classList.contains('test-size-medium')).toBe(true);
    const layer = host.querySelector('.test-el-layer') as HTMLElement;
    expect(layer).toBeTruthy();
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    act(() => { updateSettings({ testLabelSize: 'small' }); });
    expect(document.body.classList.contains('test-size-small')).toBe(true);
    expect(document.body.classList.contains('test-size-medium')).toBe(false);
    act(() => { updateSettings({ testMode: false }); });
    expect(document.body.className).not.toContain('test-size-');
  });

  it('falls back to «Средний» for an unknown saved size', () => {
    expect(DEFAULT_SETTINGS.testLabelSize).toBe('medium');
    expect(sanitizeSettings({ testLabelSize: 'huge' }).testLabelSize).toBe('medium');
    expect(sanitizeSettings({ testLabelSize: 'large' }).testLabelSize).toBe('large');
  });
});

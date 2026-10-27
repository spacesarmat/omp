import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, h, type VNode } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';

vi.mock('../../src/version', () => ({ APP_VERSION: '0.20.6-beta.2' }));

import { SettingsScreen } from '../../src/screens/Settings';
import { DEFAULT_SETTINGS, resetSettings, sanitizeSettings, settings, updateSettings } from '../../src/store/settings';
import { ScreenCodeBadge } from '../../src/testmode/badge';
import { collectElementLabels, ElementLabelsHost, labelSizeCss, paintElementLabels, placePhoneLabels } from '../../src/testmode/elements';
import { clampLabelPx, PHONE_LABEL_PX, TV_LABEL_PX } from '../../src/testmode/active';
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

  it('counts a poster fallback inside a poster once and labels uncoded dialog choices', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="series-poster"><div class="art"></div></div>' +
      '<div class="dialog"><span class="test-badge">D20</span>' +
      '<div class="dialog-option">Русская дорожка</div><div class="dialog-option test-anchor">coded</div></div>';
    expect(collectElementLabels(root, 'S04', false).map((l) => l.code)).toEqual(['S04.P#1', 'D20.L#1']);
  });

  it('labels only the open dialog and skips cards scrolled out of their row', () => {
    document.body.innerHTML =
      '<div class="app"><div class="test-screen-badge"><span class="test-badge">S01</span></div>' +
      '<div class="views-tiles" id="row"><div class="tile" id="in"></div><div class="tile" id="out"></div></div>' +
      '<div class="test-el-layer" id="layer"></div></div>';
    const rect = (l: number, t: number, w: number, hh: number) => () => ({
      left: l, top: t, width: w, height: hh, right: l + w, bottom: t + hh, x: l, y: t, toJSON: () => ({}),
    }) as DOMRect;
    const app = document.querySelector('.app') as HTMLElement;
    Object.defineProperty(app, 'offsetWidth', { configurable: true, value: 1920 });
    app.getBoundingClientRect = rect(0, 0, 1920, 1080);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1920 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1080 });
    (document.getElementById('row') as HTMLElement).getBoundingClientRect = rect(0, 100, 1000, 400);
    (document.getElementById('in') as HTMLElement).getBoundingClientRect = rect(10, 120, 200, 300);
    (document.getElementById('out') as HTMLElement).getBoundingClientRect = rect(1100, 120, 200, 300);
    const layer = document.getElementById('layer') as HTMLElement;
    paintElementLabels(layer, false);
    expect(Array.from(layer.children).map((c) => c.textContent)).toEqual(['S01.R#1', 'S01.R1.C#1']);

    const dlg = document.createElement('div');
    dlg.className = 'dialog';
    dlg.innerHTML = '<span class="test-badge">D03</span><div class="button" id="b">OK</div>';
    app.insertBefore(dlg, layer);
    (document.getElementById('b') as HTMLElement).getBoundingClientRect = rect(800, 500, 200, 60);
    paintElementLabels(layer, false);
    expect(Array.from(layer.children).map((c) => c.textContent)).toEqual(['D03.B#1']);
  });

  it('clamps the px to the TV and phone ranges and steps', () => {
    expect(TV_LABEL_PX).toEqual({ min: 16, max: 36, step: 2, def: 20 });
    expect(PHONE_LABEL_PX).toEqual({ min: 8, max: 24, step: 1, def: 12 });
    expect(clampLabelPx(21, TV_LABEL_PX)).toBe(22);
    expect(clampLabelPx(4, TV_LABEL_PX)).toBe(16);
    expect(clampLabelPx(99, TV_LABEL_PX)).toBe(36);
    expect(clampLabelPx('big', TV_LABEL_PX)).toBe(20);
    expect(clampLabelPx(7, PHONE_LABEL_PX)).toBe(8);
    expect(clampLabelPx(13.4, PHONE_LABEL_PX)).toBe(13);
    expect(labelSizeCss(20, false)).toContain('.test-el { font-size: 20px; line-height: 24px; }');
    expect(labelSizeCss(12, true)).toContain('body.test-labels [data-code]::after');
  });
});

describe('label size slider on a beta build', () => {
  it('sits under the switch, shows the px, OK steps by 2 and wraps', () => {
    const host = mount(h(SettingsScreen, {}));
    const row = Array.from(host.querySelectorAll('.choice-row')).find((n) => {
      const label = n.querySelector('.choice-label');
      return !!label && label.textContent === 'Размер меток';
    }) as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.getAttribute('data-fk')).toBe('set-test-size');
    expect(row.querySelector('.choice-value')!.textContent).toBe('20 px');
    act(() => { row.click(); });
    expect(settings.value.testLabelPx).toBe(22);
    act(() => { updateSettings({ testLabelPx: 36 }); });
    act(() => { (host.querySelector('[data-fk="set-test-size"]') as HTMLElement).click(); });
    expect(settings.value.testLabelPx).toBe(16);
    act(() => { updateSettings({ testMode: true }); });
    const badge = host.querySelector('[data-fk="set-test-size"] .test-badge');
    expect(badge && badge.textContent).toBe('S05.30');
  });

  it('left / right on the remote step by 2 px, stop at both ends and keep the focus', async () => {
    const { getCurrentFocusKey, setFocus } = await import('@noriginmedia/norigin-spatial-navigation');
    const press = async (key: string) => {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true }));
        for (let i = 0; i < 8; i++) await Promise.resolve();
      });
    };
    mount(h(SettingsScreen, {}));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    await act(async () => { setFocus('set-test-size'); for (let i = 0; i < 4; i++) await Promise.resolve(); });
    expect(getCurrentFocusKey()).toBe('set-test-size');
    await press('ArrowRight');
    expect(settings.value.testLabelPx).toBe(22);
    await press('ArrowLeft');
    await press('ArrowLeft');
    expect(settings.value.testLabelPx).toBe(18);
    expect(getCurrentFocusKey()).toBe('set-test-size');
    act(() => { updateSettings({ testLabelPx: 16 }); });
    await press('ArrowLeft');
    expect(settings.value.testLabelPx).toBe(16);
    act(() => { updateSettings({ testLabelPx: 36 }); });
    await press('ArrowRight');
    expect(settings.value.testLabelPx).toBe(36);
    expect(getCurrentFocusKey()).toBe('set-test-size');
  });

  it('writes the px rule and the overlay only while test mode is on', () => {
    routeStack.value = [{ name: 'settings' }];
    const host = mount(h('div', { class: 'app' }, h(ScreenCodeBadge, null), h(ElementLabelsHost, null)));
    expect(host.querySelector('.test-el-layer')).toBeNull();
    expect(document.getElementById('test-label-size')).toBeNull();
    act(() => { updateSettings({ testMode: true }); });
    expect(document.getElementById('test-label-size')!.textContent).toContain('font-size: 20px');
    const layer = host.querySelector('.test-el-layer') as HTMLElement;
    expect(layer).toBeTruthy();
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    act(() => { updateSettings({ testLabelPx: 16 }); });
    expect(document.getElementById('test-label-size')!.textContent).toContain('font-size: 16px');
    act(() => { updateSettings({ testMode: false }); });
    expect(document.getElementById('test-label-size')).toBeNull();
  });

  it('defaults to 20 / 12 px and moves a beta.2 choice to the nearest px', () => {
    expect(DEFAULT_SETTINGS.testLabelPx).toBe(20);
    expect(DEFAULT_SETTINGS.testLabelPhonePx).toBe(12);
    const small = sanitizeSettings({ testLabelSize: 'small' });
    expect([small.testLabelPx, small.testLabelPhonePx]).toEqual([24, 16]);
    const large = sanitizeSettings({ testLabelSize: 'large' });
    expect([large.testLabelPx, large.testLabelPhonePx]).toEqual([36, 24]);
    const medium = sanitizeSettings({ testLabelSize: 'medium' });
    expect([medium.testLabelPx, medium.testLabelPhonePx]).toEqual([20, 12]);
    const both = sanitizeSettings({ testLabelSize: 'large', testLabelPx: 18, testLabelPhonePx: 10 });
    expect([both.testLabelPx, both.testLabelPhonePx]).toEqual([18, 10]);
    expect(sanitizeSettings({ testLabelPx: 41, testLabelPhonePx: 2 }).testLabelPx).toBe(36);
    expect(sanitizeSettings({ testLabelPx: 41, testLabelPhonePx: 2 }).testLabelPhonePx).toBe(8);
  });
});

describe('phone labels in landscape (S21, 1024x461)', () => {
  const rect = (l: number, t: number, w: number, hh: number) => () =>
    ({ left: l, top: t, width: w, height: hh, right: l + w, bottom: t + hh, x: l, y: t, toJSON: () => ({}) }) as DOMRect;
  const set = (id: string, l: number, t: number, w: number, hh: number) => {
    (document.getElementById(id) as HTMLElement).getBoundingClientRect = rect(l, t, w, hh);
  };
  const box = (l: number, t: number, r: number, b: number) => ({ left: l, top: t, right: r, bottom: b });
  const view = box(0, 0, 1024, 461);

  it('keeps row and poster labels off the chips, their badges and the tab bar', () => {
    document.body.innerHTML =
      '<button class="test-screen-badge" id="scr"><span class="test-badge">P02</span></button>' +
      '<button class="m-seg-btn" data-code="P02.1" id="mine">Мои</button>' +
      '<div class="m-chips" id="chips"><button class="m-chip" data-code="P02.9" id="c1">Все</button><button class="m-chip" data-code="P02.10" id="c2">Фильмы</button></div>' +
      '<div class="m-grid" id="g1"><div class="m-poster" id="p1"></div></div>' +
      '<div class="m-grid" id="g2"><div class="m-poster" id="p2"></div></div>' +
      '<nav class="m-nav" id="nav"><button data-code="P33.1" id="t1">Каталог</button></nav>' +
      '<div class="test-el-layer" id="layer"></div>';
    set('scr', 8, 52, 44, 44);
    set('mine', 92, 66, 52, 36);
    set('chips', 52, 127, 890, 40);
    set('c1', 52, 127, 56, 40);
    set('c2', 118, 127, 90, 40);
    set('g1', 52, 250, 890, 120);
    set('p1', 60, 258, 60, 90);
    set('g2', 52, 410, 890, 200);
    set('p2', 60, 418, 60, 90);
    set('nav', 0, 404, 1024, 57);
    set('t1', 100, 410, 120, 44);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 461 });
    const hh = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(16);
    const ww = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(60);
    try {
      const layer = document.getElementById('layer') as HTMLElement;
      paintElementLabels(layer, true);
      const at = (code: string) => {
        const span = Array.from(layer.children).find((c) => c.textContent === code) as HTMLElement | undefined;
        return span ? span.style.left + ',' + span.style.top : 'none';
      };
      // above the chips' left end sits the «Все» badge: the row label moves above the row's right end
      expect(at('P02.R#1')).toBe('882px,111px');
      // free space above the shelf: the label stays above its left end, the poster label on the poster
      expect(at('P02.R#2')).toBe('52px,234px');
      expect(at('P02.R2.P#1')).toBe('60px,258px');
      // the third row and its poster are under the tab bar: no label over «Каталог»
      expect(at('P02.R#3')).toBe('none');
      expect(at('P02.R3.P#1')).toBe('none');
      expect(Array.from(layer.children).map((c) => c.textContent)).toEqual(['P02.R#1', 'P02.R#2', 'P02.R2.P#1']);
    } finally {
      hh.mockRestore();
      ww.mockRestore();
    }
  });

  it('places a row label in the first free spot and drops it with none', () => {
    const row = { b: box(50, 100, 950, 140), place: 'above', w: 60, inChrome: -1 };
    expect(placePhoneLabels([row], 16, view, [], [])).toEqual([{ x: 50, y: 84 }]);
    // a control above the left end, then above the right end too: inside the row's top right corner
    const leftBadge = box(50, 90, 110, 140);
    const rightBtn = box(880, 70, 950, 99);
    expect(placePhoneLabels([row], 16, view, [], [leftBadge])).toEqual([{ x: 890, y: 84 }]);
    expect(placePhoneLabels([row], 16, view, [], [leftBadge, box(880, 70, 950, 90)])).toEqual([{ x: 890, y: 100 }]);
    expect(placePhoneLabels([row], 16, view, [], [leftBadge, rightBtn, box(50, 100, 950, 140)])).toEqual([null]);
  });

  it('never paints over the chrome unless the element is in it; edge posters are pulled into the screen', () => {
    const nav = box(0, 404, 1024, 461);
    const poster = { b: box(60, 400, 120, 490), place: 'top', w: 70, inChrome: -1 };
    expect(placePhoneLabels([poster], 16, view, [nav], [])).toEqual([null]);
    expect(placePhoneLabels([{ ...poster, inChrome: 0 }], 16, view, [nav], [])).toEqual([{ x: 60, y: 400 }]);
    const cut = { b: box(-30, 200, 30, 290), place: 'top', w: 70, inChrome: -1 };
    expect(placePhoneLabels([cut], 16, view, [nav], [])).toEqual([{ x: 0, y: 200 }]);
  });
});

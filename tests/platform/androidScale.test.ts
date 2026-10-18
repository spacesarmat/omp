import { describe, it, expect, afterEach } from 'vitest';
import { applyTvScale, installAndroidScale } from '../../src/platform/androidScale';

const origWidth = window.innerWidth;
function setWidth(w: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
}
afterEach(() => {
  setWidth(origWidth);
  document.body.innerHTML = '';
  document.documentElement.style.width = '';
  document.documentElement.style.height = '';
  document.body.style.width = '';
  document.body.style.height = '';
});

describe('Android TV scale safety net', () => {
  it('leaves a ~1920 px wide window unscaled', () => {
    const el = document.createElement('div');
    expect(applyTvScale(el, { innerWidth: 1920 })).toBe(1);
    expect(applyTvScale(el, { innerWidth: 1921 })).toBe(1);
    expect(el.style.transform).toBe('');
  });

  it('scales the root by innerWidth/1920 from the top-left corner', () => {
    const el = document.createElement('div');
    expect(applyTvScale(el, { innerWidth: 960 })).toBe(0.5);
    expect(el.style.transform).toBe('scale(0.5)');
    expect(el.style.transformOrigin).toBe('0 0');
    expect(el.style.width).toBe('1920px');
    expect(el.style.height).toBe('1080px');
    expect(document.documentElement.style.width).toBe('960px');
    expect(document.documentElement.style.height).toBe('540px');
    expect(document.body.style.width).toBe('960px');
    expect(document.body.style.height).toBe('540px');
  });

  it('a 3840 viewport shows the whole 1920 layout, scaled from the origin', () => {
    const el = document.createElement('div');
    expect(applyTvScale(el, { innerWidth: 3840, innerHeight: 2160 })).toBe(2);
    expect(el.style.transform).toBe('scale(2)');
    expect(el.style.transformOrigin).toBe('0 0');
    expect(el.style.width).toBe('1920px');
    expect(el.style.height).toBe('1080px');
    expect(document.documentElement.style.width).toBe('3840px');
    expect(document.documentElement.style.height).toBe('2160px');
    expect(document.body.style.width).toBe('3840px');
    expect(document.body.style.height).toBe('2160px');
  });

  it('drops the transform when the window becomes 1920 wide', () => {
    const el = document.createElement('div');
    applyTvScale(el, { innerWidth: 3840, innerHeight: 2160 });
    applyTvScale(el, { innerWidth: 1920, innerHeight: 1080 });
    expect(el.style.transform).toBe('');
    expect(el.style.width).toBe('');
    expect(el.style.height).toBe('');
    expect(document.documentElement.style.width).toBe('');
    expect(document.documentElement.style.height).toBe('');
    expect(document.body.style.width).toBe('');
    expect(document.body.style.height).toBe('');
  });

  it('install scales .app now and on resize; uninstall removes it', () => {
    const el = document.createElement('div');
    el.className = 'app';
    document.body.appendChild(el);
    setWidth(960);
    const off = installAndroidScale();
    expect(el.style.transform).toBe('scale(0.5)');
    setWidth(1280);
    window.dispatchEvent(new Event('resize'));
    expect(el.style.transform).toBe('scale(0.6666666666666666)');
    off();
    expect(el.style.transform).toBe('');
    expect(el.style.width).toBe('');
    expect(document.documentElement.style.width).toBe('');
    expect(document.body.style.height).toBe('');
    setWidth(960);
    window.dispatchEvent(new Event('resize'));
    expect(el.style.transform).toBe('');
  });

  it('without an .app root it is a no-op', () => {
    expect(() => installAndroidScale()()).not.toThrow();
  });
});

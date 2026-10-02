import { describe, it, expect, afterEach } from 'vitest';
import { applyTvScale, installAndroidScale } from '../../src/platform/androidScale';

const origWidth = window.innerWidth;
function setWidth(w: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
}
afterEach(() => {
  setWidth(origWidth);
  document.body.innerHTML = '';
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
  });

  it('drops the transform when the window becomes 1920 wide', () => {
    const el = document.createElement('div');
    applyTvScale(el, { innerWidth: 1280 });
    applyTvScale(el, { innerWidth: 1920 });
    expect(el.style.transform).toBe('');
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
    setWidth(960);
    window.dispatchEvent(new Event('resize'));
    expect(el.style.transform).toBe('');
  });

  it('without an .app root it is a no-op', () => {
    expect(() => installAndroidScale()()).not.toThrow();
  });
});

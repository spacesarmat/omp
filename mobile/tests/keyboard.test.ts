// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startKeyboardWatch } from '../src/ui/keyboard';

let stop: () => void;
const cls = () => document.documentElement.classList.contains('m-kb-open');
function setSize(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
  window.dispatchEvent(new Event('resize'));
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
  document.body.innerHTML = '<input id="i" /><button id="b">x</button>';
  setSize(400, 900);
  stop = startKeyboardWatch();
});
afterEach(() => { stop(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

const input = () => document.getElementById('i') as HTMLInputElement;

describe('keyboard watch', () => {
  it('adds the class when the height drops and an input is focused', () => {
    input().focus();
    setSize(400, 500);
    expect(cls()).toBe(true);
  });
  it('removes it when the keyboard closes', () => {
    input().focus();
    setSize(400, 500);
    setSize(400, 900);
    expect(cls()).toBe(false);
  });
  it('removes it when the input blurs', () => {
    input().focus();
    setSize(400, 500);
    input().blur();
    document.dispatchEvent(new Event('focusout'));
    expect(cls()).toBe(false);
  });
  it('ignores a drop without a focused input', () => {
    setSize(400, 500);
    expect(cls()).toBe(false);
  });
  it('ignores a small drop', () => {
    input().focus();
    setSize(400, 800);
    expect(cls()).toBe(false);
  });
  it('resets the baseline on orientation change', () => {
    input().focus();
    setSize(900, 400);
    expect(cls()).toBe(false);
    setSize(900, 380);
    expect(cls()).toBe(false);
  });
});

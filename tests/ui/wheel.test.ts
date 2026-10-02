import { describe, it, expect, afterEach } from 'vitest';
import { wheelDelta, findScrollTarget, installWheelScroll } from '../../src/ui/wheel';

function scrollable(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'screen';
  el.style.overflowY = 'auto';
  Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 1000, configurable: true });
  document.body.appendChild(el);
  return el;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('wheelDelta', () => {
  it('handles pixel, line and page modes', () => {
    expect(wheelDelta({ deltaY: 100, deltaMode: 0 }, 1000)).toBe(100);
    expect(wheelDelta({ deltaY: 3, deltaMode: 1 }, 1000)).toBe(120);
    expect(wheelDelta({ deltaY: 1, deltaMode: 2 }, 800)).toBe(800);
  });
});

describe('findScrollTarget', () => {
  it('finds the scrollable ancestor and respects the ends', () => {
    const screen = scrollable();
    const child = document.createElement('span');
    screen.appendChild(child);
    expect(findScrollTarget(child, 50)).toBe(screen);
    expect(findScrollTarget(child, -50)).toBeNull();
    screen.scrollTop = 1000;
    expect(findScrollTarget(child, 50)).toBeNull();
    expect(findScrollTarget(child, -50)).toBe(screen);
  });

  it('falls back to the current screen when the pointer is over a non-scrollable area', () => {
    const screen = scrollable();
    const other = document.createElement('div');
    document.body.appendChild(other);
    expect(findScrollTarget(other, 50)).toBe(screen);
  });
});

describe('installWheelScroll', () => {
  it('scrolls the screen by deltaY and prevents default', () => {
    const screen = scrollable();
    const off = installWheelScroll();
    const e = new Event('wheel', { cancelable: true, bubbles: true }) as any;
    e.deltaY = 120; e.deltaMode = 0; e.clientX = 5; e.clientY = 5;
    screen.dispatchEvent(e);
    off();
    expect(screen.scrollTop).toBe(120);
    expect(e.defaultPrevented).toBe(true);
  });
});

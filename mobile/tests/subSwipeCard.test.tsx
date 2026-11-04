import { describe, it, expect } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { SubSwipeCard } from '../src/ui/SubSwipeCard';
import { SUB_SWIPE_THRESHOLD } from '../src/ui/subSwipe';

function touch(el: Element, type: string, x: number, y: number) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  const point = { clientX: x, clientY: y, identifier: 1 };
  Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [point] });
  Object.defineProperty(ev, 'changedTouches', { value: [point] });
  act(() => {
    el.dispatchEvent(ev);
  });
}

describe('subscription card swipe', () => {
  it('a swipe without a click does not swallow the next tap', () => {
    const clicks: string[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => {
      render(
        <SubSwipeCard id="s" onCheck={() => undefined} onDelete={() => undefined}>
          <button type="button" class="open" onClick={() => clicks.push('open')}>Open</button>
        </SubSwipeCard>,
        host,
      );
    });
    const card = host.querySelector('[data-sub-swipe]')!;
    touch(card, 'touchstart', 200, 40);
    touch(card, 'touchmove', 200 - SUB_SWIPE_THRESHOLD - 8, 42);
    touch(card, 'touchend', 100, 42);
    act(() => {
      (host.querySelector('.open') as HTMLButtonElement).click();
    });
    expect(clicks).toEqual([]);
    touch(card, 'touchstart', 80, 40);
    touch(card, 'touchend', 80, 40);
    act(() => {
      (host.querySelector('.open') as HTMLButtonElement).click();
    });
    expect(clicks).toEqual(['open']);
    host.remove();
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { openRowKey, RowSwipe } from '../src/ui/RowSwipe';
import { ROW_OPEN_AT } from '../src/ui/rowSwipeGesture';

function touch(el: Element, type: string, points: { x: number; y: number }[]) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  const list = points.map((p, i) => ({ clientX: p.x, clientY: p.y, identifier: i + 1 }));
  Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : list });
  Object.defineProperty(ev, 'changedTouches', { value: list });
  act(() => {
    el.dispatchEvent(ev);
  });
}

function mount(disabled = false) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    render(
      <RowSwipe id="row-1" disabled={disabled} onRemove={() => undefined} onWatched={() => undefined}>
        <span class="title">Title</span>
      </RowSwipe>,
      host,
    );
  });
  return host;
}

describe('catalog row actions', () => {
  beforeEach(() => {
    openRowKey.value = '';
    document.body.innerHTML = '';
  });

  it('hides the actions from focus and screen readers until the row is open', () => {
    const host = mount();
    const actions = host.querySelector('.m-row-swipe-actions') as HTMLElement;
    const buttons = Array.from(actions.querySelectorAll('button'));
    expect(actions.getAttribute('aria-hidden')).toBe('true');
    expect(actions.hasAttribute('inert')).toBe(true);
    expect(buttons.map((b) => b.disabled)).toEqual([true, true]);
    expect(buttons.map((b) => b.tabIndex)).toEqual([-1, -1]);
    const row = host.querySelector('.m-row-swipe')!;
    touch(row, 'touchstart', [{ x: 200, y: 40 }]);
    touch(row, 'touchmove', [{ x: 200 - ROW_OPEN_AT - 8, y: 42 }]);
    touch(row, 'touchend', [{ x: 100, y: 42 }]);
    expect(actions.getAttribute('aria-hidden')).toBe('false');
    expect(actions.hasAttribute('inert')).toBe(false);
    expect(buttons.map((b) => b.disabled)).toEqual([false, false]);
  });

  it('a second finger puts a half-open row back', () => {
    const host = mount();
    const row = host.querySelector('.m-row-swipe')!;
    const fg = host.querySelector('.m-row-swipe-fg') as HTMLElement;
    touch(row, 'touchstart', [{ x: 220, y: 30 }]);
    touch(row, 'touchmove', [{ x: 140, y: 32 }]);
    expect(fg.style.transform).toContain('translateX');
    touch(row, 'touchstart', [{ x: 140, y: 32 }, { x: 180, y: 80 }]);
    expect(fg.style.transform).toBe('');
  });

  it('a disabled row keeps the actions shut', () => {
    const host = mount(true);
    const actions = host.querySelector('.m-row-swipe-actions') as HTMLElement;
    expect(actions.getAttribute('aria-hidden')).toBe('true');
    expect(Array.from(actions.querySelectorAll('button')).every((b) => b.disabled)).toBe(true);
  });
});

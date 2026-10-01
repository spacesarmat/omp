import { describe, it, expect, vi, afterEach } from 'vitest';
import { pushKeyHandler, dispatchKey, installKeyListener } from '../../src/ui/keys';

function press(keyCode: number, target: EventTarget = document.body): Event {
  const e = new Event('keydown', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'keyCode', { value: keyCode });
  target.dispatchEvent(e);
  return e;
}

const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); document.body.innerHTML = ''; });

describe('dispatchKey', () => {
  it('calls newest handler first and respects priority', () => {
    const calls: string[] = [];
    cleanups.push(pushKeyHandler(() => { calls.push('low-old'); return false; }));
    cleanups.push(pushKeyHandler(() => { calls.push('low-new'); return false; }));
    cleanups.push(pushKeyHandler(() => { calls.push('high'); return false; }, 10));
    dispatchKey('enter', {} as KeyboardEvent);
    expect(calls).toEqual(['high', 'low-new', 'low-old']);
  });
  it('stops at first truthy result', () => {
    const later = vi.fn(() => false);
    cleanups.push(pushKeyHandler(later));
    cleanups.push(pushKeyHandler(() => 'spatial'));
    expect(dispatchKey('up', {} as KeyboardEvent)).toBe('spatial');
    expect(later).not.toHaveBeenCalled();
  });
});

describe('installKeyListener', () => {
  it('calls back fallback when nobody handles back', () => {
    const back = vi.fn();
    cleanups.push(installKeyListener(back));
    const e = press(461);
    expect(back).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });
  it('consumed keys are prevented', () => {
    cleanups.push(installKeyListener(() => undefined));
    cleanups.push(pushKeyHandler((a) => a === 'red'));
    expect(press(403).defaultPrevented).toBe(true);
    expect(press(404).defaultPrevented).toBe(false);
  });
  it('inside text input: backspace untouched, back blurs', () => {
    const back = vi.fn();
    cleanups.push(installKeyListener(back));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    press(8, input);
    expect(back).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    const e = press(461, input);
    expect(document.activeElement).not.toBe(input);
    expect(back).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });
  it('left/right in text input stay native and hidden from bubble listeners', () => {
    cleanups.push(installKeyListener(() => undefined));
    const bubble = vi.fn();
    window.addEventListener('keydown', bubble);
    cleanups.push(() => window.removeEventListener('keydown', bubble));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const e = press(37, input);
    expect(bubble).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
    press(37, document.body);
    expect(bubble).toHaveBeenCalledTimes(1);
  });
});

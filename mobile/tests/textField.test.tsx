import { describe, it, expect } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { createRef } from 'preact';
import { TextField } from '../src/ui/TextField';

describe('TextField clear button', () => {
  it('hides after the value is cleared through the ref, without an input event', () => {
    const ref = createRef<HTMLInputElement>();
    const el = document.createElement('div');
    document.body.appendChild(el);
    act(() => render(<TextField ref={ref} />, el));
    const input = el.querySelector('input') as HTMLInputElement;
    act(() => {
      input.value = 'secret';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(el.querySelector('[data-clear]')).toBeTruthy();
    act(() => {
      if (ref.current) ref.current.value = '';
    });
    expect(input.value).toBe('');
    expect(el.querySelector('[data-clear]')).toBeNull();
    act(() => render(null, el));
    el.remove();
  });
});

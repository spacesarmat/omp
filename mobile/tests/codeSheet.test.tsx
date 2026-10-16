import { describe, it, expect } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { CodeSheet, pairingCodeLength } from '../src/ui/CodeSheet';

function mount(version: string | undefined, submitted: string[]) {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  act(() => {
    render(
      <CodeSheet
        tvName="Гостиная"
        version={version}
        onSubmit={async (code) => {
          submitted.push(code);
        }}
        onCancel={() => {}}
      />,
      el,
    );
  });
  return el;
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  act(() => {
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
}

describe('pairing code length', () => {
  it('uses 4 digits before 0.20.1-beta.11 and 6 from that build on', () => {
    expect(pairingCodeLength('0.20.0')).toBe(4);
    expect(pairingCodeLength('0.20.1-beta.10')).toBe(4);
    expect(pairingCodeLength('0.20.1-beta.11')).toBe(6);
    expect(pairingCodeLength('0.20.1')).toBe(6);
    expect(pairingCodeLength('')).toBe(0);
    expect(pairingCodeLength(undefined)).toBe(0);
  });

  it('an older TV submits its 4-digit code', async () => {
    const submitted: string[] = [];
    const el = mount('0.20.1-beta.10', submitted);
    const cells = Array.from(el.querySelectorAll('input'));
    expect(cells).toHaveLength(4);
    cells.forEach((cell, i) => type(cell, String(i + 1)));
    const button = el.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await act(async () => {
      button.click();
    });
    expect(submitted).toEqual(['1234']);
  });

  it('a current TV stays disabled until six digits', () => {
    const el = mount('0.20.1-beta.14', []);
    const cells = Array.from(el.querySelectorAll('input'));
    expect(cells).toHaveLength(6);
    cells.slice(0, 4).forEach((cell, i) => type(cell, String(i + 1)));
    expect((el.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
    type(cells[4], '5');
    type(cells[5], '6');
    expect((el.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('an unknown version accepts four digits or six', () => {
    const el = mount(undefined, []);
    const cells = Array.from(el.querySelectorAll('input'));
    expect(cells).toHaveLength(6);
    cells.slice(0, 4).forEach((cell, i) => type(cell, String(i + 1)));
    expect((el.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
    type(cells[4], '5');
    expect((el.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
  });
});

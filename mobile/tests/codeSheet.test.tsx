import { describe, it, expect } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
// @ts-ignore node builtins
import { readFileSync } from 'node:fs';
import { CodeSheet, pairingCodeLength } from '../src/ui/CodeSheet';
import {
  CODE_CELL_MAX,
  CODE_CELL_MIN,
  CODE_CELLS,
  CODE_GAP_MAX,
  CODE_GAP_MIN,
  CODE_ROW_BASIS,
  codeCellWidth,
  codeRowGap,
  codeRowUsed,
  sheetContentWidth,
} from '../src/ui/codeCells';

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

  it('six cells fit the sheet from 320dp up, with a 44px touch target', () => {
    const css = readFileSync('mobile/src/mobile.css', 'utf8').replace(/\r\n/g, '\n');
    const row = css.slice(css.indexOf('.m-code {'), css.indexOf('.m-code-cell {'));
    const cell = css.slice(css.indexOf('.m-code-cell {'), css.indexOf('.m-code-cell:focus'));
    expect(row).toContain('width: 100%');
    expect(row).toContain('justify-content: center');
    expect(row).toContain(
      `gap: clamp(${CODE_GAP_MIN}px, calc((100cqi - ${CODE_ROW_BASIS}px) / ${CODE_CELLS - 1}), ${CODE_GAP_MAX}px)`,
    );
    expect(cell).toContain('flex: 1 1 0');
    expect(cell).toContain(`min-width: ${CODE_CELL_MIN}px`);
    expect(cell).toContain(`max-width: ${CODE_CELL_MAX}px`);
    expect(cell).toContain(`min-height: ${CODE_CELL_MIN}px`);
    // an overlay keyboard lifts the sheet; adjustResize leaves the inset at 0 and the button stays put
    expect(css).toContain('html.m-kb-open .m-sheet-host:has(.m-code) { bottom: var(--kb-inset, 0px); }');

    for (const viewport of [320, 360, 392, 412, 480, 800]) {
      const content = sheetContentWidth(viewport);
      for (const cells of [4, 6]) {
        const gap = codeRowGap(content);
        const cellW = codeCellWidth(content, cells);
        expect(gap).toBeGreaterThanOrEqual(CODE_GAP_MIN);
        expect(gap).toBeLessThanOrEqual(CODE_GAP_MAX);
        expect(cellW).toBeGreaterThanOrEqual(CODE_CELL_MIN);
        expect(cellW).toBeLessThanOrEqual(CODE_CELL_MAX);
        expect(codeRowUsed(content, cells)).toBeLessThanOrEqual(content + 0.01);
      }
    }
    // the narrow phone keeps the floor; a wide one reaches the 60×12 design
    const narrow = sheetContentWidth(320);
    expect(codeRowGap(narrow)).toBe(CODE_GAP_MIN);
    expect(codeCellWidth(narrow, 6)).toBeGreaterThanOrEqual(CODE_CELL_MIN);
    expect(codeCellWidth(narrow, 6)).toBeLessThan(CODE_CELL_MAX);
    const wide = sheetContentWidth(800);
    expect(codeRowGap(wide)).toBe(CODE_GAP_MAX);
    expect(codeCellWidth(wide, 6)).toBe(CODE_CELL_MAX);
    expect(codeRowUsed(wide, 6)).toBeLessThan(wide);
    // gap only grows as the sheet gets wider
    const gaps = [320, 360, 420, 520].map((w) => codeRowGap(sheetContentWidth(w)));
    expect(gaps[1]).toBeGreaterThanOrEqual(gaps[0]);
    expect(gaps[2]).toBeGreaterThan(gaps[1]);
    expect(gaps[3]).toBeGreaterThanOrEqual(gaps[2]);
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

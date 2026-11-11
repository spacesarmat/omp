import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultTheme } from '../../design/defaults';
import { observeDesignElements } from '../../desktop/src/preview/designElements';

const BASE = '0000000000000000000000000000000000000000';
let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  document.body.innerHTML = '';
});

describe('design element adapter', () => {
  it('marks registered component types and preserves existing design IDs', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<span data-design-id="custom">custom</span><button></button><input><div class="m-card"></div><div class="choice-row"></div><button class="m-set-row"></button><div class="list-item"></div>';
    document.body.appendChild(root);
    const theme = createDefaultTheme(BASE);
    theme.overrides.push({ id: 'phone-page', scope: 'target', target: 'android-phone', tokens: { '--omp-color-accent': '#112233' } });
    cleanup = observeDesignElements(root, theme, { target: 'android-phone', screenId: 'settings', format: 'landscape', state: 'default' });

    const dynamic = document.createElement('button');
    root.appendChild(dynamic);
    await Promise.resolve();

    expect(root.querySelector('[data-design-id="custom"]')!.getAttribute('data-design-overrides')).toBeNull();
    for (const [selector, id] of [['button', 'button'], ['input', 'input'], ['.m-card', 'card'], ['.choice-row', 'choice-row'], ['.m-set-row', 'choice-row'], ['.list-item', 'card']] as const) {
      const element = root.querySelector(selector)!;
      expect(element.getAttribute('data-design-id')).toBe(id);
      expect(element.getAttribute('data-design-component')).toBe(id);
      expect(element.getAttribute('data-design-overrides')).toContain('phone-page');
    }
    expect(dynamic.getAttribute('data-design-id')).toBe('button');
  });
});

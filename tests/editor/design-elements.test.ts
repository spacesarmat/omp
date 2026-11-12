import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultTheme } from '../../design/defaults';
import { collectLayoutNodes, layoutRootOf } from '../../design/layoutDom';
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

describe('design element adapter', () => {
  it('registers adapter identities before the first walk so saved edits match after decoration', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div><button>Go</button></div>';
    document.body.appendChild(root);
    const theme = createDefaultTheme(BASE);
    theme.layout = {
      containers: [],
      placements: [{
        id: 'placement-button',
        target: 'android-phone',
        screenId: 'settings',
        format: 'landscape',
        nodeId: 'button',
        mode: 'absolute',
        x: 1000,
        y: 1000,
        anchor: 'top-left',
        width: 'auto',
        height: 'auto',
        zIndex: 3,
        hidden: false,
        locked: false,
        label: 'Go',
      }],
    };

    cleanup = observeDesignElements(root, theme, { target: 'android-phone', screenId: 'settings', format: 'landscape', state: 'default' });

    const button = root.querySelector('button') as HTMLElement;
    // The edit was saved against the adapter id the editor canvas shows after decoration; the
    // runtime must resolve the same id instead of a path id frozen by a pre-decoration walk.
    expect(button.style.position).toBe('absolute');
    expect(button.style.zIndex).toBe('3');
    expect(collectLayoutNodes(root).some((node) => node.nodeId === 'button' && node.label === 'Go')).toBe(true);
  });

  it('shares the resolved node ids with the editor canvas through the layout node stamp', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<div><button>One</button></div>';
    document.body.appendChild(root);
    const theme = createDefaultTheme(BASE);

    cleanup = observeDesignElements(root, theme, { target: 'android-phone', screenId: 'settings', format: 'landscape', state: 'default' });

    const button = root.querySelector('button') as HTMLElement;
    // The runtime stamps every resolved identity onto its element; the editor canvas lives in a
    // separate module realm and reads the same stamp, so both never disagree on an element id.
    expect(button.dataset.layoutNode).toBeTruthy();
    const collected = collectLayoutNodes(root);
    expect(collected.find((node) => node.nodeId === button.dataset.layoutNode)?.label).toBe('One');

    const extra = document.createElement('button');
    extra.textContent = 'Two';
    root.firstElementChild!.appendChild(extra);
    await Promise.resolve();

    expect(extra.dataset.layoutNode).toBeTruthy();
    expect(collectLayoutNodes(root).some((node) => node.nodeId === extra.dataset.layoutNode)).toBe(true);
  });
});

describe('layout root contract', () => {
  it('registers the application root so editor collection resolves exactly the runtime tree', () => {
    const chrome = document.createElement('div');
    document.body.appendChild(chrome);
    const root = document.createElement('div');
    root.innerHTML = '<div data-design-id="toolbar"><button data-design-id="button">Go</button><span>Caption</span></div>';
    document.body.appendChild(root);
    const theme = createDefaultTheme(BASE);

    cleanup = observeDesignElements(root, theme, { target: 'android-phone', screenId: 'settings', format: 'landscape', state: 'default' });

    const collectedRoot = layoutRootOf(document);
    expect(collectedRoot).toBe(root);
    const collected = collectLayoutNodes(collectedRoot!);
    expect(collected.map((node) => node.nodeId)).toEqual(collectLayoutNodes(root).map((node) => node.nodeId));
    // Path ids are relative to the registered root, never to the iframe body above it.
    expect(collected.find((node) => node.label === 'Caption')!.nodeId).toBe('path-0-1');
    expect(collected.some((node) => node.nodeId === 'path-0-0-1')).toBe(false);
  });

  it('falls back to the document body when no root is registered', () => {
    expect(layoutRootOf(document)).toBe(document.body);
  });
});

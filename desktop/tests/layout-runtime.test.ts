import { afterEach, describe, expect, it, vi } from 'vitest';

const generated = vi.hoisted(() => ({
  layout: {
    containers: [] as import('../../design/layout').LayoutContainer[],
    placements: [] as import('../../design/layout').LayoutPlacement[],
    clones: [] as import('../../design/layout').LayoutClone[],
  },
}));

vi.mock('../../design/generated/layout.ts', () => ({ PRODUCTION_LAYOUT: generated.layout }));

import { createDefaultTheme } from '../../design/defaults';
import { observeLayout } from '../../design/layoutDom';
import { observeProductionLayout } from '../../design/layoutDom';
import { PRODUCTION_LAYOUT } from '../../design/generated/layout';
import type { LayoutContainer, LayoutDocument, LayoutPlacement } from '../../design/layout';

const BASE = '0000000000000000000000000000000000000000';
const productionContext = { target: 'desktop-windows', screenId: 'library', format: 'landscape' } as const;

function container(patch: Partial<LayoutContainer> = {}): LayoutContainer {
  return {
    id: 'flow-card-grid',
    target: productionContext.target,
    screenId: productionContext.screenId,
    format: productionContext.format,
    nodeId: 'card-grid',
    order: [],
    ...patch,
  };
}

function placement(patch: Partial<LayoutPlacement> = {}): LayoutPlacement {
  return {
    id: 'placement-node',
    target: productionContext.target,
    screenId: productionContext.screenId,
    format: productionContext.format,
    nodeId: 'key-hash-1',
    mode: 'flow',
    x: 0,
    y: 0,
    anchor: 'top-left',
    width: 'auto',
    height: 'auto',
    zIndex: 0,
    hidden: false,
    locked: false,
    label: 'node',
    ...patch,
  };
}

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('data-design-target', productionContext.target);
  root.setAttribute('data-design-screen', productionContext.screenId);
  root.setAttribute('data-design-format', productionContext.format);
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

const GRID = `
  <div data-design-id="card-grid">
    <div class="m-card" data-key="hash-1" data-design-id="card">A</div>
    <div class="m-card" data-key="hash-2" data-design-id="card">B</div>
  </div>`;

const keys = (root: HTMLElement) =>
  [...root.querySelectorAll('[data-key]')].map((element) => element.getAttribute('data-key'));

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  generated.layout.containers = [];
  generated.layout.placements = [];
  generated.layout.clones = [];
  document.body.innerHTML = '';
});

describe('production layout runtime', () => {
  it('ships an empty generated layout and leaves the DOM untouched', async () => {
    expect(PRODUCTION_LAYOUT.containers).toEqual([]);
    expect(PRODUCTION_LAYOUT.placements).toEqual([]);

    const root = mount(GRID);
    cleanup = observeProductionLayout(root);
    await Promise.resolve();

    expect(keys(root)).toEqual(['hash-1', 'hash-2']);
    for (const element of root.querySelectorAll<HTMLElement>('[data-key]')) {
      expect(element.getAttribute('style')).toBeNull();
      expect(element.getAttribute('data-layout-mode')).toBeNull();
    }
  });

  it('applies the same node order in preview and production fixtures', async () => {
    generated.layout.containers = [container({ order: ['key-hash-2', 'key-hash-1'] })];
    generated.layout.placements = [placement({ nodeId: 'key-hash-1', mode: 'absolute', x: 40, y: 24 })];

    const previewRoot = mount(GRID);
    const theme = createDefaultTheme(BASE);
    theme.layout = structuredClone(generated.layout as LayoutDocument);
    const stopPreview = observeLayout(previewRoot, theme, { ...productionContext });
    cleanup = () => stopPreview();

    const productionRoot = mount(GRID);
    const stopProduction = observeProductionLayout(productionRoot);
    const previous = cleanup;
    cleanup = () => {
      previous?.();
      stopProduction();
    };

    await Promise.resolve();

    expect(keys(previewRoot)).toEqual(['hash-2', 'hash-1']);
    expect(keys(productionRoot)).toEqual(['hash-2', 'hash-1']);
    const previewItem = previewRoot.querySelector<HTMLElement>('[data-key="hash-1"]')!;
    const productionItem = productionRoot.querySelector<HTMLElement>('[data-key="hash-1"]')!;
    expect(previewItem.style.left).toBe('0.4%');
    expect(productionItem.style.left).toBe('0.4%');
  });

  it('ignores editor-only locks in production while the editor runtime honors them', async () => {
    generated.layout.containers = [];
    generated.layout.placements = [placement({ mode: 'absolute', x: 40, y: 24, locked: true })];

    const productionRoot = mount(GRID);
    const stopProduction = observeProductionLayout(productionRoot);
    cleanup = () => stopProduction();

    const previewRoot = mount(GRID);
    const theme = createDefaultTheme(BASE);
    theme.layout = structuredClone(generated.layout as LayoutDocument);
    const stopPreview = observeLayout(previewRoot, theme, { ...productionContext });
    const previous = cleanup;
    cleanup = () => {
      previous?.();
      stopPreview();
    };

    await Promise.resolve();

    expect(productionRoot.querySelector<HTMLElement>('[data-key="hash-1"]')!.style.position).toBe('absolute');
    expect(previewRoot.querySelector<HTMLElement>('[data-key="hash-1"]')!.style.position).toBe('');
  });

  it('keeps missing nodes in the production document order', async () => {
    generated.layout.containers = [container({ order: ['key-hash-1', 'key-hash-3', 'key-hash-2'] })];
    generated.layout.placements = [];

    const root = mount(GRID);
    cleanup = observeProductionLayout(root);
    await Promise.resolve();
    expect(keys(root)).toEqual(['hash-1', 'hash-2']);

    const late = document.createElement('div');
    late.dataset.key = 'hash-3';
    late.dataset.designId = 'card';
    root.querySelector('[data-design-id="card-grid"]')!.appendChild(late);
    await Promise.resolve();

    expect(keys(root)).toEqual(['hash-1', 'hash-3', 'hash-2']);
  });

  it('observes a production root only once with correct cleanup semantics', () => {
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    try {
      const root = mount(GRID);
      const first = observeProductionLayout(root);
      const second = observeProductionLayout(root);
      expect(observe).toHaveBeenCalledTimes(1);

      second();
      expect(disconnect).not.toHaveBeenCalled();
      expect(keys(root)).toEqual(['hash-1', 'hash-2']);

      first();
      expect(disconnect).toHaveBeenCalledTimes(1);

      const third = observeProductionLayout(root);
      expect(observe).toHaveBeenCalledTimes(2);
      third();
      expect(disconnect).toHaveBeenCalledTimes(2);
    } finally {
      observe.mockRestore();
      disconnect.mockRestore();
    }
  });

  it('is a no-op when the root carries no design context', async () => {
    generated.layout.containers = [container({ order: ['key-hash-2', 'key-hash-1'] })];
    generated.layout.placements = [placement({ mode: 'absolute', x: 40, y: 24 })];

    const root = document.createElement('div');
    root.innerHTML = GRID;
    document.body.appendChild(root);
    cleanup = observeProductionLayout(root);
    await Promise.resolve();

    expect(keys(root)).toEqual(['hash-1', 'hash-2']);
    expect(root.querySelector<HTMLElement>('[data-key="hash-1"]')!.getAttribute('style')).toBeNull();
  });

  it('hides hidden nodes in both preview and production runtimes', async () => {
    generated.layout.containers = [];
    generated.layout.placements = [placement({ hidden: true })];

    const previewRoot = mount(GRID);
    const theme = createDefaultTheme(BASE);
    theme.layout = structuredClone(generated.layout as LayoutDocument);
    const stopPreview = observeLayout(previewRoot, theme, { ...productionContext });
    cleanup = () => stopPreview();

    const productionRoot = mount(GRID);
    const stopProduction = observeProductionLayout(productionRoot);
    const previous = cleanup;
    cleanup = () => {
      previous?.();
      stopProduction();
    };

    await Promise.resolve();

    expect(previewRoot.querySelector<HTMLElement>('[data-key="hash-1"]')!.style.display).toBe('none');
    expect(productionRoot.querySelector<HTMLElement>('[data-key="hash-1"]')!.style.display).toBe('none');
  });

  it('materializes clones in both preview and production runtimes', async () => {
    generated.layout.containers = [];
    generated.layout.placements = [];
    generated.layout.clones = [{
      id: 'clone-demo',
      target: productionContext.target,
      screenId: productionContext.screenId,
      format: productionContext.format,
      nodeId: 'copy-demo',
      parentId: 'card-grid',
      label: 'Copy',
      sourceNodeId: 'key-hash-1',
      html: '<div class="m-card" data-design-id="card">Cloned</div>',
    }];

    const previewRoot = mount(GRID);
    const theme = createDefaultTheme(BASE);
    theme.layout = structuredClone(generated.layout as LayoutDocument);
    const stopPreview = observeLayout(previewRoot, theme, { ...productionContext });
    cleanup = () => stopPreview();

    const productionRoot = mount(GRID);
    const stopProduction = observeProductionLayout(productionRoot);
    const previous = cleanup;
    cleanup = () => {
      previous?.();
      stopProduction();
    };

    await Promise.resolve();

    for (const root of [previewRoot, productionRoot]) {
      const clone = root.querySelector<HTMLElement>('[data-layout-clone="copy-demo"]')!;
      expect(clone).not.toBeNull();
      expect(clone.textContent).toBe('Cloned');
      expect(clone.parentElement!.getAttribute('data-design-id')).toBe('card-grid');
      const original = root.querySelector<HTMLElement>('[data-key="hash-1"]')!;
      expect(original.textContent).toBe('A');
    }
  });

  it('applies margin and container layout fields in production like in preview', async () => {
    generated.layout.containers = [container({
      order: ['key-hash-1', 'key-hash-2'],
      direction: 'column',
      padding: '8px',
      alignment: 'center',
      distribution: 'space-between',
    })];
    generated.layout.placements = [placement({ nodeId: 'key-hash-1', margin: '12px' })];

    const productionRoot = mount(GRID);
    const stopProduction = observeProductionLayout(productionRoot);
    cleanup = () => stopProduction();

    const previewRoot = mount(GRID);
    const theme = createDefaultTheme(BASE);
    theme.layout = structuredClone(generated.layout as LayoutDocument);
    const stopPreview = observeLayout(previewRoot, theme, { ...productionContext });
    const previous = cleanup;
    cleanup = () => {
      previous?.();
      stopPreview();
    };

    await Promise.resolve();

    for (const root of [previewRoot, productionRoot]) {
      const grid = root.querySelector<HTMLElement>('[data-design-id="card-grid"]')!;
      expect(grid.style.flexDirection).toBe('column');
      expect(grid.style.padding).toBe('8px');
      expect(grid.style.alignItems).toBe('center');
      expect(grid.style.justifyContent).toBe('space-between');
      expect(grid.getAttribute('style') ?? '').not.toContain('gap');
      expect(root.querySelector<HTMLElement>('[data-key="hash-1"]')!.style.margin).toBe('12px');
    }
  });

  it('restores inline styles and document order when the orientation context changes', async () => {
    generated.layout.containers = [container({ order: ['key-hash-2', 'key-hash-1'] })];
    generated.layout.placements = [placement({ mode: 'absolute', x: 40, y: 24, hidden: true })];

    const root = mount(GRID);
    cleanup = observeProductionLayout(root);
    await Promise.resolve();

    const first = () => root.querySelector<HTMLElement>('[data-key="hash-1"]')!;
    expect(first().style.position).toBe('absolute');
    expect(first().style.display).toBe('none');
    expect(keys(root)).toEqual(['hash-2', 'hash-1']);

    root.setAttribute('data-design-format', 'portrait');
    root.appendChild(document.createElement('span'));
    await Promise.resolve();

    expect(first().style.position).toBe('');
    expect(first().style.display).toBe('');
    expect(keys(root)).toEqual(['hash-1', 'hash-2']);
  });
});

import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../editor/src/App';
import * as protocol from '../../editor/src/preview/protocol';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDraftController, type DraftController } from '../../editor/src/drafts';
import {
  absolutePlacementFromRect,
  moveNodeTransaction,
  placeNodeTransaction,
  placementToRect,
} from '../../editor/src/layout/transactions';
import { getLayoutPlacement } from '../../design/layout';
import type { LayoutContext } from '../../design/schema';

const BASE = '0000000000000000000000000000000000000000';
let host: HTMLDivElement;
let controller: DraftController;

function clientRect(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) } as DOMRect;
}

function contextOf(): LayoutContext {
  return { target: controller.draft.target, screenId: controller.draft.screenId, format: controller.draft.format };
}

function placementOf(nodeId: string) {
  return getLayoutPlacement(controller.draft.theme, contextOf(), nodeId);
}

function pointer(target: HTMLElement, type: string, x: number, y: number, options: MouseEventInit = {}): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...options });
  Object.defineProperty(event, 'pointerId', { value: 7 });
  act(() => {
    target.dispatchEvent(event);
  });
}

function clickButton(testId: string): void {
  const button = host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!button) throw new Error(`button ${testId} is missing`);
  act(() => {
    button.click();
  });
}

function buildPreview(options: { toolbar?: boolean } = {}): void {
  const iframe = host.querySelector<HTMLIFrameElement>('iframe')!;
  iframe.getBoundingClientRect = () => clientRect(0, 0, 1280, 720);
  const doc = iframe.contentDocument!;
  if (!doc.documentElement) doc.appendChild(doc.createElement('html'));
  let body = doc.body;
  if (!body) {
    body = doc.createElement('body');
    doc.documentElement.appendChild(body);
  }
  body.innerHTML = '';
  const make = (designId: string, x: number, y: number, width: number, height: number): HTMLElement => {
    const element = doc.createElement('div');
    element.dataset.designId = designId;
    element.getBoundingClientRect = () => clientRect(x, y, width, height);
    return element;
  };
  const grid = make('card-grid', 0, 0, 400, 400);
  const first = make('server-card', 0, 0, 400, 100);
  const second = make('server-card', 0, 100, 400, 100);
  const input = doc.createElement('input');
  input.dataset.designId = 'settings-continue';
  input.getBoundingClientRect = () => clientRect(0, 200, 400, 50);
  grid.append(first, second, input);
  body.appendChild(grid);
  if (options.toolbar) {
    const toolbar = make('toolbar', 200, 200, 200, 400);
    toolbar.appendChild(make('toolbar-search', 300, 240, 80, 40));
    body.appendChild(toolbar);
  }
  act(() => {
    iframe.dispatchEvent(new Event('load'));
  });
}

function overlay(): HTMLElement {
  const element = host.querySelector<HTMLElement>('[data-testid="selection-overlay"]');
  if (!element) throw new Error('selection overlay is missing');
  return element;
}

function placeAbsolute(nodeId: string, x: number, y: number, width: number, height: number, extra: Record<string, unknown> = {}): void {
  placeNodeTransaction(controller, {
    ...absolutePlacementFromRect(
      { x, y, width, height },
      { x: 0, y: 0, width: 400, height: 400 },
      contextOf(),
      nodeId,
      nodeId,
    ),
    ...extra,
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  controller = createDraftController({
    draft: createDefaultDraft('draft-1', BASE),
    client: {
      state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
      getDraft: async () => null,
      putDraft: async (draft) => draft,
      getDesign: async () => null,
      rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
      exportDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
    },
  });
  act(() => render(h(App, { controller }), host));
  vi.spyOn(protocol, 'sendPreviewCommand').mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => render(null, host));
  controller.dispose();
  host.remove();
  vi.restoreAllMocks();
});

describe('multi-select', () => {
  it('adds nodes to the selection with shift-click and shows the multi inspector', () => {
    buildPreview();

    pointer(overlay(), 'pointerdown', 200, 50);
    pointer(overlay(), 'pointerup', 200, 50);
    pointer(overlay(), 'pointerdown', 200, 150, { shiftKey: true });
    pointer(overlay(), 'pointerup', 200, 150, { shiftKey: true });

    expect(host.querySelectorAll('[data-testid="selection-box"]')).toHaveLength(2);
    const multi = host.querySelector('[data-testid="multi-select-inspector"]');
    expect(multi).not.toBeNull();
    expect(multi!.textContent).toContain('2');
    expect(host.querySelector('[data-testid="layout-inspector"]')).toBeNull();

    pointer(overlay(), 'pointerdown', 200, 50, { shiftKey: true });
    pointer(overlay(), 'pointerup', 200, 50, { shiftKey: true });
    expect(host.querySelectorAll('[data-testid="selection-box"]')).toHaveLength(1);
  });

  it('marquee-selects nodes by dragging on an empty canvas area', () => {
    buildPreview();

    pointer(overlay(), 'pointerdown', 1100, 650);
    pointer(overlay(), 'pointermove', 50, 50);
    expect(host.querySelector('[data-testid="marquee-rect"]')).not.toBeNull();
    pointer(overlay(), 'pointerup', 50, 50);

    expect(host.querySelectorAll('[data-testid="selection-box"]')).toHaveLength(4);

    pointer(overlay(), 'pointerdown', 1100, 650);
    pointer(overlay(), 'pointerup', 1100, 650);
    expect(host.querySelectorAll('[data-testid="selection-box"]')).toHaveLength(0);
  });

  it('aligns the selected absolute nodes with one undo step', () => {
    buildPreview();
    placeAbsolute('server-card', 100, 100, 200, 100);
    placeAbsolute('server-card-2', 50, 300, 100, 50);

    pointer(overlay(), 'pointerdown', 200, 50);
    pointer(overlay(), 'pointerup', 200, 50);
    pointer(overlay(), 'pointerdown', 200, 150, { shiftKey: true });
    pointer(overlay(), 'pointerup', 200, 150, { shiftKey: true });

    const update = vi.spyOn(controller, 'update');
    clickButton('align-left');

    expect(update).toHaveBeenCalledTimes(1);
    expect(placementOf('server-card')!.x).toBe(1250);
    expect(placementOf('server-card-2')!.x).toBe(1250);

    controller.undo();
    expect(placementOf('server-card')!.x).toBe(2500);
    controller.redo();
    expect(placementOf('server-card')!.x).toBe(1250);
  });

  it('distributes three absolute nodes with equal gaps along X in one undo step', () => {
    buildPreview();
    placeAbsolute('server-card', 0, 0, 40, 40);
    placeAbsolute('server-card-2', 120, 120, 40, 40);
    placeAbsolute('settings-continue', 360, 360, 40, 40);

    pointer(overlay(), 'pointerdown', 200, 50);
    pointer(overlay(), 'pointerup', 200, 50);
    pointer(overlay(), 'pointerdown', 200, 150, { shiftKey: true });
    pointer(overlay(), 'pointerup', 200, 150, { shiftKey: true });
    pointer(overlay(), 'pointerdown', 200, 220, { shiftKey: true });
    pointer(overlay(), 'pointerup', 200, 220, { shiftKey: true });

    const update = vi.spyOn(controller, 'update');
    clickButton('distribute-x');

    expect(update).toHaveBeenCalledTimes(1);
    expect(placementOf('server-card')!.x).toBe(0);
    expect(placementOf('server-card-2')!.x).toBe(4500);
    expect(placementOf('settings-continue')!.x).toBe(9000);

    controller.undo();
    expect(placementOf('server-card-2')!.x).toBe(3000);
  });

  it('drags the whole group of absolute nodes with one undo step', () => {
    buildPreview();
    placeAbsolute('server-card', 100, 100, 200, 100);
    placeAbsolute('server-card-2', 50, 300, 100, 50);

    pointer(overlay(), 'pointerdown', 200, 50);
    pointer(overlay(), 'pointerup', 200, 50);
    pointer(overlay(), 'pointerdown', 200, 150, { shiftKey: true });
    pointer(overlay(), 'pointerup', 200, 150, { shiftKey: true });
    expect(host.querySelectorAll('[data-testid="selection-box"]')).toHaveLength(2);

    const update = vi.spyOn(controller, 'update');
    pointer(overlay(), 'pointerdown', 200, 50);
    expect(host.querySelectorAll('[data-testid="selection-box"]')).toHaveLength(2);
    pointer(overlay(), 'pointermove', 260, 90);
    pointer(overlay(), 'pointerup', 260, 90);

    expect(update).toHaveBeenCalledTimes(1);
    expect(placementOf('server-card')).toMatchObject({ mode: 'absolute', x: 4000, y: 3500 });
    expect(placementOf('server-card-2')).toMatchObject({ mode: 'absolute', x: 2750, y: 8500 });

    controller.undo();
    expect(placementOf('server-card')).toMatchObject({ x: 2500, y: 2500 });
    expect(placementOf('server-card-2')).toMatchObject({ x: 1250, y: 7500 });
  });

  it('aligns absolute nodes across different parents by their artboard rectangles', () => {
    buildPreview({ toolbar: true });
    const context = contextOf();
    placeNodeTransaction(controller, absolutePlacementFromRect(
      { x: 200, y: 40, width: 80, height: 40 },
      { x: 0, y: 0, width: 400, height: 400 },
      context,
      'server-card',
      'server-card',
    ));
    placeNodeTransaction(controller, absolutePlacementFromRect(
      { x: 300, y: 240, width: 80, height: 40 },
      { x: 200, y: 200, width: 200, height: 400 },
      context,
      'toolbar-search',
      'toolbar-search',
    ));
    // The same percent lead (5000) means different artboard positions inside parents with
    // different offsets and widths, so percent comparison would treat the pair as aligned already.
    expect(placementOf('server-card')!.x).toBe(5000);
    expect(placementOf('toolbar-search')!.x).toBe(5000);

    pointer(overlay(), 'pointerdown', 240, 60);
    pointer(overlay(), 'pointerup', 240, 60);
    pointer(overlay(), 'pointerdown', 340, 260, { shiftKey: true });
    pointer(overlay(), 'pointerup', 340, 260, { shiftKey: true });

    const update = vi.spyOn(controller, 'update');
    clickButton('align-left');

    expect(update).toHaveBeenCalledTimes(1);
    const gridRect = { x: 0, y: 0, width: 400, height: 400 };
    const toolbarRect = { x: 200, y: 200, width: 200, height: 400 };
    const aRect = placementToRect(placementOf('server-card')!, gridRect);
    const bRect = placementToRect(placementOf('toolbar-search')!, toolbarRect);
    expect(aRect.x).toBe(200);
    expect(bRect.x).toBe(200);
    expect(bRect.width).toBe(80);

    controller.undo();
    expect(placementOf('toolbar-search')!.x).toBe(5000);
    expect(placementOf('server-card')!.x).toBe(5000);
  });

  it('skips locked nodes in a group align', () => {
    buildPreview();
    placeAbsolute('server-card', 50, 100, 100, 50);
    placeAbsolute('server-card-2', 100, 300, 100, 50, { locked: true });
    placeAbsolute('settings-continue', 300, 200, 100, 50);

    pointer(overlay(), 'pointerdown', 200, 50);
    pointer(overlay(), 'pointerup', 200, 50);
    pointer(overlay(), 'pointerdown', 200, 150, { shiftKey: true });
    pointer(overlay(), 'pointerup', 200, 150, { shiftKey: true });
    pointer(overlay(), 'pointerdown', 200, 220, { shiftKey: true });
    pointer(overlay(), 'pointerup', 200, 220, { shiftKey: true });

    clickButton('align-left');

    expect(placementOf('server-card')!.x).toBe(1250);
    expect(placementOf('server-card-2')!.x).toBe(2500);
    expect(placementOf('settings-continue')!.x).toBe(1250);
  });

  it('aligns flow children through the container record with one undo step', () => {
    buildPreview();
    const context = contextOf();
    moveNodeTransaction(controller, { context, nodeId: 'server-card', parentId: 'card-grid', index: 0 });
    moveNodeTransaction(controller, { context, nodeId: 'server-card-2', parentId: 'card-grid', index: 1 });

    pointer(overlay(), 'pointerdown', 200, 50);
    pointer(overlay(), 'pointerup', 200, 50);
    pointer(overlay(), 'pointerdown', 200, 150, { shiftKey: true });
    pointer(overlay(), 'pointerup', 200, 150, { shiftKey: true });

    const update = vi.spyOn(controller, 'update');
    clickButton('align-left');

    expect(update).toHaveBeenCalledTimes(1);
    const container = controller.draft.theme.layout?.containers.find((entry) => entry.nodeId === 'card-grid');
    expect(container?.alignment).toBe('start');
    expect(container?.order).toEqual(['server-card', 'server-card-2']);

    controller.undo();
    expect(controller.draft.theme.layout?.containers.find((entry) => entry.nodeId === 'card-grid')?.alignment).toBeUndefined();
  });

  it('shows the mixed placeholder for different margins and applies one shared margin in one undo step', () => {
    buildPreview();
    placeAbsolute('server-card', 100, 100, 200, 100, { margin: '8px' });
    placeAbsolute('server-card-2', 50, 300, 100, 50, { margin: '16px' });

    pointer(overlay(), 'pointerdown', 200, 50);
    pointer(overlay(), 'pointerup', 200, 50);
    pointer(overlay(), 'pointerdown', 200, 150, { shiftKey: true });
    pointer(overlay(), 'pointerup', 200, 150, { shiftKey: true });

    const margin = host.querySelector<HTMLInputElement>('[data-testid="multi-margin"]')!;
    expect(margin.value).toBe('');
    expect(margin.placeholder).toBe('разные');

    const update = vi.spyOn(controller, 'update');
    act(() => {
      margin.value = '12';
      // preact maps onChange to native 'change'; when preact/compat is loaded in the shared
      // worker it maps to 'input'. Exactly one of the two dispatches reaches the handler.
      margin.dispatchEvent(new Event('input', { bubbles: true }));
      margin.value = '12';
      margin.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(placementOf('server-card')?.margin).toBe('12px');
    expect(placementOf('server-card-2')?.margin).toBe('12px');
    controller.undo();
    expect(placementOf('server-card')?.margin).toBe('8px');
    expect(placementOf('server-card-2')?.margin).toBe('16px');
  });

  it('applies a shared margin to the selection in one undo step', () => {
    buildPreview();
    placeAbsolute('server-card', 100, 100, 200, 100);
    placeAbsolute('server-card-2', 50, 300, 100, 50);

    pointer(overlay(), 'pointerdown', 200, 50);
    pointer(overlay(), 'pointerup', 200, 50);
    pointer(overlay(), 'pointerdown', 200, 150, { shiftKey: true });
    pointer(overlay(), 'pointerup', 200, 150, { shiftKey: true });

    const margin = host.querySelector<HTMLInputElement>('[data-testid="multi-margin"]')!;
    expect(margin.value).toBe('');
    const update = vi.spyOn(controller, 'update');
    act(() => {
      margin.value = '12';
      // preact maps onChange to native 'change'; when preact/compat is loaded in the shared
      // worker it maps to 'input'. Exactly one of the two dispatches reaches the handler.
      margin.dispatchEvent(new Event('input', { bubbles: true }));
      margin.value = '12';
      margin.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(placementOf('server-card')?.margin).toBe('12px');
    expect(placementOf('server-card-2')?.margin).toBe('12px');
    controller.undo();
    expect(placementOf('server-card')?.margin).toBeUndefined();
  });
});

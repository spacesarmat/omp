import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../editor/src/App';
import * as protocol from '../../editor/src/preview/protocol';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDraftController, type DraftController } from '../../editor/src/drafts';
import {
  absolutePlacementFromRect,
  createPlacement,
  moveNodeTransaction,
  placeNodeTransaction,
  updateContainerTransaction,
} from '../../editor/src/layout/transactions';
import { getLayoutPlacement } from '../../design/layout';
import { formatSizeField, parseSpacingField } from '../../editor/src/components/LayoutInspector';
import type { LayoutContext } from '../../design/schema';

const BASE = '0000000000000000000000000000000000000000';
let host: HTMLDivElement;
let controller: DraftController;

function clientRect(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) } as DOMRect;
}

function select(testId: string, value: string): void {
  const input = host.querySelector<HTMLSelectElement>(`[data-testid="${testId}"]`)!;
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function contextOf(): LayoutContext {
  return { target: controller.draft.target, screenId: controller.draft.screenId, format: controller.draft.format };
}

function orderOf(parentId: string): string[] {
  const context = contextOf();
  const container = controller.draft.theme.layout?.containers.find(
    (entry) => entry.target === context.target
      && entry.screenId === context.screenId
      && entry.format === context.format
      && entry.nodeId === parentId,
  );
  return container ? container.order : [];
}

function placementOf(nodeId: string) {
  return getLayoutPlacement(controller.draft.theme, contextOf(), nodeId);
}

function pointer(target: HTMLElement, type: string, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 7 });
  act(() => {
    target.dispatchEvent(event);
  });
}

interface PreviewShape {
  settings: { value: string };
  input: HTMLInputElement;
}

interface PreviewBuildOptions {
  toolbar?: boolean;
  frameRect?: DOMRect;
  rooted?: boolean;
  gridDirection?: 'row' | 'column';
}

function buildPreview(horizontal = false, options: PreviewBuildOptions = {}): PreviewShape {
  const iframe = host.querySelector<HTMLIFrameElement>('iframe')!;
  const frameRect = options.frameRect ?? clientRect(0, 0, 1280, 720);
  iframe.getBoundingClientRect = () => frameRect;
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
  const grid = make('card-grid', 0, 0, 400, horizontal ? 200 : 400);
  if (options.gridDirection) {
    grid.style.display = 'flex';
    grid.style.flexDirection = options.gridDirection;
  }
  const first = horizontal ? make('server-card', 0, 0, 200, 100) : make('server-card', 0, 0, 400, 100);
  const second = horizontal ? make('server-card', 200, 0, 200, 100) : make('server-card', 0, 100, 400, 100);
  const settings = { value: 'keep' };
  const input = doc.createElement('input');
  input.dataset.designId = 'settings-continue';
  input.value = 'keep';
  input.getBoundingClientRect = () => (horizontal ? clientRect(0, 100, 400, 50) : clientRect(0, 200, 400, 50));
  input.addEventListener('input', () => {
    settings.value = input.value;
  });
  grid.append(first, second, input);
  const mountParent = (() => {
    if (!options.rooted) return body;
    const rootEl = doc.createElement('div');
    rootEl.setAttribute('data-design-root', '');
    rootEl.getBoundingClientRect = () => clientRect(0, 0, 1280, 720);
    body.appendChild(rootEl);
    return rootEl;
  })();
  mountParent.appendChild(grid);
  if (options.toolbar) {
    const toolbar = make('toolbar', 500, 0, 300, 100);
    toolbar.appendChild(make('toolbar-search', 500, 0, 120, 40));
    mountParent.appendChild(toolbar);
  }
  act(() => {
    iframe.dispatchEvent(new Event('load'));
  });
  return { settings, input };
}

function overlay(): HTMLElement {
  const element = host.querySelector<HTMLElement>('[data-testid="selection-overlay"]');
  if (!element) throw new Error('selection overlay is missing');
  return element;
}

function shiftPointer(target: HTMLElement, type: string, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, shiftKey: true });
  Object.defineProperty(event, 'pointerId', { value: 7 });
  act(() => {
    target.dispatchEvent(event);
  });
}

function selectBothCards(): void {
  pointer(overlay(), 'pointerdown', 200, 50);
  pointer(overlay(), 'pointerup', 200, 50);
  shiftPointer(overlay(), 'pointerdown', 200, 150);
  expect(host.querySelectorAll('[data-testid="selection-box"]')).toHaveLength(2);
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

describe('layout workspace', () => {
  it('selects a node by click and shows its selection box with the layout identity', () => {
    buildPreview();

    pointer(overlay(), 'pointerdown', 200, 50);
    pointer(overlay(), 'pointerup', 200, 50);

    const box = host.querySelector<HTMLElement>('[data-testid="selection-box"]');
    expect(box).not.toBeNull();
    expect(box!.dataset.layoutNode).toBe('server-card');
    expect(host.querySelector('.editor-theme-inspector h2')!.textContent).toBe('Карточка сервера');
  });

  it('clears the selection when clicking an empty canvas area', () => {
    buildPreview();
    pointer(overlay(), 'pointerdown', 200, 150);
    pointer(overlay(), 'pointerup', 200, 150);
    expect(host.querySelector('[data-testid="selection-box"]')).not.toBeNull();

    pointer(overlay(), 'pointerdown', 1100, 650);
    pointer(overlay(), 'pointerup', 1100, 650);

    expect(host.querySelector('[data-testid="selection-box"]')).toBeNull();
  });

  it('does not start a drag or commit anything below the 4px threshold', () => {
    buildPreview();
    const update = vi.spyOn(controller, 'update');

    pointer(overlay(), 'pointerdown', 200, 150);
    pointer(overlay(), 'pointermove', 202, 152);
    pointer(overlay(), 'pointerup', 202, 152);

    expect(update).not.toHaveBeenCalled();
    expect(controller.draft.theme.layout?.containers).toHaveLength(0);
    expect(controller.draft.theme.layout?.placements).toHaveLength(0);
    expect(host.querySelector('[data-testid="insertion-line"]')).toBeNull();
    expect(host.querySelector('[data-testid="free-mode"]')).toBeNull();
  });

  it('reorders flow children with an insertion line and a single controller commit', () => {
    buildPreview();
    const context = contextOf();
    moveNodeTransaction(controller, { context, nodeId: 'server-card', parentId: 'card-grid', index: 0 });
    moveNodeTransaction(controller, { context, nodeId: 'server-card-2', parentId: 'card-grid', index: 1 });
    const update = vi.spyOn(controller, 'update');

    pointer(overlay(), 'pointerdown', 200, 150);
    pointer(overlay(), 'pointermove', 200, 40);
    expect(host.querySelector('[data-testid="insertion-line"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="free-mode"]')).toBeNull();
    pointer(overlay(), 'pointerup', 200, 40);

    expect(update).toHaveBeenCalledTimes(1);
    expect(orderOf('card-grid')).toEqual(['server-card-2', 'server-card']);

    controller.undo();
    expect(orderOf('card-grid')).toEqual(['server-card', 'server-card-2']);
    controller.redo();
    expect(orderOf('card-grid')).toEqual(['server-card-2', 'server-card']);
  });

  it('drops a flow node into free mode with an explicit indicator and preserves the rect', () => {
    buildPreview();

    pointer(overlay(), 'pointerdown', 200, 150);
    pointer(overlay(), 'pointermove', 500, 250);
    expect(host.querySelector('[data-testid="free-mode"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="insertion-line"]')).toBeNull();
    pointer(overlay(), 'pointerup', 500, 250);

    const placement = placementOf('server-card-2');
    expect(placement).toMatchObject({
      mode: 'absolute',
      anchor: 'top-left',
      x: 7500,
      y: 5000,
      width: 10000,
      height: 2500,
    });
    controller.undo();
    expect(placementOf('server-card-2')).toBeUndefined();
  });

  it('returns an absolute node to flow only through an explicit drop into another container in one undo step', () => {
    buildPreview(false, { toolbar: true });
    const context = contextOf();
    moveNodeTransaction(controller, { context, nodeId: 'server-card', parentId: 'card-grid', index: 0 });
    moveNodeTransaction(controller, { context, nodeId: 'server-card-2', parentId: 'card-grid', index: 1 });
    controller.update((draft) => {
      draft.theme.layout = {
        containers: [
          ...(draft.theme.layout?.containers ?? []),
          { id: 'flow-toolbar', ...context, nodeId: 'toolbar', order: ['toolbar-search'], direction: 'column' },
        ],
        placements: draft.theme.layout?.placements ?? [],
      };
      return draft;
    });
    placeNodeTransaction(controller, absolutePlacementFromRect(
      { x: 0, y: 100, width: 400, height: 100 },
      { x: 0, y: 0, width: 400, height: 400 },
      context,
      'server-card-2',
      'server-card',
    ));
    expect(placementOf('server-card-2')?.mode).toBe('absolute');

    pointer(overlay(), 'pointerdown', 200, 150);
    pointer(overlay(), 'pointermove', 600, 50);
    expect(host.querySelector('[data-testid="insertion-line"]')).not.toBeNull();
    pointer(overlay(), 'pointerup', 600, 50);

    expect(orderOf('toolbar')).toEqual(['toolbar-search', 'server-card-2']);
    expect(orderOf('card-grid')).toEqual(['server-card']);
    expect(placementOf('server-card-2')?.mode).toBe('flow');

    controller.undo();
    expect(orderOf('card-grid')).toEqual(['server-card', 'server-card-2']);
    expect(orderOf('toolbar')).toEqual(['toolbar-search']);
    expect(placementOf('server-card-2')?.mode).toBe('absolute');
  });

  it('keeps an absolute node absolute while dragging inside its own container', () => {
    buildPreview();
    const context = contextOf();
    moveNodeTransaction(controller, { context, nodeId: 'server-card', parentId: 'card-grid', index: 0 });
    moveNodeTransaction(controller, { context, nodeId: 'server-card-2', parentId: 'card-grid', index: 1 });
    placeNodeTransaction(controller, absolutePlacementFromRect(
      { x: 0, y: 100, width: 400, height: 100 },
      { x: 0, y: 0, width: 400, height: 400 },
      context,
      'server-card-2',
      'server-card',
    ));
    expect(placementOf('server-card-2')?.mode).toBe('absolute');
    const update = vi.spyOn(controller, 'update');

    pointer(overlay(), 'pointerdown', 200, 150);
    pointer(overlay(), 'pointermove', 260, 190);
    expect(host.querySelector('[data-testid="insertion-line"]')).toBeNull();
    expect(host.querySelector('[data-testid="free-mode"]')).not.toBeNull();
    pointer(overlay(), 'pointerup', 260, 190);

    expect(update).toHaveBeenCalledTimes(1);
    expect(placementOf('server-card-2')).toMatchObject({ mode: 'absolute', x: 1500, y: 3500 });
    controller.undo();
    expect(placementOf('server-card-2')).toMatchObject({ mode: 'absolute', x: 0, y: 2500 });
  });

  it('keeps canvas rects and hit targets in artboard coordinates at zoom and page offsets', () => {
    buildPreview(false, { frameRect: clientRect(320, 180, 1280, 720), rooted: true });
    act(() => {
      host.querySelector<HTMLElement>('[data-action="zoom-in"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const zoom = 1.25;
    const at = (x: number, y: number): { x: number; y: number } => ({ x: 320 + x * zoom, y: 180 + y * zoom });
    const down = at(200, 50);

    pointer(overlay(), 'pointerdown', down.x, down.y);
    pointer(overlay(), 'pointerup', down.x, down.y);

    const box = host.querySelector<HTMLElement>('[data-testid="selection-box"]');
    expect(box).not.toBeNull();
    expect(box!.dataset.layoutNode).toBe('server-card');
    expect(box!.style.left).toBe('0px');
    expect(box!.style.top).toBe('0px');
    expect(box!.style.width).toBe('400px');

    const move = at(500, 250);
    pointer(overlay(), 'pointerdown', down.x, down.y);
    pointer(overlay(), 'pointermove', move.x, move.y);
    expect(host.querySelector('[data-testid="free-mode"]')).not.toBeNull();
    pointer(overlay(), 'pointerup', move.x, move.y);

    expect(placementOf('server-card')).toMatchObject({ mode: 'absolute', x: 7500, y: 5000 });
    controller.undo();
    expect(controller.draft.theme.layout?.placements ?? []).toHaveLength(0);
  });

  it('captures the pointer during a drag without changing real control settings', () => {
    const { settings, input } = buildPreview();
    const surface = overlay();
    const capture = vi.fn();
    const release = vi.fn();
    surface.setPointerCapture = capture;
    surface.hasPointerCapture = () => true;
    surface.releasePointerCapture = release;

    pointer(surface, 'pointerdown', 200, 220);
    pointer(surface, 'pointermove', 200, 100);
    pointer(surface, 'pointerup', 200, 100);

    expect(capture).toHaveBeenCalledWith(7);
    expect(release).toHaveBeenCalledWith(7);
    expect(settings.value).toBe('keep');
    expect(input.value).toBe('keep');
  });

  it('keeps focus and typing in editor text fields while dragging on the canvas', () => {
    buildPreview();
    const field = host.querySelector<HTMLInputElement>('[data-testid="release-version"]')!;
    act(() => {
      field.focus();
    });
    expect(document.activeElement).toBe(field);

    pointer(overlay(), 'pointerdown', 200, 150);
    pointer(overlay(), 'pointermove', 200, 40);
    pointer(overlay(), 'pointerup', 200, 40);

    expect(document.activeElement).toBe(field);
    act(() => {
      field.value = '0.30.0';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(field.value).toBe('0.30.0');
  });

  it('creates a flow placement for a node without an existing placement when switching modes', () => {
    const context = contextOf();
    const placement = createPlacement(context, 'server-card', 'server-card');
    moveNodeTransaction(controller, { context, nodeId: 'server-card', parentId: 'card-grid', index: 0, placement });
    expect(placementOf('server-card')?.mode).toBe('flow');
    expect(orderOf('card-grid')).toEqual(['server-card']);
    controller.undo();
    expect(placementOf('server-card')).toBeUndefined();
    expect(orderOf('card-grid')).toEqual([]);
  });

  it('records the full container order on the first drag into an unrecorded container', () => {
    buildPreview();
    const update = vi.spyOn(controller, 'update');

    pointer(overlay(), 'pointerdown', 200, 150);
    pointer(overlay(), 'pointermove', 200, 40);
    pointer(overlay(), 'pointerup', 200, 40);

    expect(update).toHaveBeenCalledTimes(1);
    expect(orderOf('card-grid')).toEqual(['server-card-2', 'server-card', 'settings-continue']);
    controller.undo();
    expect(controller.draft.theme.layout?.containers).toHaveLength(0);
    expect(controller.draft.theme.layout?.placements).toHaveLength(0);
  });

  it('uses the recorded row direction of the current parent for the insertion index and guide', () => {
    buildPreview(true);
    const context = contextOf();
    controller.update((draft) => {
      draft.theme.layout = {
        containers: [{ id: 'flow-card-grid', ...context, nodeId: 'card-grid', order: ['server-card', 'server-card-2'], direction: 'row' }],
        placements: [],
      };
      return draft;
    });

    pointer(overlay(), 'pointerdown', 300, 50);
    pointer(overlay(), 'pointermove', 50, 150);
    const line = host.querySelector<HTMLElement>('[data-testid="insertion-line"]');
    expect(line).not.toBeNull();
    expect(line!.style.width).toBe('2px');
    expect(line!.style.height).toBe('200px');
    expect(line!.style.left).toBe('0px');
    pointer(overlay(), 'pointerup', 50, 150);

    expect(orderOf('card-grid')).toEqual(['server-card-2', 'server-card']);
  });

  it('uses the computed row direction for insertion when no container record exists', () => {
    // The preview container renders as a real CSS row (display flex, row direction) but no
    // container record pins a direction: the computed direction, not the column default,
    // must drive the insertion index and the guide orientation.
    buildPreview(false, { gridDirection: 'row' });

    pointer(overlay(), 'pointerdown', 200, 150);
    pointer(overlay(), 'pointermove', 40, 150);
    const line = host.querySelector<HTMLElement>('[data-testid="insertion-line"]')!;
    expect(line.style.width).toBe('2px');
    expect(line.style.height).toBe('400px');
    pointer(overlay(), 'pointerup', 40, 150);

    expect(orderOf('card-grid')[0]).toBe('server-card-2');
  });

  it('resizes an absolute node from a corner handle with one undo step', () => {
    buildPreview();
    const context = contextOf();
    placeNodeTransaction(controller, absolutePlacementFromRect(
      { x: 0, y: 100, width: 400, height: 100 },
      { x: 0, y: 0, width: 400, height: 400 },
      context,
      'server-card-2',
      'server-card',
    ));

    pointer(overlay(), 'pointerdown', 200, 150);
    pointer(overlay(), 'pointerup', 200, 150);
    expect(host.querySelectorAll('[data-testid="resize-handle"]')).toHaveLength(8);

    const update = vi.spyOn(controller, 'update');
    const handle = host.querySelector<HTMLElement>('[data-testid="resize-handle"][data-handle="se"]')!;
    pointer(handle, 'pointerdown', 400, 200);
    pointer(overlay(), 'pointermove', 370, 190);
    expect(host.querySelector<HTMLElement>('[data-testid="selection-box"]')!.style.width).toBe('370px');
    pointer(overlay(), 'pointerup', 370, 190);

    expect(update).toHaveBeenCalledTimes(1);
    expect(placementOf('server-card-2')).toMatchObject({ x: 0, y: 2500, width: 9250, height: 2250 });
    expect(host.querySelector<HTMLElement>('[data-testid="selection-box"]')!.style.width).toBe('370px');
    controller.undo();
    expect(placementOf('server-card-2')).toMatchObject({ width: 10000, height: 2500 });
    controller.redo();
    expect(placementOf('server-card-2')).toMatchObject({ width: 9250, height: 2250 });
  });

  it('honors the placement min size constraints while resizing', () => {
    buildPreview();
    const context = contextOf();
    placeNodeTransaction(controller, {
      ...absolutePlacementFromRect(
        { x: 0, y: 100, width: 400, height: 100 },
        { x: 0, y: 0, width: 400, height: 400 },
        context,
        'server-card-2',
        'server-card',
      ),
      minWidth: 7500,
      minHeight: 2000,
    });

    pointer(overlay(), 'pointerdown', 200, 150);
    pointer(overlay(), 'pointerup', 200, 150);
    const handle = host.querySelector<HTMLElement>('[data-testid="resize-handle"][data-handle="se"]')!;
    pointer(handle, 'pointerdown', 400, 200);
    pointer(overlay(), 'pointermove', 100, 150);
    pointer(overlay(), 'pointerup', 100, 150);

    expect(placementOf('server-card-2')).toMatchObject({ width: 7500, height: 2000 });
  });

  it('clamps a typed size to the same min and max the resize handle uses', () => {
    buildPreview();
    const context = contextOf();
    placeNodeTransaction(controller, {
      ...absolutePlacementFromRect(
        { x: 0, y: 100, width: 400, height: 100 },
        { x: 0, y: 0, width: 400, height: 400 },
        context,
        'server-card-2',
        'server-card',
      ),
      minWidth: 7500,
      maxHeight: 5000,
    });
    pointer(overlay(), 'pointerdown', 200, 150);
    pointer(overlay(), 'pointerup', 200, 150);

    const width = host.querySelector<HTMLInputElement>('[data-testid="layout-width"]')!;
    act(() => {
      width.value = '100';
      width.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // 7500 units of a 400px parent is 300px, the same floor the handle enforces.
    expect(placementOf('server-card-2')?.width).toBe(7500);

    const height = host.querySelector<HTMLInputElement>('[data-testid="layout-height"]')!;
    act(() => {
      height.value = '300';
      height.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // maxHeight 5000 is 200px of the 400px parent.
    expect(placementOf('server-card-2')?.height).toBe(5000);
  });

  it('syncs the numeric inspector with handle resizes and commits typed geometry', () => {
    buildPreview();
    const context = contextOf();
    placeNodeTransaction(controller, absolutePlacementFromRect(
      { x: 0, y: 100, width: 400, height: 100 },
      { x: 0, y: 0, width: 400, height: 400 },
      context,
      'server-card-2',
      'server-card',
    ));

    pointer(overlay(), 'pointerdown', 200, 150);
    pointer(overlay(), 'pointerup', 200, 150);
    const width = host.querySelector<HTMLInputElement>('[data-testid="layout-width"]')!;
    expect(width.value).toBe('400');

    const handle = host.querySelector<HTMLElement>('[data-testid="resize-handle"][data-handle="se"]')!;
    pointer(handle, 'pointerdown', 400, 200);
    pointer(overlay(), 'pointermove', 370, 190);
    pointer(overlay(), 'pointerup', 370, 190);
    expect(width.value).toBe('370');

    const x = host.querySelector<HTMLInputElement>('[data-testid="layout-x"]')!;
    act(() => {
      x.value = '20';
      x.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(placementOf('server-card-2')).toMatchObject({ x: 500, width: 9250 });
  });

  it('edits container padding and node margin from the inspector with one undo each', () => {
    buildPreview();
    pointer(overlay(), 'pointerdown', 350, 350);
    pointer(overlay(), 'pointerup', 350, 350);
    const padding = host.querySelector<HTMLInputElement>('[data-testid="layout-padding"]')!;
    act(() => {
      padding.value = '16';
      padding.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const context = contextOf();
    const container = controller.draft.theme.layout?.containers.find(
      (entry) => entry.target === context.target
        && entry.screenId === context.screenId
        && entry.format === context.format
        && entry.nodeId === 'card-grid',
    );
    expect(container).toMatchObject({ padding: '16px', order: ['server-card', 'server-card-2', 'settings-continue'] });
    controller.undo();
    expect(controller.draft.theme.layout?.containers ?? []).toHaveLength(0);
    controller.redo();

    pointer(overlay(), 'pointerdown', 200, 50);
    pointer(overlay(), 'pointerup', 200, 50);
    const margin = host.querySelector<HTMLInputElement>('[data-testid="layout-margin"]')!;
    act(() => {
      margin.value = '12';
      margin.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(placementOf('server-card')).toMatchObject({ mode: 'flow', margin: '12px' });
    controller.undo();
    expect(placementOf('server-card')).toBeUndefined();
  });

  it('parses mixed padding and margin field values', () => {
    expect(parseSpacingField('16')).toBe('16px');
    expect(parseSpacingField('16.5')).toBe('16.5px');
    expect(parseSpacingField('')).toBe('');
    expect(parseSpacingField('mixed')).toBe('mixed');
    expect(parseSpacingField('разные')).toBe('mixed');
    expect(parseSpacingField('abc')).toBeNull();
    expect(formatSizeField('mixed')).toBe('разные');
    expect(formatSizeField(24)).toBe('24');
  });

  it('rejects spacing above the document size limit instead of failing validation later', () => {
    // The design document accepts sizes up to 512px; a bigger value must never reach the draft,
    // where saving would throw a validation error without naming the field.
    expect(parseSpacingField('512')).toBe('512px');
    expect(parseSpacingField('512.5')).toBeNull();
    expect(parseSpacingField('513')).toBeNull();
    expect(parseSpacingField('999')).toBeNull();
    expect(parseSpacingField('1200')).toBeNull();
  });

  it('lets a plain click focus and type into a preview text control without selecting it', () => {
    const { input, settings } = buildPreview();
    const doc = input.ownerDocument;
    doc.elementFromPoint = () => input;
    try {
      pointer(overlay(), 'pointerdown', 200, 225);
      pointer(overlay(), 'pointerup', 200, 225);

      // The control inside the preview iframe holds the focus; the canvas keeps no selection.
      expect(doc.activeElement).toBe(input);
      expect(host.querySelector('[data-testid="selection-box"]')).toBeNull();

      // Typing reaches the control: it receives key events and edits its value.
      const typed: string[] = [];
      input.addEventListener('keydown', (event) => typed.push(event.key));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
      expect(typed).toEqual(['x']);
      input.value = 'xy';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(settings.value).toBe('xy');
    } finally {
      delete (doc as Partial<Document>).elementFromPoint;
    }
  });

  it('saves the measured size when a flow node switches to absolute', () => {
    buildPreview();
    const context = contextOf();
    placeNodeTransaction(controller, createPlacement(context, 'server-card', 'Карточка сервера'));
    pointer(overlay(), 'pointerdown', 200, 50);
    pointer(overlay(), 'pointerup', 200, 50);

    select('layout-mode', 'absolute');

    // The flow node had width and height 'auto'; the conversion freezes the measured box so
    // the absolute node cannot shrink around its content.
    expect(placementOf('server-card')).toMatchObject({
      mode: 'absolute',
      x: 0,
      y: 0,
      width: 10000,
      height: 2500,
    });
  });

  it('converts a flow node with margin without double-counting the offset', () => {
    buildPreview();
    const context = contextOf();
    placeNodeTransaction(controller, createPlacement(context, 'server-card-2', 'Карточка 2', { margin: '12px' }));
    pointer(overlay(), 'pointerdown', 200, 150);
    pointer(overlay(), 'pointerup', 200, 150);

    select('layout-mode', 'absolute');

    // server-card-2 renders at y 100 of the 400px parent, 12px below its margin-free spot:
    // the measured border box already includes the margin offset and the preserved margin
    // re-adds it at render, so the stored coordinates must exclude it (88px -> 2200 units).
    expect(placementOf('server-card-2')).toMatchObject({
      mode: 'absolute',
      x: 0,
      y: 2200,
      width: 10000,
      height: 2500,
      margin: '12px',
    });
  });

  it('captures the parent size basis when converting a flow node to absolute', () => {
    buildPreview();
    const context = contextOf();
    placeNodeTransaction(controller, createPlacement(context, 'server-card-2', 'Карточка 2'));
    pointer(overlay(), 'pointerdown', 200, 150);
    pointer(overlay(), 'pointerup', 200, 150);

    select('layout-mode', 'absolute');

    // The percent sizes must keep resolving against the 400x400 parent captured at conversion
    // time, so a content-sized parent cannot collapse under the removed child later.
    expect(placementOf('server-card-2')).toMatchObject({
      mode: 'absolute',
      width: 10000,
      height: 2500,
      basisWidth: 400,
      basisHeight: 400,
    });
  });

  it('advances the size basis when typed geometry exceeds the captured basis after the parent grew', () => {
    buildPreview();
    const context = contextOf();
    placeNodeTransaction(controller, createPlacement(context, 'server-card-2', 'Карточка 2', {
      mode: 'absolute', x: 0, y: 100, width: 2500, height: 2500, basisWidth: 200, basisHeight: 200,
    }));
    pointer(overlay(), 'pointerdown', 200, 150);
    pointer(overlay(), 'pointerup', 200, 150);

    // The parent outgrew the 200px capture and now measures 400px; entering 300px must stay
    // reachable instead of clamping to the stale basis.
    const width = host.querySelector<HTMLInputElement>('[data-testid="layout-width"]')!;
    expect(width.value).toBe('50');
    act(() => {
      width.value = '300';
      width.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(placementOf('server-card-2')).toMatchObject({
      width: 7500,
      basisWidth: 400,
      height: 2500,
      basisHeight: 200,
    });
  });

  it('advances the size basis when a drag handle grows the node beyond the captured basis', () => {
    buildPreview();
    const context = contextOf();
    placeNodeTransaction(controller, createPlacement(context, 'server-card-2', 'Карточка 2', {
      mode: 'absolute', x: 0, y: 100, width: 2500, height: 2500, basisWidth: 200, basisHeight: 200,
    }));
    pointer(overlay(), 'pointerdown', 200, 150);
    pointer(overlay(), 'pointerup', 200, 150);

    // Drag the se handle 250px to the right: 300px exceeds the 200px basis while the parent
    // already measures 400px, so the basis moves forward and the size lands at 300px.
    const handle = host.querySelector<HTMLElement>('[data-testid="resize-handle"][data-handle="se"]')!;
    pointer(handle, 'pointerdown', 50, 54);
    pointer(overlay(), 'pointermove', 300, 54);
    pointer(overlay(), 'pointerup', 300, 54);

    expect(placementOf('server-card-2')).toMatchObject({
      width: 7500,
      basisWidth: 400,
      height: 2500,
      basisHeight: 200,
    });
  });

  it('maps flow alignment buttons to the container axes in a row container', () => {
    buildPreview();
    const context = contextOf();
    moveNodeTransaction(controller, { context, nodeId: 'server-card', parentId: 'card-grid', index: 0 });
    moveNodeTransaction(controller, { context, nodeId: 'server-card-2', parentId: 'card-grid', index: 1 });
    updateContainerTransaction(controller, {
      context,
      nodeId: 'card-grid',
      seed: ['server-card', 'server-card-2'],
      patch: { direction: 'row' },
    });
    selectBothCards();

    const container = () => controller.draft.theme.layout!.containers.find((entry) => entry.nodeId === 'card-grid')!;
    // Horizontal alignment on a row container is a main-axis operation (justify-content).
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="align-left"]')!.click());
    expect(container()).toMatchObject({ direction: 'row', distribution: 'start' });
    expect(container().alignment).toBeUndefined();

    // Vertical alignment on a row container is a cross-axis operation (align-items).
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="align-top"]')!.click());
    expect(container()).toMatchObject({ direction: 'row', distribution: 'start', alignment: 'start' });

    act(() => host.querySelector<HTMLButtonElement>('[data-testid="distribute-x"]')!.click());
    expect(container().distribution).toBe('space-between');

    // Distribution across the cross axis is not a flex operation and stays disabled.
    expect(host.querySelector<HTMLButtonElement>('[data-testid="distribute-y"]')!.disabled).toBe(true);
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="distribute-y"]')!.click());
    expect(container().distribution).toBe('space-between');
  });

  it('maps flow alignment buttons to the container axes in a column container', () => {
    buildPreview();
    const context = contextOf();
    moveNodeTransaction(controller, { context, nodeId: 'server-card', parentId: 'card-grid', index: 0 });
    moveNodeTransaction(controller, { context, nodeId: 'server-card-2', parentId: 'card-grid', index: 1 });
    updateContainerTransaction(controller, {
      context,
      nodeId: 'card-grid',
      seed: ['server-card', 'server-card-2'],
      patch: { direction: 'column' },
    });
    selectBothCards();

    const container = () => controller.draft.theme.layout!.containers.find((entry) => entry.nodeId === 'card-grid')!;
    // Horizontal alignment on a column container is a cross-axis operation (align-items).
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="align-left"]')!.click());
    expect(container()).toMatchObject({ direction: 'column', alignment: 'start' });
    expect(container().distribution).toBeUndefined();

    // Vertical alignment on a column container is a main-axis operation (justify-content).
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="align-middle"]')!.click());
    expect(container()).toMatchObject({ direction: 'column', alignment: 'start', distribution: 'center' });

    act(() => host.querySelector<HTMLButtonElement>('[data-testid="distribute-y"]')!.click());
    expect(container().distribution).toBe('space-between');

    expect(host.querySelector<HTMLButtonElement>('[data-testid="distribute-x"]')!.disabled).toBe(true);
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="distribute-x"]')!.click());
    expect(container().distribution).toBe('space-between');
  });

  it('reads the computed column direction when the container record has no direction', () => {
    // The preview container renders as a CSS column but no container record exists yet: the
    // computed direction, not the flex default, must decide which axis a button edits.
    buildPreview(false, { gridDirection: 'column' });
    const context = contextOf();
    moveNodeTransaction(controller, { context, nodeId: 'server-card', parentId: 'card-grid', index: 0 });
    moveNodeTransaction(controller, { context, nodeId: 'server-card-2', parentId: 'card-grid', index: 1 });
    selectBothCards();

    const container = () => controller.draft.theme.layout!.containers.find((entry) => entry.nodeId === 'card-grid')!;
    // Horizontal alignment against a computed column is a cross-axis operation (align-items).
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="align-left"]')!.click());
    expect(container().alignment).toBe('start');
    expect(container().distribution).toBeUndefined();

    // Distribution across the computed cross axis stays disabled.
    expect(host.querySelector<HTMLButtonElement>('[data-testid="distribute-x"]')!.disabled).toBe(true);
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="distribute-y"]')!.click());
    expect(container().distribution).toBe('space-between');
  });
});

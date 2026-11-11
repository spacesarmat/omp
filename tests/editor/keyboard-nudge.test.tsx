import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../editor/src/App';
import * as protocol from '../../editor/src/preview/protocol';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDraftController, type DraftController } from '../../editor/src/drafts';
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

function buildPreview(): void {
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
  grid.append(first, second);
  body.appendChild(grid);
  act(() => {
    iframe.dispatchEvent(new Event('load'));
  });
}

function overlay(): HTMLElement {
  return host.querySelector<HTMLElement>('[data-testid="selection-overlay"]')!;
}

function pointer(target: HTMLElement, type: string, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 7 });
  act(() => {
    target.dispatchEvent(event);
  });
}

function key(target: EventTarget, value: string, options: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options }));
  });
}

function selectCard(): void {
  pointer(overlay(), 'pointerdown', 200, 50);
  pointer(overlay(), 'pointerup', 200, 50);
}

function dragCardToAbsolute(): void {
  selectCard();
  pointer(overlay(), 'pointerdown', 200, 50);
  pointer(overlay(), 'pointermove', 410, 110);
  pointer(overlay(), 'pointerup', 410, 110);
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

describe('arrow key nudge', () => {
  it('moves the selected absolute node by 1 artboard px per Arrow press and 10 px with Shift', () => {
    buildPreview();
    dragCardToAbsolute();
    const dragged = placementOf('server-card');
    expect(dragged?.mode).toBe('absolute');
    expect(dragged?.x).toBe(5250);
    expect(dragged?.y).toBe(1500);

    key(window, 'ArrowRight');
    expect(placementOf('server-card')?.x).toBe(5275);
    key(window, 'ArrowDown');
    expect(placementOf('server-card')?.y).toBe(1525);

    key(window, 'ArrowRight', { shiftKey: true });
    expect(placementOf('server-card')?.x).toBe(5525);
    key(window, 'ArrowUp', { shiftKey: true });
    expect(placementOf('server-card')?.y).toBe(1275);

    controller.undo();
    expect(placementOf('server-card')?.y).toBe(1525);
    controller.undo();
    expect(placementOf('server-card')?.x).toBe(5275);
    controller.undo();
    expect(placementOf('server-card')?.y).toBe(1500);
    controller.undo();
    expect(placementOf('server-card')?.x).toBe(5250);
    expect(placementOf('server-card')?.y).toBe(1500);
  });

  it('ignores Arrow presses without a single absolute selection', () => {
    buildPreview();
    selectCard();
    const update = vi.spyOn(controller, 'update');

    key(window, 'ArrowRight');
    expect(update).not.toHaveBeenCalled();
    expect(placementOf('server-card')).toBeUndefined();
  });

  it('ignores Arrow presses while the node is locked', () => {
    buildPreview();
    dragCardToAbsolute();
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="layout-lock-server-card"]')!.click());
    const update = vi.spyOn(controller, 'update');
    const before = placementOf('server-card')?.x;

    key(window, 'ArrowRight');
    expect(update).not.toHaveBeenCalled();
    expect(placementOf('server-card')?.x).toBe(before);
  });

  it('never intercepts typing in form fields', () => {
    buildPreview();
    dragCardToAbsolute();
    const input = document.createElement('input');
    document.body.appendChild(input);
    const update = vi.spyOn(controller, 'update');
    const before = placementOf('server-card')?.x;

    key(input, 'ArrowRight');
    expect(update).not.toHaveBeenCalled();
    expect(placementOf('server-card')?.x).toBe(before);
    input.remove();
  });

  it('ignores Arrow presses with Ctrl or Alt held so browser and canvas shortcuts keep working', () => {
    buildPreview();
    dragCardToAbsolute();
    const update = vi.spyOn(controller, 'update');
    const before = placementOf('server-card')?.x;

    key(window, 'ArrowRight', { ctrlKey: true });
    key(window, 'ArrowRight', { altKey: true });
    expect(update).not.toHaveBeenCalled();
    expect(placementOf('server-card')?.x).toBe(before);
  });

  it('keeps nudging relative to the layout parent after a nudge', () => {
    buildPreview();
    dragCardToAbsolute();
    key(window, 'ArrowLeft');
    expect(placementOf('server-card')?.x).toBe(5225);
    key(window, 'ArrowLeft');
    expect(placementOf('server-card')?.x).toBe(5200);
  });
});

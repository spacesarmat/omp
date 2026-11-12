import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../editor/src/App';
import * as protocol from '../../editor/src/preview/protocol';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDraftController, type DraftController } from '../../editor/src/drafts';

const BASE = '0000000000000000000000000000000000000000';
let host: HTMLDivElement;
let controller: DraftController;

function clientRect(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) } as DOMRect;
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
  grid.append(first);
  const second = make('server-card', 400, 250, 400, 100);
  body.append(grid, second);
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

describe('canvas guide settings toggles', () => {
  it('toggles rulers and the grid from the canvas toolbar', () => {
    buildPreview();

    expect(host.querySelector('[data-testid="rulers"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="grid-layer"]')).toBeNull();

    const rulersToggle = host.querySelector<HTMLButtonElement>('[data-testid="toggle-rulers"]')!;
    expect(rulersToggle.getAttribute('aria-pressed')).toBe('true');
    act(() => rulersToggle.click());
    expect(host.querySelector('[data-testid="rulers"]')).toBeNull();
    expect(rulersToggle.getAttribute('aria-pressed')).toBe('false');
    act(() => rulersToggle.click());
    expect(host.querySelector('[data-testid="rulers"]')).not.toBeNull();

    const gridToggle = host.querySelector<HTMLButtonElement>('[data-testid="toggle-grid"]')!;
    expect(gridToggle.getAttribute('aria-pressed')).toBe('false');
    act(() => gridToggle.click());
    expect(host.querySelector('[data-testid="grid-layer"]')).not.toBeNull();
    expect(gridToggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows snap guide lines during a drag only while snapping is enabled', () => {
    buildPreview();

    pointer(overlay(), 'pointerdown', 200, 50);
    pointer(overlay(), 'pointermove', 600, 300);
    expect(host.querySelectorAll('[data-testid="guide-line"]')).not.toHaveLength(0);
    pointer(overlay(), 'pointerup', 600, 300);

    const snapToggle = host.querySelector<HTMLButtonElement>('[data-testid="toggle-snap"]')!;
    expect(snapToggle.getAttribute('aria-pressed')).toBe('true');
    act(() => snapToggle.click());
    expect(snapToggle.getAttribute('aria-pressed')).toBe('false');

    pointer(overlay(), 'pointerdown', 200, 50);
    pointer(overlay(), 'pointermove', 600, 300);
    expect(host.querySelectorAll('[data-testid="guide-line"]')).toHaveLength(0);
    pointer(overlay(), 'pointerup', 600, 300);
  });
});

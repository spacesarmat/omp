import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDefaultFlow } from '../../design/defaults';
import { createDraftController, type DraftController } from '../../editor/src/drafts';
import { LogicEditor } from '../../editor/src/components/LogicEditor';
import { FlowMap } from '../../editor/src/components/FlowMap';
import { SimulationPanel } from '../../editor/src/components/SimulationPanel';
import { simulatePreviewClick } from '../../editor/src/simulation';
import type { EditorClient } from '../../editor/src/client';

const BASE = '0000000000000000000000000000000000000000';
let host: HTMLDivElement;
let controller: DraftController;

function createController(): DraftController {
  const client: EditorClient = {
    state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
    getDraft: async () => null,
    putDraft: async (draft) => draft,
  };
  return createDraftController({ draft: createDefaultDraft('draft-1', BASE), client, autosaveMs: 20 });
}

function mount(element: h.JSX.Element): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(element, host));
}

function change(selector: string, value: string): void {
  const input = host.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function click(selector: string): void {
  act(() => {
    host.querySelector<HTMLButtonElement>(selector)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

afterEach(() => {
  if (host) {
    act(() => render(null, host));
    host.remove();
  }
  controller?.dispose();
});

describe('LogicEditor', () => {
  it('edits a conditional navigation rule with one undo step', () => {
    controller = createController();
    const original = controller.draft.flow;
    mount(h(LogicEditor, { controller, screenId: 'settings', elementId: 'settings-continue' }));
    change('[data-testid="rule"]', 'settings-continue-disconnected');
    change('[data-testid="condition"]', 'server-false');
    change('[data-testid="action"]', 'navigate');
    change('[data-testid="destination"]', 'connect');
    click('[data-action="save-rule"]');
    const rule = controller.draft.flow.rules.find((entry) => entry.id === 'settings-continue-disconnected');
    expect(rule).toMatchObject({ action: { type: 'navigate', screenId: 'connect' } });
    expect(controller.draft.flow.rules.filter((entry) => entry.elementId === 'settings-continue')).toHaveLength(2);
    expect(controller.undo()).toBe(true);
    expect(controller.draft.flow).toEqual(original);
  });

  it('adds a rule and warns when an unconditional rule shadows it', () => {
    controller = createController();
    mount(h(LogicEditor, { controller, screenId: 'settings', elementId: 'settings-continue' }));
    const count = controller.draft.flow.rules.length;
    click('[data-action="add-rule"]');
    change('[data-testid="condition"]', 'server-true');
    change('[data-testid="destination"]', 'library');
    click('[data-action="save-rule"]');
    expect(controller.draft.flow.rules).toHaveLength(count + 1);
    const added = controller.draft.flow.rules[controller.draft.flow.rules.length - 1];
    expect(added.condition).toEqual({ kind: 'eq', path: 'server.connected', value: true });
    change('[data-testid="condition"]', 'none');
    click('[data-action="save-rule"]');
    click('[data-action="move-up"]');
    expect(host.textContent).toContain('SHADOWED_RULE');
  });

  it('rejects unknown routes and empty toasts without changing the flow', () => {
    controller = createController();
    const original = controller.draft.flow;
    mount(h(LogicEditor, { controller, screenId: 'settings', elementId: 'settings-continue' }));
    change('[data-testid="destination"]', 'missing');
    click('[data-action="save-rule"]');
    expect(host.textContent).toContain('UNKNOWN_ROUTE');
    expect(controller.draft.flow).toBe(original);
    change('[data-testid="action"]', 'toast');
    change('[data-testid="toast-message"]', '');
    click('[data-action="save-rule"]');
    expect(host.textContent).toContain('TOAST_REQUIRED');
    expect(controller.draft.flow).toBe(original);
  });
});

describe('FlowMap and simulation', () => {
  it('shows destinations and condition labels', () => {
    mount(h(FlowMap, { flow: createDefaultFlow(BASE) }));
    for (const text of ['settings', 'library', 'connect', 'true', 'false']) expect(host.textContent).toContain(text);
  });

  it('simulates both server states with one action and no real calls', async () => {
    const disconnected = await simulatePreviewClick({ flow: createDefaultFlow(BASE), serverConnected: false });
    expect(disconnected.route).toBe('connect');
    expect(disconnected.trace.map((entry) => entry.action)).toEqual(['navigate']);
    expect(disconnected.realNetworkCalls).toBe(0);
    const connected = await simulatePreviewClick({ flow: createDefaultFlow(BASE), serverConnected: true });
    expect(connected.route).toBe('library');
    expect(connected.trace).toHaveLength(1);
  });

  it('runs the same scenarios through the simulation panel', async () => {
    controller = createController();
    mount(h(SimulationPanel, { flow: controller.draft.flow, serverConnected: false, onServerConnected: () => undefined }));
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-action="simulate"]')!.click();
      await Promise.resolve();
    });
    expect(host.textContent).toContain('connect');
    expect(host.querySelectorAll('[data-trace-entry]')).toHaveLength(1);
  });

  it('shows preview errors instead of hiding them', () => {
    mount(h(SimulationPanel, { flow: createDefaultFlow(BASE), serverConnected: false, onServerConnected: () => undefined, error: 'Preview failed' }));
    expect(host.textContent).toContain('Preview failed');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
});

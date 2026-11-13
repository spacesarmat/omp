import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDefaultFlow } from '../../design/defaults';
import type { InteractionCondition } from '../../design/schema';
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
    getDesign: async () => null,
    rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
    exportDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
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

  it('preserves a complex condition when only the action changes', () => {
    controller = createController();
    const condition: InteractionCondition = {
      kind: 'all',
      conditions: [
        { kind: 'eq', path: 'target', value: 'desktop-macos' },
        { kind: 'not', condition: { kind: 'eq', path: 'screen.current', value: 'library' } },
      ],
    };
    controller.replaceFlow({
      ...controller.draft.flow,
      rules: controller.draft.flow.rules.map((rule) => rule.id === 'settings-continue-connected' ? { ...rule, condition } : rule),
    });
    mount(h(LogicEditor, { controller, screenId: 'settings', elementId: 'settings-continue' }));
    expect(host.querySelector<HTMLSelectElement>('[data-testid="condition"]')!.value).toBe('custom');
    change('[data-testid="condition"]', 'server-true');
    expect(host.querySelector('[data-testid="condition"] option[value="custom"]')).not.toBeNull();
    change('[data-testid="condition"]', 'custom');
    change('[data-testid="action"]', 'toast');
    change('[data-testid="toast-message"]', 'Preserved');
    click('[data-action="save-rule"]');
    expect(controller.draft.flow.rules.find((rule) => rule.id === 'settings-continue-connected')?.condition).toEqual(condition);
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

  it('simulates the selected target instead of always using Windows', async () => {
    const flow = createDefaultFlow(BASE);
    for (const rule of flow.rules) {
      if (rule.id === 'settings-continue-connected') rule.condition = { kind: 'eq', path: 'target', value: 'desktop-macos' };
      if (rule.id === 'settings-continue-disconnected') rule.condition = { kind: 'eq', path: 'target', value: 'desktop-windows' };
    }
    const result = await simulatePreviewClick({ flow, serverConnected: true, target: 'desktop-macos' });
    expect(result.route).toBe('library');
  });

  it('runs graph rules through the shared interpreter with toast and navigation', async () => {
    const flow: import('../../design/schema').FlowDocument = {
      schemaVersion: 1,
      id: 'sim-graph',
      baseCommit: BASE,
      rules: [{
        id: 'graph-go',
        screenId: 'settings',
        elementId: 'settings-continue',
        event: 'click',
        action: { type: 'back' },
        graph: {
          nodes: [
            { id: 't', kind: 'trigger', ruleId: 'graph-go', x: 0, y: 0 },
            { id: 'a', kind: 'action', ruleId: 'graph-go', x: 1, y: 0, stepId: 's1' },
            { id: 'b', kind: 'action', ruleId: 'graph-go', x: 2, y: 0, stepId: 's2' },
          ],
          edges: [
            { id: 'e1', from: 't', to: 'a', branch: 'default' },
            { id: 'e2', from: 'a', to: 'b', branch: 'default' },
          ],
        },
        steps: [
          { id: 's1', action: { type: 'toast', message: 'Шаг выполнен' } },
          { id: 's2', action: { type: 'navigate', screenId: 'library' } },
        ],
      }],
    };
    const result = await simulatePreviewClick({ flow, serverConnected: true });
    expect(result.route).toBe('library');
    expect(result.toast).toBe('Шаг выполнен');
    expect(result.trace.map((entry) => entry.action)).toEqual(['toast', 'navigate']);
    expect(result.trace[1].target).toBe('library');
    expect(result.realNetworkCalls).toBe(0);
  });

  it('reports unsupported preview actions as a sync outcome instead of throwing', async () => {
    const flow: import('../../design/schema').FlowDocument = {
      schemaVersion: 1,
      id: 'sim-unsupported',
      baseCommit: BASE,
      rules: [{
        id: 'graph-dialog',
        screenId: 'settings',
        elementId: 'settings-continue',
        event: 'click',
        action: { type: 'back' },
        graph: {
          nodes: [
            { id: 't', kind: 'trigger', ruleId: 'graph-dialog', x: 0, y: 0 },
            { id: 'a', kind: 'action', ruleId: 'graph-dialog', x: 1, y: 0, stepId: 's1' },
          ],
          edges: [{ id: 'e1', from: 't', to: 'a', branch: 'default' }],
        },
        steps: [{ id: 's1', action: { type: 'dialog', title: 'Заголовок', message: 'Сообщение' } }],
      }],
    };
    const result = await simulatePreviewClick({ flow, serverConnected: true });
    expect(result.route).toBe('settings');
    expect(result.trace.map((entry) => entry.action)).toEqual(['dialog']);
  });

  it('keeps legacy documents on the legacy path with legacy precedence', async () => {
    const flow = createDefaultFlow(BASE);
    flow.rules.push({
      id: 'graph-shadow',
      screenId: 'settings',
      elementId: 'settings-continue',
      event: 'click',
      action: { type: 'back' },
      graph: {
        nodes: [
          { id: 't', kind: 'trigger', ruleId: 'graph-shadow', x: 0, y: 0 },
          { id: 'a', kind: 'action', ruleId: 'graph-shadow', x: 1, y: 0, stepId: 's1' },
        ],
        edges: [{ id: 'e1', from: 't', to: 'a', branch: 'default' }],
      },
      steps: [{ id: 's1', action: { type: 'toast', message: 'graph must not run' } }],
    });
    const result = await simulatePreviewClick({ flow, serverConnected: true });
    expect(result.route).toBe('library');
    expect(result.trace.map((entry) => entry.action)).toEqual(['navigate']);
  });

  it('runs the same scenarios through the simulation panel', async () => {
    controller = createController();
    mount(h(SimulationPanel, { target: 'desktop-windows', flow: controller.draft.flow, serverConnected: false, onServerConnected: () => undefined }));
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-action="simulate"]')!.click();
      await Promise.resolve();
    });
    expect(host.textContent).toContain('connect');
    expect(host.querySelectorAll('[data-trace-entry]')).toHaveLength(1);
  });

  it('shows preview errors instead of hiding them', () => {
    mount(h(SimulationPanel, { target: 'desktop-windows', flow: createDefaultFlow(BASE), serverConnected: false, onServerConnected: () => undefined, error: 'Preview failed' }));
    expect(host.textContent).toContain('Preview failed');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
});

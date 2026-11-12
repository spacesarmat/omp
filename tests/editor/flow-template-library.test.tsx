import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDraftController, type DraftController } from '../../editor/src/drafts';
import { FlowTemplateLibrary } from '../../editor/src/components/FlowTemplateLibrary';
import { FlowCanvas } from '../../editor/src/components/FlowCanvas';
import { validateFlowGraph } from '../../design/flow-validation-graph';
import { DESKTOP_ROUTES } from '../../desktop/src/shell/routes';
import type { EditorClient } from '../../editor/src/client';

const BASE = '0000000000000000000000000000000000000000';
const ROUTE_IDS = DESKTOP_ROUTES.map((route) => route.id);

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

function click(selector: string): void {
  act(() => {
    host.querySelector<HTMLElement>(selector)!.click();
  });
}

describe('FlowTemplateLibrary', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    render(null, host);
    host.remove();
  });

  it('renders all five templates and calls onInsert with the template id', () => {
    const onInsert = vi.fn<(templateId: string) => void>(() => undefined);
    act(() => render(h(FlowTemplateLibrary, { onInsert }), host));
    const cards = host.querySelectorAll('[data-template-id]');
    expect(cards.length).toBe(5);
    expect([...cards].map((card) => card.getAttribute('data-template-id'))).toEqual([
      'connect-server',
      'offline-retry',
      'episode-queue',
      'playback-fallback',
      'restore-position',
    ]);
    click('[data-action="insert-offline-retry"]');
    expect(onInsert).toHaveBeenCalledWith('offline-retry');
  });

  it('disables insert buttons in read-only mode', () => {
    const onInsert = vi.fn<(templateId: string) => void>(() => undefined);
    act(() => render(h(FlowTemplateLibrary, { onInsert, readOnly: true }), host));
    const button = host.querySelector<HTMLButtonElement>('[data-action="insert-connect-server"]');
    expect(button?.disabled).toBe(true);
    click('[data-action="insert-connect-server"]');
    expect(onInsert).not.toHaveBeenCalled();
  });
});

describe('FlowCanvas template insertion', () => {
  beforeEach(() => {
    controller = createController();
    host = document.createElement('div');
    document.body.appendChild(host);
    act(() => render(h(FlowCanvas, {
      controller,
      screenId: 'settings',
      readOnly: false,
      onSelectNode: () => undefined,
      onOpenSimulation: () => undefined,
    }), host));
  });

  afterEach(() => {
    render(null, host);
    host.remove();
  });

  it('inserts an instantiated template into the draft flow', () => {
    const rulesBefore = controller.draft.flow.rules.length;
    click('[data-action="toggle-templates"]');
    click('[data-action="insert-connect-server"]');
    const flow = controller.draft.flow;
    expect(flow.rules.length).toBe(rulesBefore + 1);
    const inserted = flow.rules[flow.rules.length - 1];
    expect(inserted.graph?.nodes.length).toBeGreaterThan(0);
    expect(validateFlowGraph(flow, ROUTE_IDS)).toEqual([]);
  });

  it('appends template variables without duplicating existing declarations', () => {
    click('[data-action="toggle-templates"]');
    click('[data-action="insert-restore-position"]');
    const variables = controller.draft.flow.variables ?? [];
    expect(variables.length).toBeGreaterThan(0);
    expect(new Set(variables.map((variable) => variable.id)).size).toBe(variables.length);
    expect(validateFlowGraph(controller.draft.flow, ROUTE_IDS)).toEqual([]);
  });

  it('keeps the library closed and insertion unavailable in read-only mode', () => {
    render(null, host);
    host.remove();
    host = document.createElement('div');
    document.body.appendChild(host);
    act(() => render(h(FlowCanvas, {
      controller,
      screenId: 'settings',
      readOnly: true,
      onSelectNode: () => undefined,
      onOpenSimulation: () => undefined,
    }), host));
    const rulesBefore = controller.draft.flow.rules.length;
    const toggle = host.querySelector<HTMLButtonElement>('[data-action="toggle-templates"]');
    expect(toggle).toBeNull();
    expect(host.querySelector('[data-testid="flow-template-library"]')).toBeNull();
    expect(controller.draft.flow.rules.length).toBe(rulesBefore);
  });
});

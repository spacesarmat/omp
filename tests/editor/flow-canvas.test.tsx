import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDraftController, type DraftController } from '../../editor/src/drafts';
import { FlowCanvas, type FlowNodeSelection } from '../../editor/src/components/FlowCanvas';
import { FlowNodeInspector } from '../../editor/src/components/FlowNodeInspector';
import type { EditorClient } from '../../editor/src/client';

const BASE = '0000000000000000000000000000000000000000';

function createSelectSpy() {
  return vi.fn<(selection: FlowNodeSelection) => void>(() => undefined);
}

function createSimSpy() {
  return vi.fn<() => void>(() => undefined);
}
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

function mountCanvas(overrides: Partial<Parameters<typeof FlowCanvas>[0]> = {}): { onSelectNode: ReturnType<typeof createSelectSpy>; onOpenSimulation: ReturnType<typeof createSimSpy> } {
  const onSelectNode = createSelectSpy();
  const onOpenSimulation = createSimSpy();
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(h(FlowCanvas, {
    controller,
    screenId: 'settings',
    readOnly: false,
    onSelectNode,
    onOpenSimulation,
    ...overrides,
  }), host));
  return { onSelectNode, onOpenSimulation };
}

function click(selector: string): void {
  act(() => {
    host.querySelector<HTMLElement>(selector)!.click();
  });
}

function pointer(target: Element | null, type: string, clientX: number, clientY: number): void {
  if (!target) throw new Error(`pointer target missing for ${type}`);
  act(() => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, clientY, pointerId: 1 }));
  });
}

function keydown(target: Window, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

function graphOf(): { nodes: { id: string; kind: string; x: number; y: number; label?: string }[]; edges: { from: string; to: string; branch: string }[] } {
  const rule = controller.draft.flow.rules.find((entry) => entry.graph);
  expect(rule).toBeDefined();
  return { nodes: rule!.graph!.nodes as never, edges: rule!.graph!.edges as never };
}

function nodeEl(nodeId: string): HTMLElement {
  const element = host.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
  if (!element) throw new Error(`node ${nodeId} not rendered`);
  return element;
}

beforeEach(() => {
  controller = createController();
});

afterEach(() => {
  act(() => render(null, host));
  controller.dispose();
  host.remove();
  vi.restoreAllMocks();
});

describe('flow canvas', () => {
  it('renders grid, minimap, toolbar and an empty world for the screen', () => {
    mountCanvas();
    expect(host.querySelector('[data-testid="flow-canvas-grid"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="flow-minimap"]')).not.toBeNull();
    expect(host.querySelector('[data-action="add-trigger"]')).not.toBeNull();
    expect(host.querySelector('[data-action="add-condition"]')).not.toBeNull();
    expect(host.querySelector('[data-action="add-action"]')).not.toBeNull();
    expect(host.querySelector('[data-action="add-result"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="flow-canvas-error"]')).toBeNull();
  });

  it('adds a node from the toolbar and one undo removes it', () => {
    mountCanvas();
    click('[data-action="add-condition"]');
    const graph = graphOf();
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].kind).toBe('condition');
    expect(host.querySelectorAll('[data-node-id]')).toHaveLength(1);
    expect(controller.canUndo).toBe(true);
    act(() => { controller.undo(); });
    expect(controller.draft.flow.rules.some((entry) => entry.graph)).toBe(false);
    expect(host.querySelectorAll('[data-node-id]')).toHaveLength(0);
  });

  it('adds a node with the Insert key', () => {
    mountCanvas();
    keydown(window, 'Insert');
    expect(graphOf().nodes).toHaveLength(1);
  });

  it('drags a node and commits one undo step for the move', () => {
    mountCanvas();
    click('[data-action="add-action"]');
    const nodeId = graphOf().nodes[0].id;
    const element = nodeEl(nodeId);
    const before = { left: element.style.left, top: element.style.top };
    pointer(element, 'pointerdown', 100, 100);
    pointer(window.document.body, 'pointermove', 160, 150);
    pointer(window.document.body, 'pointerup', 160, 150);
    const moved = nodeEl(nodeId);
    expect(moved.style.left).not.toBe(before.left);
    expect(moved.style.top).not.toBe(before.top);
    act(() => { controller.undo(); });
    expect(nodeEl(nodeId).style.left).toBe(before.left);
  });

  it('connects a condition output to an action input with the true branch', () => {
    mountCanvas();
    click('[data-action="add-condition"]');
    click('[data-action="add-action"]');
    const nodes = graphOf().nodes;
    const condition = nodes.find((node) => node.kind === 'condition')!;
    const action = nodes.find((node) => node.kind === 'action')!;
    const output = nodeEl(condition.id).querySelector('[data-port="out"][data-branch="true"]');
    const input = nodeEl(action.id).querySelector('[data-port="in"]');
    pointer(output, 'pointerdown', 0, 0);
    pointer(input, 'pointerup', 0, 0);
    const edges = graphOf().edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from: condition.id, to: action.id, branch: 'true' });
  });

  it('rejects a connection that creates a cycle and reports the reason', () => {
    mountCanvas();
    click('[data-action="add-condition"]');
    click('[data-action="add-action"]');
    const nodes = graphOf().nodes;
    const condition = nodes.find((node) => node.kind === 'condition')!;
    const action = nodes.find((node) => node.kind === 'action')!;
    pointer(nodeEl(condition.id).querySelector('[data-port="out"][data-branch="true"]'), 'pointerdown', 0, 0);
    pointer(nodeEl(action.id).querySelector('[data-port="in"]'), 'pointerup', 0, 0);
    pointer(nodeEl(action.id).querySelector('[data-port="out"][data-branch="default"]'), 'pointerdown', 0, 0);
    pointer(nodeEl(condition.id).querySelector('[data-port="in"]'), 'pointerup', 0, 0);
    expect(graphOf().edges).toHaveLength(1);
    expect(host.querySelector('[data-testid="flow-canvas-error"]')!.textContent).toContain('cycle');
  });

  it('auto-layout arranges nodes into columns by graph depth', () => {
    mountCanvas();
    click('[data-action="add-trigger"]');
    click('[data-action="add-condition"]');
    click('[data-action="add-action"]');
    const nodes = graphOf().nodes;
    const trigger = nodes.find((node) => node.kind === 'trigger')!;
    const condition = nodes.find((node) => node.kind === 'condition')!;
    pointer(nodeEl(trigger.id).querySelector('[data-port="out"][data-branch="default"]'), 'pointerdown', 0, 0);
    pointer(nodeEl(condition.id).querySelector('[data-port="in"]'), 'pointerup', 0, 0);
    click('[data-action="auto-layout"]');
    const laidOut = graphOf().nodes;
    const laidTrigger = laidOut.find((node) => node.id === trigger.id)!;
    const laidCondition = laidOut.find((node) => node.id === condition.id)!;
    expect(laidCondition.x).toBeGreaterThan(laidTrigger.x);
  });

  it('zoom buttons scale the canvas world', () => {
    mountCanvas();
    const world = host.querySelector<HTMLElement>('[data-testid="flow-canvas-world"]')!;
    expect(world.style.transform).toContain('scale(1');
    click('[data-action="zoom-in"]');
    expect(host.querySelector<HTMLElement>('[data-testid="flow-canvas-world"]')!.style.transform).toContain('scale(1.2');
  });

  it('deletes the selected node with the Delete key as one undo step', () => {
    mountCanvas();
    click('[data-action="add-condition"]');
    const nodeId = graphOf().nodes[0].id;
    click(`[data-node-id="${nodeId}"]`);
    keydown(window, 'Delete');
    expect(controller.draft.flow.rules.some((entry) => entry.graph)).toBe(false);
    act(() => { controller.undo(); });
    expect(graphOf().nodes).toHaveLength(1);
  });

  it('stays read-only: no edits, no drag, notice shown', () => {
    mountCanvas({ readOnly: true });
    expect(host.querySelector('[data-testid="flow-canvas-readonly"]')).not.toBeNull();
    click('[data-action="add-condition"]');
    expect(controller.draft.flow.rules.some((rule) => rule.graph)).toBe(false);
    keydown(window, 'Insert');
    expect(controller.draft.flow.rules.some((rule) => rule.graph)).toBe(false);
    expect(controller.canUndo).toBe(false);
  });

  it('pans the canvas by dragging the world background', () => {
    mountCanvas();
    const world = host.querySelector<HTMLElement>('[data-testid="flow-canvas-world"]')!;
    pointer(world, 'pointerdown', 200, 200);
    pointer(document.body, 'pointermove', 240, 230);
    pointer(document.body, 'pointerup', 240, 230);
    const moved = host.querySelector<HTMLElement>('[data-testid="flow-canvas-world"]')!;
    expect(moved.style.transform).toContain('translate(40px, 30px)');
  });

  it('prevents adding a second trigger and reports MULTIPLE_TRIGGERS', () => {
    mountCanvas();
    click('[data-action="add-trigger"]');
    click('[data-action="add-trigger"]');
    expect(graphOf().nodes.filter((node) => node.kind === 'trigger')).toHaveLength(1);
    expect(host.querySelector('[data-testid="flow-canvas-error"]')!.textContent).toContain('MULTIPLE_TRIGGERS');
  });

  it('prevents deleting the last trigger and reports NO_TRIGGER', () => {
    mountCanvas();
    click('[data-action="add-trigger"]');
    click('[data-action="add-condition"]');
    const trigger = graphOf().nodes.find((node) => node.kind === 'trigger')!;
    click(`[data-node-id="${trigger.id}"]`);
    keydown(window, 'Delete');
    expect(graphOf().nodes).toHaveLength(2);
    expect(host.querySelector('[data-testid="flow-canvas-error"]')!.textContent).toContain('NO_TRIGGER');
  });

  it('prevents removing a middle node that orphans a path and reports UNREACHABLE_NODE', () => {
    mountCanvas();
    click('[data-action="add-trigger"]');
    click('[data-action="add-condition"]');
    click('[data-action="add-action"]');
    const nodes = graphOf().nodes;
    const trigger = nodes.find((node) => node.kind === 'trigger')!;
    const condition = nodes.find((node) => node.kind === 'condition')!;
    const action = nodes.find((node) => node.kind === 'action')!;
    pointer(nodeEl(trigger.id).querySelector('[data-port="out"][data-branch="default"]'), 'pointerdown', 0, 0);
    pointer(nodeEl(condition.id).querySelector('[data-port="in"]'), 'pointerup', 0, 0);
    pointer(nodeEl(condition.id).querySelector('[data-port="out"][data-branch="true"]'), 'pointerdown', 0, 0);
    pointer(nodeEl(action.id).querySelector('[data-port="in"]'), 'pointerup', 0, 0);
    click(`[data-node-id="${condition.id}"]`);
    keydown(window, 'Delete');
    expect(graphOf().nodes).toHaveLength(3);
    expect(host.querySelector('[data-testid="flow-canvas-error"]')!.textContent).toContain('UNREACHABLE_NODE');
  });

  it('computes the connection against the latest draft, not a stale render snapshot', () => {
    mountCanvas();
    click('[data-action="add-condition"]');
    click('[data-action="add-action"]');
    const nodes = graphOf().nodes;
    const condition = nodes.find((node) => node.kind === 'condition')!;
    const action = nodes.find((node) => node.kind === 'action')!;
    const output = nodeEl(condition.id).querySelector('[data-port="out"][data-branch="true"]');
    const input = nodeEl(action.id).querySelector('[data-port="in"]');
    pointer(output, 'pointerdown', 0, 0);
    act(() => {
      controller.update((current) => {
        const rule = current.flow.rules.find((entry) => entry.graph);
        const target = rule?.graph?.nodes.find((entry) => entry.id === action.id);
        if (target) target.label = 'renamed-between-events';
      });
      input!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    });
    const graph = graphOf();
    expect(graph.edges).toHaveLength(1);
    expect(graph.nodes.find((node) => node.id === action.id)!.label).toBe('renamed-between-events');
  });

  it('removes the containing rule when deleting its last node', () => {
    mountCanvas();
    click('[data-action="add-trigger"]');
    const trigger = graphOf().nodes.find((node) => node.kind === 'trigger')!;
    click(`[data-node-id="${trigger.id}"]`);
    keydown(window, 'Delete');
    expect(controller.draft.flow.rules.some((entry) => entry.graph)).toBe(false);
    expect(host.querySelector('[data-testid="flow-canvas-error"]')).toBeNull();
    act(() => { controller.undo(); });
    expect(controller.draft.flow.rules.some((entry) => entry.graph)).toBe(true);
  });

  it('prevents deleting the only result and reports NO_TERMINAL_PATH', () => {
    mountCanvas();
    click('[data-action="add-trigger"]');
    click('[data-action="add-condition"]');
    click('[data-action="add-result"]');
    const nodes = graphOf().nodes;
    const trigger = nodes.find((node) => node.kind === 'trigger')!;
    const condition = nodes.find((node) => node.kind === 'condition')!;
    const result = nodes.find((node) => node.kind === 'result')!;
    pointer(nodeEl(trigger.id).querySelector('[data-port="out"][data-branch="default"]'), 'pointerdown', 0, 0);
    pointer(nodeEl(condition.id).querySelector('[data-port="in"]'), 'pointerup', 0, 0);
    pointer(nodeEl(condition.id).querySelector('[data-port="out"][data-branch="true"]'), 'pointerdown', 0, 0);
    pointer(nodeEl(result.id).querySelector('[data-port="in"]'), 'pointerup', 0, 0);
    click(`[data-node-id="${result.id}"]`);
    keydown(window, 'Delete');
    expect(graphOf().nodes).toHaveLength(3);
    expect(host.querySelector('[data-testid="flow-canvas-error"]')!.textContent).toContain('NO_TERMINAL_PATH');
  });

  it('allows deleting a result when a terminal action remains', () => {
    mountCanvas();
    click('[data-action="add-trigger"]');
    click('[data-action="add-action"]');
    const nodes = graphOf().nodes;
    const trigger = nodes.find((node) => node.kind === 'trigger')!;
    const action = nodes.find((node) => node.kind === 'action')!;
    act(() => {
      controller.update((current) => {
        const rule = current.flow.rules.find((entry) => entry.graph);
        const step = rule?.steps?.[0];
        if (step) step.action = { type: 'navigate', screenId: 'library' };
      });
    });
    click('[data-action="add-result"]');
    const result = graphOf().nodes.find((node) => node.kind === 'result')!;
    pointer(nodeEl(trigger.id).querySelector('[data-port="out"][data-branch="default"]'), 'pointerdown', 0, 0);
    pointer(nodeEl(action.id).querySelector('[data-port="in"]'), 'pointerup', 0, 0);
    pointer(nodeEl(action.id).querySelector('[data-port="out"][data-branch="default"]'), 'pointerdown', 0, 0);
    pointer(nodeEl(result.id).querySelector('[data-port="in"]'), 'pointerup', 0, 0);
    click(`[data-node-id="${result.id}"]`);
    keydown(window, 'Delete');
    expect(graphOf().nodes.map((node) => node.kind).sort()).toEqual(['action', 'trigger']);
    expect(host.querySelector('[data-testid="flow-canvas-error"]')).toBeNull();
  });
});

describe('flow node inspector', () => {
  function mountInspector(nodeId: string, ruleId: string, readOnly = false): void {
    host = document.createElement('div');
    document.body.appendChild(host);
    act(() => render(h(FlowNodeInspector, { controller, ruleId, nodeId, readOnly }), host));
  }

  it('edits typed condition fields of the selected node step', () => {
    mountCanvas();
    click('[data-action="add-condition"]');
    const graph = graphOf();
    const nodeId = graph.nodes[0].id;
    const rule = controller.draft.flow.rules.find((entry) => entry.graph)!;
    mountInspector(nodeId, rule.id);
    const select = (testId: string, value: string) => {
      const input = host.querySelector<HTMLSelectElement>(`[data-testid="${testId}"]`)!;
      act(() => {
        input.value = value;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };
    select('inspector-condition-op', 'neq');
    select('inspector-condition-value', 'false');
    const step = controller.draft.flow.rules.find((entry) => entry.graph)!.steps![0];
    expect(step.condition).toMatchObject({ kind: 'neq', path: 'server.connected', value: false });
  });

  it('edits the action message and rejects an empty toast', () => {
    mountCanvas();
    click('[data-action="add-action"]');
    const nodeId = graphOf().nodes[0].id;
    const rule = controller.draft.flow.rules.find((entry) => entry.graph)!;
    mountInspector(nodeId, rule.id);
    const input = host.querySelector<HTMLInputElement>('[data-testid="inspector-action-message"]')!;
    act(() => {
      input.value = 'Сервер недоступен';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const step = controller.draft.flow.rules.find((entry) => entry.graph)!.steps![0];
    expect(step.action).toMatchObject({ type: 'toast', message: 'Сервер недоступен' });
    const empty = host.querySelector<HTMLInputElement>('[data-testid="inspector-action-message"]')!;
    act(() => {
      empty.value = '';
      empty.dispatchEvent(new Event('input', { bubbles: true }));
      empty.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.querySelector('[data-testid="inspector-error"]')!.textContent).toContain('TOAST');
  });

  it('disables fields in read-only mode', () => {
    mountCanvas();
    click('[data-action="add-condition"]');
    const nodeId = graphOf().nodes[0].id;
    const rule = controller.draft.flow.rules.find((entry) => entry.graph)!;
    mountInspector(nodeId, rule.id, true);
    expect(host.querySelector<HTMLSelectElement>('[data-testid="inspector-condition-op"]')!.disabled).toBe(true);
  });

  it('offers variable.set with typed variable id and value fields', () => {
    mountCanvas();
    act(() => {
      controller.update((current) => {
        current.flow.variables = [{ id: 'var-1', name: 'flag', type: 'boolean', initial: false }];
      });
    });
    click('[data-action="add-action"]');
    const nodeId = graphOf().nodes[0].id;
    const rule = controller.draft.flow.rules.find((entry) => entry.graph)!;
    mountInspector(nodeId, rule.id);
    const typeSelect = host.querySelector<HTMLSelectElement>('[data-testid="inspector-action-type"]')!;
    expect([...typeSelect.options].some((option) => option.value === 'variable.set')).toBe(true);
    act(() => {
      typeSelect.value = 'variable.set';
      typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    let step = controller.draft.flow.rules.find((entry) => entry.graph)!.steps![0];
    expect(step.action).toMatchObject({ type: 'variable.set', variableId: 'var-1', value: false });
    const valueSelect = host.querySelector<HTMLSelectElement>('[data-testid="inspector-action-variable-value"]')!;
    act(() => {
      valueSelect.value = 'true';
      valueSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    step = controller.draft.flow.rules.find((entry) => entry.graph)!.steps![0];
    expect(step.action).toMatchObject({ type: 'variable.set', variableId: 'var-1', value: true });
  });

  it('links the node back to design mode and opens simulation', () => {
    const { onSelectNode, onOpenSimulation } = mountCanvas();
    click('[data-action="add-condition"]');
    const nodeId = graphOf().nodes[0].id;
    const rule = controller.draft.flow.rules.find((entry) => entry.graph)!;
    act(() => render(h(FlowNodeInspector, { controller, ruleId: rule.id, nodeId, readOnly: false, onSelectNode, onOpenSimulation }), host));
    click('[data-action="reveal-in-design"]');
    expect(onSelectNode).toHaveBeenCalledTimes(1);
    click('[data-action="open-simulation"]');
    expect(onOpenSimulation).toHaveBeenCalledTimes(1);
  });
});

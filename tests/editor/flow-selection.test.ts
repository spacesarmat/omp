import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDraftController, type DraftController } from '../../editor/src/drafts';
import { FlowCanvas } from '../../editor/src/components/FlowCanvas';
import { FlowNodeInspector } from '../../editor/src/components/FlowNodeInspector';
import {
  EMPTY_FLOW_SELECTION,
  moveFlowSelection,
  reduceFlowSelection,
} from '../../editor/src/flow/selection';
import { autoLayoutFlow, FlowOperationError } from '../../editor/src/flow/nodeOperations';
import type { EditorClient } from '../../editor/src/client';
import type { FlowDocument, FlowGraph } from '../../design/schema.ts';

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

function mountCanvas(overrides: Partial<Parameters<typeof FlowCanvas>[0]> = {}): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(h(FlowCanvas, {
    controller,
    screenId: 'settings',
    readOnly: false,
    ...overrides,
  }), host));
}

function click(selector: string): void {
  act(() => {
    host.querySelector<HTMLElement>(selector)!.click();
  });
}

function shiftClick(selector: string): void {
  act(() => {
    host.querySelector<HTMLElement>(selector)!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
  });
}

function pointer(target: Element | null, type: string, clientX: number, clientY: number): void {
  if (!target) throw new Error(`pointer target missing for ${type}`);
  act(() => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, clientY, pointerId: 1 }));
  });
}

function keydown(target: Window, key: string, options: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
  });
}

function graphOf(): FlowGraph {
  const rule = controller.draft.flow.rules.find((entry) => entry.graph);
  expect(rule).toBeDefined();
  return rule!.graph!;
}

function nodeEl(nodeId: string): HTMLElement {
  const element = host.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
  if (!element) throw new Error(`node ${nodeId} not rendered`);
  return element;
}

function selectedNodeEls(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('.flow-node-selected')];
}

function ruleWithGraph(flow: FlowDocument) {
  return flow.rules.find((entry) => entry.graph)!;
}

beforeEach(() => {
  controller = createController();
});

afterEach(() => {
  if (host) act(() => render(null, host));
  controller.dispose();
  host?.remove();
  host = undefined as never;
  vi.restoreAllMocks();
});

describe('reduceFlowSelection', () => {
  it('select replaces the previous selection', () => {
    const first = reduceFlowSelection(EMPTY_FLOW_SELECTION, { type: 'select', ruleId: 'rule-1', nodeId: 'node-1' });
    expect(first).toEqual({ ruleId: 'rule-1', nodeIds: ['node-1'] });
    const second = reduceFlowSelection(first, { type: 'select', ruleId: 'rule-1', nodeId: 'node-2' });
    expect(second).toEqual({ ruleId: 'rule-1', nodeIds: ['node-2'] });
  });

  it('toggle adds a node that is not selected yet', () => {
    const state = reduceFlowSelection(
      { ruleId: 'rule-1', nodeIds: ['node-1'] },
      { type: 'toggle', ruleId: 'rule-1', nodeId: 'node-2' },
    );
    expect(state).toEqual({ ruleId: 'rule-1', nodeIds: ['node-1', 'node-2'] });
  });

  it('toggle removes an already selected node', () => {
    const state = reduceFlowSelection(
      { ruleId: 'rule-1', nodeIds: ['node-1', 'node-2'] },
      { type: 'toggle', ruleId: 'rule-1', nodeId: 'node-1' },
    );
    expect(state).toEqual({ ruleId: 'rule-1', nodeIds: ['node-2'] });
  });

  it('toggle on the last selected node clears the selection', () => {
    const state = reduceFlowSelection(
      { ruleId: 'rule-1', nodeIds: ['node-1'] },
      { type: 'toggle', ruleId: 'rule-1', nodeId: 'node-1' },
    );
    expect(state).toEqual({ ruleId: null, nodeIds: [] });
  });

  it('toggle in another rule resets the selection to that single node', () => {
    const state = reduceFlowSelection(
      { ruleId: 'rule-1', nodeIds: ['node-1', 'node-2'] },
      { type: 'toggle', ruleId: 'rule-2', nodeId: 'node-9' },
    );
    expect(state).toEqual({ ruleId: 'rule-2', nodeIds: ['node-9'] });
  });

  it('toggle never adds a duplicate id', () => {
    const state = reduceFlowSelection(
      { ruleId: 'rule-1', nodeIds: ['node-1'] },
      { type: 'toggle', ruleId: 'rule-1', nodeId: 'node-1' },
    );
    expect(state.nodeIds).toHaveLength(0);
  });

  it('sync keeps only nodes that still exist', () => {
    const state = reduceFlowSelection(
      { ruleId: 'rule-1', nodeIds: ['node-1', 'node-2', 'node-3'] },
      { type: 'sync', nodeIds: ['node-2'] },
    );
    expect(state).toEqual({ ruleId: 'rule-1', nodeIds: ['node-2'] });
    const emptied = reduceFlowSelection(state, { type: 'sync', nodeIds: [] });
    expect(emptied).toEqual({ ruleId: null, nodeIds: [] });
  });

  it('clear resets the selection', () => {
    const state = reduceFlowSelection({ ruleId: 'rule-1', nodeIds: ['node-1'] }, { type: 'clear' });
    expect(state).toEqual({ ruleId: null, nodeIds: [] });
  });
});

describe('moveFlowSelection', () => {
  function flowWithNodes(): FlowDocument {
    return {
      schemaVersion: 1,
      id: 'draft-1',
      baseCommit: BASE,
      rules: [{
        id: 'rule-1',
        screenId: 'settings',
        elementId: 'flow-canvas',
        event: 'screen.enter',
        action: { type: 'back' },
        steps: [],
        graph: {
          nodes: [
            { id: 'node-1', kind: 'condition', x: 100, y: 100 },
            { id: 'node-2', kind: 'action', x: 300, y: 200 },
            { id: 'node-3', kind: 'result', x: 500, y: 300 },
          ],
          edges: [],
        },
      }],
    };
  }

  it('moves every selected node by the same delta', () => {
    const next = moveFlowSelection(flowWithNodes(), 'rule-1', ['node-1', 'node-3'], { x: 40, y: -20 });
    const nodes = ruleWithGraph(next).graph!.nodes;
    expect(nodes.find((node) => node.id === 'node-1')).toMatchObject({ x: 140, y: 80 });
    expect(nodes.find((node) => node.id === 'node-2')).toMatchObject({ x: 300, y: 200 });
    expect(nodes.find((node) => node.id === 'node-3')).toMatchObject({ x: 540, y: 280 });
  });

  it('rejects a delta over an unknown node', () => {
    expect(() => moveFlowSelection(flowWithNodes(), 'rule-1', ['node-9'], { x: 1, y: 1 })).toThrow(FlowOperationError);
    expect(() => moveFlowSelection(flowWithNodes(), 'rule-1', ['node-9'], { x: 1, y: 1 })).toThrow('UNKNOWN_NODE');
  });
});

describe('autoLayoutFlow', () => {
  it('places nodes so no two node rects overlap', () => {
    const flow: FlowDocument = {
      schemaVersion: 1,
      id: 'draft-1',
      baseCommit: BASE,
      rules: [{
        id: 'rule-1',
        screenId: 'settings',
        elementId: 'flow-canvas',
        event: 'screen.enter',
        action: { type: 'back' },
        steps: [],
        graph: {
          nodes: [
            { id: 'node-1', kind: 'trigger', x: 7, y: 7 },
            { id: 'node-2', kind: 'condition', x: 7, y: 7 },
            { id: 'node-3', kind: 'action', x: 7, y: 7 },
            { id: 'node-4', kind: 'result', x: 7, y: 7 },
            { id: 'node-5', kind: 'action', x: 7, y: 7 },
          ],
          edges: [
            { id: 'edge-1', from: 'node-1', to: 'node-2', branch: 'default' },
            { id: 'edge-2', from: 'node-2', to: 'node-3', branch: 'true' },
            { id: 'edge-3', from: 'node-2', to: 'node-4', branch: 'false' },
          ],
        },
      }],
    };
    const laidOut = autoLayoutFlow(flow, 'rule-1').rules[0].graph!;
    expect(laidOut.nodes).toHaveLength(5);
    const rects = laidOut.nodes.map((node) => ({ left: node.x, top: node.y, right: node.x + 176, bottom: node.y + 64 }));
    for (let a = 0; a < rects.length; a += 1) {
      for (let b = a + 1; b < rects.length; b += 1) {
        const overlap = rects[a].left < rects[b].right && rects[b].left < rects[a].right
          && rects[a].top < rects[b].bottom && rects[b].top < rects[a].bottom;
        expect(overlap).toBe(false);
      }
    }
  });
});

describe('flow canvas multi-select', () => {
  it('adds and removes nodes from the selection with shift-click', () => {
    mountCanvas();
    click('[data-action="add-condition"]');
    click('[data-action="add-action"]');
    const nodes = graphOf().nodes;
    click(`[data-node-id="${nodes[0].id}"]`);
    expect(selectedNodeEls()).toHaveLength(1);
    shiftClick(`[data-node-id="${nodes[1].id}"]`);
    expect(selectedNodeEls()).toHaveLength(2);
    expect(host.querySelector('[data-testid="flow-canvas-multiselect"]')!.textContent).toContain('2');
    shiftClick(`[data-node-id="${nodes[1].id}"]`);
    expect(selectedNodeEls()).toHaveLength(1);
    expect(host.querySelector('[data-testid="flow-canvas-multiselect"]')).toBeNull();
  });

  it('drags the whole selection and commits one undo step for all nodes', () => {
    mountCanvas();
    click('[data-action="add-condition"]');
    click('[data-action="add-action"]');
    const nodes = graphOf().nodes;
    const first = nodes[0].id;
    const second = nodes[1].id;
    click(`[data-node-id="${first}"]`);
    shiftClick(`[data-node-id="${second}"]`);
    const before = new Map(graphOf().nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
    pointer(nodeEl(first), 'pointerdown', 100, 100);
    pointer(document.body, 'pointermove', 160, 140);
    pointer(document.body, 'pointerup', 160, 140);
    const after = new Map(graphOf().nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
    expect(after.get(first)).toEqual({ x: before.get(first)!.x + 60, y: before.get(first)!.y + 40 });
    expect(after.get(second)).toEqual({ x: before.get(second)!.x + 60, y: before.get(second)!.y + 40 });
    expect(controller.canUndo).toBe(true);
    act(() => { controller.undo(); });
    const restored = new Map(graphOf().nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
    expect(restored.get(first)).toEqual(before.get(first));
    expect(restored.get(second)).toEqual(before.get(second));
  });

  it('moves only the dragged node when it was not part of the selection', () => {
    mountCanvas();
    click('[data-action="add-condition"]');
    click('[data-action="add-action"]');
    const nodes = graphOf().nodes;
    const first = nodes[0].id;
    const second = nodes[1].id;
    click(`[data-node-id="${first}"]`);
    const secondBefore = { x: nodes[1].x, y: nodes[1].y };
    pointer(nodeEl(second), 'pointerdown', 100, 100);
    pointer(document.body, 'pointermove', 160, 140);
    pointer(document.body, 'pointerup', 160, 140);
    const moved = graphOf().nodes.find((node) => node.id === second)!;
    expect(moved).toMatchObject({ x: secondBefore.x + 60, y: secondBefore.y + 40 });
  });

  it('deletes all selected nodes with the Delete key as one undo step', () => {
    mountCanvas();
    click('[data-action="add-condition"]');
    click('[data-action="add-action"]');
    const nodes = graphOf().nodes;
    click(`[data-node-id="${nodes[0].id}"]`);
    shiftClick(`[data-node-id="${nodes[1].id}"]`);
    keydown(window, 'Delete');
    expect(controller.draft.flow.rules.some((entry) => entry.graph)).toBe(false);
    expect(host.querySelectorAll('[data-node-id]')).toHaveLength(0);
    act(() => { controller.undo(); });
    expect(graphOf().nodes).toHaveLength(2);
  });

  it('keeps shift selection read-only safe: select allowed, edits blocked', () => {
    mountCanvas({ readOnly: true });
    act(() => {
      controller.update((current) => {
        current.flow.rules.push({
          id: 'rule-1',
          screenId: 'settings',
          elementId: 'flow-canvas',
          event: 'screen.enter',
          action: { type: 'back' },
          steps: [],
          graph: {
            nodes: [
              { id: 'node-1', kind: 'condition', x: 100, y: 100 },
              { id: 'node-2', kind: 'action', x: 300, y: 100 },
            ],
            edges: [],
          },
        });
      });
    });
    shiftClick('[data-node-id="node-2"]');
    expect(selectedNodeEls()).toHaveLength(1);
    keydown(window, 'Delete');
    expect(graphOf().nodes).toHaveLength(2);
    const beforePaste = JSON.stringify(controller.draft.flow.rules);
    keydown(window, 'v', { ctrlKey: true });
    expect(JSON.stringify(controller.draft.flow.rules)).toBe(beforePaste);
    expect(host.querySelector('[data-testid="flow-canvas-readonly"]')).not.toBeNull();
  });

  it('shows the multi-select summary in the inspector when several nodes are selected', () => {
    mountCanvas();
    click('[data-action="add-condition"]');
    const nodeId = graphOf().nodes[0].id;
    const rule = controller.draft.flow.rules.find((entry) => entry.graph)!;
    act(() => render(h(FlowNodeInspector, { controller, ruleId: rule.id, nodeId, selectedCount: 3 }), host));
    expect(host.querySelector('[data-testid="inspector-multiselect"]')!.textContent).toContain('3');
  });
});

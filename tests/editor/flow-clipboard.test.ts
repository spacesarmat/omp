import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDraftController, type DraftController } from '../../editor/src/drafts';
import { FlowCanvas } from '../../editor/src/components/FlowCanvas';
import {
  FLOW_CLIPBOARD_SCHEMA_VERSION,
  FlowClipboardError,
  copyFlowSelection,
  pasteFlowSelection,
  type FlowClipboard,
} from '../../editor/src/flow/clipboard';
import { FlowOperationError, removeFlowNodes } from '../../editor/src/flow/nodeOperations';
import type { EditorClient } from '../../editor/src/client';
import type { FlowDocument, InteractionRule, InteractionStep } from '../../design/schema.ts';

const BASE = '0000000000000000000000000000000000000000';

const clipboardSteps: InteractionStep[] = [
  { id: 'step-1', condition: { kind: 'eq', path: 'server.connected', value: true } },
  { id: 'step-3', action: { type: 'toast', message: 'Готово' } },
];

function graphRule(overrides: Partial<InteractionRule> = {}): InteractionRule {
  return {
    id: 'rule-1',
    screenId: 'settings',
    elementId: 'flow-canvas',
    event: 'screen.enter',
    action: { type: 'back' },
    steps: [
      { id: 'step-1', condition: { kind: 'eq', path: 'server.connected', value: true } },
      { id: 'step-2', action: { type: 'variable.set', variableId: 'var-2', value: false } },
      { id: 'step-3', action: { type: 'toast', message: 'Готово' } },
    ],
    graph: {
      nodes: [
        { id: 'node-1', kind: 'trigger', x: 60, y: 60 },
        { id: 'node-2', kind: 'condition', x: 280, y: 60, stepId: 'step-1' },
        { id: 'node-3', kind: 'action', x: 500, y: 60, stepId: 'step-2' },
        { id: 'node-4', kind: 'result', x: 720, y: 60 },
      ],
      edges: [
        { id: 'edge-1', from: 'node-1', to: 'node-2', branch: 'default' },
        { id: 'edge-2', from: 'node-2', to: 'node-3', branch: 'true' },
        { id: 'edge-3', from: 'node-3', to: 'node-4', branch: 'default' },
      ],
    },
    ...overrides,
  };
}

function emptyRule(id: string, withTrigger = false): InteractionRule {
  return {
    id,
    screenId: 'player',
    elementId: 'flow-canvas',
    event: 'screen.enter',
    action: { type: 'back' },
    steps: [],
    graph: {
      nodes: withTrigger ? [{ id: 'node-9', kind: 'trigger', x: 60, y: 60 }] : [],
      edges: [],
    },
  };
}

function flowWithRules(rules: InteractionRule[], variables: FlowDocument['variables'] = [
  { id: 'var-1', name: 'unused', type: 'boolean', initial: true },
  { id: 'var-2', name: 'flag', type: 'boolean', initial: false },
]): FlowDocument {
  return { schemaVersion: 1, id: 'draft-1', baseCommit: BASE, rules, variables };
}

function ruleOf(flow: FlowDocument, ruleId: string): InteractionRule {
  return flow.rules.find((entry) => entry.id === ruleId)!;
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

function keydown(target: Window, key: string, options: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
  });
}

function graphOf(): { nodes: { id: string; kind: string; x: number; y: number; stepId?: string }[]; edges: { id: string; from: string; to: string; branch: string }[] } {
  const rule = controller.draft.flow.rules.find((entry) => entry.graph);
  expect(rule).toBeDefined();
  return { nodes: rule!.graph!.nodes as never, edges: rule!.graph!.edges as never };
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

describe('copyFlowSelection', () => {
  it('copies nodes, internal edges and schemaVersion 1', () => {
    const flow = flowWithRules([graphRule()]);
    const clipboard = copyFlowSelection(flow, 'rule-1', ['node-1', 'node-2', 'node-3']);
    expect(clipboard.schemaVersion).toBe(FLOW_CLIPBOARD_SCHEMA_VERSION);
    expect(clipboard.nodes.map((node) => node.id)).toEqual(['node-1', 'node-2', 'node-3']);
    expect(clipboard.edges).toEqual([
      { id: 'edge-1', from: 'node-1', to: 'node-2', branch: 'default' },
      { id: 'edge-2', from: 'node-2', to: 'node-3', branch: 'true' },
    ]);
  });

  it('never copies dangling edges that leave the selection', () => {
    const flow = flowWithRules([graphRule()]);
    const clipboard = copyFlowSelection(flow, 'rule-1', ['node-3']);
    expect(clipboard.nodes).toHaveLength(1);
    expect(clipboard.edges).toHaveLength(0);
  });

  it('collects only variables referenced by copied steps', () => {
    const flow = flowWithRules([graphRule()]);
    const clipboard = copyFlowSelection(flow, 'rule-1', ['node-2', 'node-3']);
    expect(clipboard.variables).toEqual([{ id: 'var-2', name: 'flag', type: 'boolean', initial: false }]);
  });

  it('rejects an empty selection and unknown nodes', () => {
    const flow = flowWithRules([graphRule()]);
    expect(() => copyFlowSelection(flow, 'rule-1', [])).toThrow(FlowClipboardError);
    expect(() => copyFlowSelection(flow, 'rule-1', [])).toThrow('EMPTY_SELECTION');
    expect(() => copyFlowSelection(flow, 'rule-1', ['node-9'])).toThrow('UNKNOWN_NODE');
    expect(() => copyFlowSelection(flow, 'rule-missing', ['node-1'])).toThrow(FlowOperationError);
  });
});

describe('pasteFlowSelection', () => {
  it('pastes with fresh node, edge and step ids and remapped edges', () => {
    const flow = flowWithRules([graphRule(), emptyRule('rule-2')]);
    const clipboard = copyFlowSelection(flow, 'rule-1', ['node-2', 'node-3']);
    const result = pasteFlowSelection(flow, 'rule-2', clipboard);
    const rule = ruleOf(result.flow, 'rule-2');
    expect(result.nodeIds).toHaveLength(2);
    expect(result.nodeIds).not.toContain('node-2');
    expect(result.nodeIds).not.toContain('node-3');
    expect(rule.graph!.nodes.map((node) => node.id)).toEqual(result.nodeIds);
    const [freshCondition, freshAction] = rule.graph!.nodes;
    expect(freshCondition).toMatchObject({ kind: 'condition', ruleId: 'rule-2' });
    expect(freshAction).toMatchObject({ kind: 'action', ruleId: 'rule-2' });
    expect(rule.graph!.edges).toEqual([
      { id: rule.graph!.edges[0].id, from: freshCondition.id, to: freshAction.id, branch: 'true' },
    ]);
    expect(rule.graph!.edges[0].id).not.toBe('edge-2');
    const steps = new Map(rule.steps!.map((step) => [step.id, step]));
    expect(steps.get(freshCondition.stepId!)).toMatchObject({ condition: { kind: 'eq', path: 'server.connected', value: true } });
    expect(steps.get(freshAction.stepId!)).toMatchObject({ action: { type: 'variable.set', variableId: 'var-2', value: false } });
    expect(freshCondition.stepId).not.toBe('step-1');
    expect(freshAction.stepId).not.toBe('step-2');
    expect(ruleOf(result.flow, 'rule-1').graph!.nodes).toHaveLength(4);
    expect(ruleOf(result.flow, 'rule-1').steps).toHaveLength(3);
  });

  it('offsets pasted positions by default and anchors to "at" when given', () => {
    const flow = flowWithRules([graphRule(), emptyRule('rule-2')]);
    const clipboard = copyFlowSelection(flow, 'rule-1', ['node-2', 'node-3']);
    const shifted = pasteFlowSelection(flow, 'rule-2', clipboard);
    const shiftedNodes = ruleOf(shifted.flow, 'rule-2').graph!.nodes;
    expect(shiftedNodes[0]).toMatchObject({ x: 280 + 48, y: 60 + 48 });
    expect(shiftedNodes[1]).toMatchObject({ x: 500 + 48, y: 60 + 48 });
    const anchored = pasteFlowSelection(flow, 'rule-2', clipboard, { at: { x: 1000, y: 500 } });
    const anchoredNodes = ruleOf(anchored.flow, 'rule-2').graph!.nodes;
    expect(anchoredNodes[0]).toMatchObject({ x: 1000, y: 500 });
    expect(anchoredNodes[1]).toMatchObject({ x: 1000 + 220, y: 500 });
  });

  it('reuses existing variables by id and appends missing ones', () => {
    const flow = flowWithRules([graphRule(), emptyRule('rule-2')]);
    const clipboard = copyFlowSelection(flow, 'rule-1', ['node-3']);
    const reused = pasteFlowSelection(flow, 'rule-2', clipboard);
    expect(ruleOf(reused.flow, 'rule-2').graph!.nodes).toHaveLength(1);
    expect(reused.flow.variables!.filter((variable) => variable.id === 'var-2')).toHaveLength(1);
    const withoutVar = flowWithRules(
      [graphRule(), emptyRule('rule-2')],
      [{ id: 'var-1', name: 'unused', type: 'boolean', initial: true }],
    );
    const appended = pasteFlowSelection(withoutVar, 'rule-2', clipboard);
    const appendedVar = appended.flow.variables!.find((variable) => variable.id === 'var-2');
    expect(appendedVar).toEqual({ id: 'var-2', name: 'flag', type: 'boolean', initial: false });
  });

  it('refuses to paste a trigger into a rule that already has one', () => {
    const flow = flowWithRules([graphRule(), emptyRule('rule-2', true)]);
    const clipboard = copyFlowSelection(flow, 'rule-1', ['node-1', 'node-2']);
    expect(() => pasteFlowSelection(flow, 'rule-2', clipboard)).toThrow(FlowOperationError);
    expect(() => pasteFlowSelection(flow, 'rule-2', clipboard)).toThrow('MULTIPLE_TRIGGERS');
  });

  it('refuses a clipboard with two triggers', () => {
    const flow = flowWithRules([graphRule(), emptyRule('rule-2')]);
    const clipboard: FlowClipboard = {
      schemaVersion: 1,
      nodes: [
        { id: 'node-1', kind: 'trigger', x: 0, y: 0 },
        { id: 'node-2', kind: 'trigger', x: 200, y: 0 },
      ],
      edges: [],
      variables: [],
      steps: [],
    };
    expect(() => pasteFlowSelection(flow, 'rule-2', clipboard)).toThrow(FlowClipboardError);
    expect(() => pasteFlowSelection(flow, 'rule-2', clipboard)).toThrow('MULTIPLE_TRIGGERS');
  });

  it('rejects clipboards with a wrong schemaVersion or broken shape', () => {
    const flow = flowWithRules([graphRule(), emptyRule('rule-2')]);
    const base = copyFlowSelection(flow, 'rule-1', ['node-2']);
    const wrongVersion = { ...base, schemaVersion: 2 } as unknown as FlowClipboard;
    expect(() => pasteFlowSelection(flow, 'rule-2', wrongVersion)).toThrow('SCHEMA_VERSION');
    const missingArrays = { schemaVersion: 1 } as unknown as FlowClipboard;
    expect(() => pasteFlowSelection(flow, 'rule-2', missingArrays)).toThrow('SHAPE');
  });

  it('rejects unknown kinds, duplicate nodes and non-finite positions', () => {
    const flow = flowWithRules([graphRule(), emptyRule('rule-2')]);
    const badKind: FlowClipboard = {
      schemaVersion: 1,
      nodes: [{ id: 'node-1', kind: 'weird' as never, x: 0, y: 0 }],
      edges: [],
      variables: [],
      steps: [],
    };
    expect(() => pasteFlowSelection(flow, 'rule-2', badKind)).toThrow('UNKNOWN_KIND');
    const duplicated: FlowClipboard = {
      schemaVersion: 1,
      nodes: [
        { id: 'node-1', kind: 'condition', x: 0, y: 0, stepId: 'step-1' },
        { id: 'node-1', kind: 'action', x: 20, y: 20, stepId: 'step-3' },
      ],
      edges: [],
      variables: [],
      steps: clipboardSteps,
    };
    expect(() => pasteFlowSelection(flow, 'rule-2', duplicated)).toThrow('DUPLICATE_NODE');
    const nanPosition: FlowClipboard = {
      schemaVersion: 1,
      nodes: [{ id: 'node-1', kind: 'condition', x: Number.NaN, y: 0, stepId: 'step-1' }],
      edges: [],
      variables: [],
      steps: clipboardSteps,
    };
    expect(() => pasteFlowSelection(flow, 'rule-2', nanPosition)).toThrow('INVALID_POSITION');
  });

  it('rejects dangling edges, trigger targets, unknown branches and branch mismatches', () => {
    const flow = flowWithRules([graphRule(), emptyRule('rule-2')]);
    const dangling: FlowClipboard = {
      schemaVersion: 1,
      nodes: [{ id: 'node-1', kind: 'condition', x: 0, y: 0, stepId: 'step-1' }],
      edges: [{ id: 'edge-1', from: 'node-1', to: 'node-9', branch: 'true' }],
      variables: [],
      steps: clipboardSteps,
    };
    expect(() => pasteFlowSelection(flow, 'rule-2', dangling)).toThrow('DANGLING_EDGE');
    const triggerTarget: FlowClipboard = {
      schemaVersion: 1,
      nodes: [
        { id: 'node-1', kind: 'trigger', x: 0, y: 0 },
        { id: 'node-2', kind: 'action', x: 200, y: 0, stepId: 'step-3' },
      ],
      edges: [{ id: 'edge-1', from: 'node-2', to: 'node-1', branch: 'default' }],
      variables: [],
      steps: clipboardSteps,
    };
    expect(() => pasteFlowSelection(flow, 'rule-2', triggerTarget)).toThrow('TRIGGER_TARGET');
    const pair = [
      { id: 'node-1', kind: 'condition' as const, x: 0, y: 0, stepId: 'step-1' },
      { id: 'node-2', kind: 'action' as const, x: 200, y: 0, stepId: 'step-3' },
    ];
    const unknownBranch: FlowClipboard = {
      schemaVersion: 1,
      nodes: pair,
      edges: [{ id: 'edge-1', from: 'node-1', to: 'node-2', branch: 'sideways' as never }],
      variables: [],
      steps: clipboardSteps,
    };
    expect(() => pasteFlowSelection(flow, 'rule-2', unknownBranch)).toThrow('UNKNOWN_BRANCH');
    const mismatch: FlowClipboard = {
      schemaVersion: 1,
      nodes: pair,
      edges: [{ id: 'edge-1', from: 'node-1', to: 'node-2', branch: 'default' }],
      variables: [],
      steps: clipboardSteps,
    };
    expect(() => pasteFlowSelection(flow, 'rule-2', mismatch)).toThrow('BRANCH_MISMATCH');
  });

  it('rejects self loops, duplicate edges and cycles inside the clipboard', () => {
    const flow = flowWithRules([graphRule(), emptyRule('rule-2')]);
    const selfLoop: FlowClipboard = {
      schemaVersion: 1,
      nodes: [{ id: 'node-1', kind: 'condition', x: 0, y: 0, stepId: 'step-1' }],
      edges: [{ id: 'edge-1', from: 'node-1', to: 'node-1', branch: 'true' }],
      variables: [],
      steps: clipboardSteps,
    };
    expect(() => pasteFlowSelection(flow, 'rule-2', selfLoop)).toThrow('SELF_LOOP');
    const pair = [
      { id: 'node-1', kind: 'condition' as const, x: 0, y: 0, stepId: 'step-1' },
      { id: 'node-2', kind: 'action' as const, x: 200, y: 0, stepId: 'step-3' },
    ];
    const duplicate: FlowClipboard = {
      schemaVersion: 1,
      nodes: pair,
      edges: [
        { id: 'edge-1', from: 'node-1', to: 'node-2', branch: 'true' },
        { id: 'edge-2', from: 'node-1', to: 'node-2', branch: 'true' },
      ],
      variables: [],
      steps: clipboardSteps,
    };
    expect(() => pasteFlowSelection(flow, 'rule-2', duplicate)).toThrow('DUPLICATE_EDGE');
    const cycle: FlowClipboard = {
      schemaVersion: 1,
      nodes: pair,
      edges: [
        { id: 'edge-1', from: 'node-1', to: 'node-2', branch: 'true' },
        { id: 'edge-2', from: 'node-2', to: 'node-1', branch: 'error' },
      ],
      variables: [],
      steps: clipboardSteps,
    };
    expect(() => pasteFlowSelection(flow, 'rule-2', cycle)).toThrow('CYCLE');
  });

  it('rejects steps and variables that cannot be resolved', () => {
    const flow = flowWithRules([graphRule(), emptyRule('rule-2')]);
    const danglingStep: FlowClipboard = {
      schemaVersion: 1,
      nodes: [{ id: 'node-1', kind: 'condition', x: 0, y: 0, stepId: 'step-missing' }],
      edges: [],
      variables: [],
      steps: [],
    };
    expect(() => pasteFlowSelection(flow, 'rule-2', danglingStep)).toThrow('DANGLING_STEP');
    const badVariable: FlowClipboard = {
      schemaVersion: 1,
      nodes: [{ id: 'node-1', kind: 'trigger', x: 0, y: 0 }],
      edges: [],
      variables: [{ id: 'var-1', name: 'flag', type: 'weird' as never, initial: false }],
      steps: [],
    };
    expect(() => pasteFlowSelection(flow, 'rule-2', badVariable)).toThrow('UNKNOWN_VARIABLE_TYPE');
  });

  it('pastes cleanly after the copied nodes were deleted', () => {
    const rule = graphRule({
      steps: [
        { id: 'step-1', condition: { kind: 'eq', path: 'server.connected', value: true } },
        { id: 'step-3', action: { type: 'toast', message: 'Готово' } },
      ],
      graph: {
        nodes: [
          { id: 'node-1', kind: 'trigger', x: 60, y: 60 },
          { id: 'node-2', kind: 'condition', x: 280, y: 60, stepId: 'step-1' },
          { id: 'node-3', kind: 'action', x: 500, y: 60, stepId: 'step-3' },
        ],
        edges: [
          { id: 'edge-1', from: 'node-1', to: 'node-2', branch: 'default' },
          { id: 'edge-2', from: 'node-2', to: 'node-3', branch: 'true' },
        ],
      },
    });
    const flow = flowWithRules([rule, emptyRule('rule-2')]);
    const clipboard = copyFlowSelection(flow, 'rule-1', ['node-2', 'node-3']);
    const afterDelete = removeFlowNodes(flow, 'rule-1', ['node-3']);
    expect(ruleOf(afterDelete, 'rule-1').steps!.map((step) => step.id)).toEqual(['step-1']);
    const result = pasteFlowSelection(afterDelete, 'rule-2', clipboard);
    const pastedRule = ruleOf(result.flow, 'rule-2');
    expect(pastedRule.graph!.nodes.map((node) => node.kind)).toEqual(['condition', 'action']);
    const action = pastedRule.graph!.nodes.find((node) => node.kind === 'action')!;
    const steps = new Map(pastedRule.steps!.map((step) => [step.id, step]));
    expect(steps.get(action.stepId!)).toMatchObject({ action: { type: 'toast', message: 'Готово' } });
    const sourceStepIds = ruleOf(result.flow, 'rule-1').steps!.map((step) => step.id);
    expect(pastedRule.steps!.map((step) => step.id).some((id) => sourceStepIds.includes(id))).toBe(false);
  });

  it('pastes the copy-time step snapshot instead of post-copy edits', () => {
    const flow = flowWithRules([graphRule(), emptyRule('rule-2')]);
    const clipboard = copyFlowSelection(flow, 'rule-1', ['node-3']);
    const editedFlow = structuredClone(flow);
    const sourceStep = ruleOf(editedFlow, 'rule-1').steps!.find((step) => step.id === 'step-2')!;
    sourceStep.action = { type: 'variable.set', variableId: 'var-2', value: true };
    const result = pasteFlowSelection(editedFlow, 'rule-2', clipboard);
    const pastedRule = ruleOf(result.flow, 'rule-2');
    const pastedNode = pastedRule.graph!.nodes[0];
    const pastedStep = pastedRule.steps!.find((step) => step.id === pastedNode.stepId)!;
    expect(pastedStep.action).toEqual({ type: 'variable.set', variableId: 'var-2', value: false });
    expect(pastedStep.id).not.toBe('step-2');
  });
});

describe('flow canvas clipboard', () => {
  it('pastes a copied selection with fresh ids as one undo step', () => {
    mountCanvas();
    click('[data-action="add-condition"]');
    click('[data-action="add-action"]');
    const nodeId = graphOf().nodes[0].id;
    click(`[data-node-id="${nodeId}"]`);
    keydown(window, 'c', { ctrlKey: true });
    keydown(window, 'v', { ctrlKey: true });
    const nodes = graphOf().nodes;
    expect(nodes).toHaveLength(3);
    expect(nodes.filter((node) => node.kind === 'condition')).toHaveLength(2);
    act(() => { controller.undo(); });
    expect(graphOf().nodes).toHaveLength(2);
  });

  it('copies and pastes a connection together with its nodes', () => {
    mountCanvas();
    click('[data-action="add-condition"]');
    click('[data-action="add-action"]');
    const nodes = graphOf().nodes;
    const condition = nodes.find((node) => node.kind === 'condition')!;
    const action = nodes.find((node) => node.kind === 'action')!;
    const output = host.querySelector<HTMLElement>(`[data-node-id="${condition.id}"] [data-port="out"][data-branch="true"]`)!;
    const input = host.querySelector<HTMLElement>(`[data-node-id="${action.id}"] [data-port="in"]`)!;
    act(() => {
      output.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }));
    });
    act(() => {
      input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    });
    click(`[data-node-id="${condition.id}"]`);
    shiftClick(`[data-node-id="${action.id}"]`);
    keydown(window, 'c', { ctrlKey: true });
    keydown(window, 'v', { ctrlKey: true });
    const after = graphOf();
    expect(after.nodes).toHaveLength(4);
    expect(after.edges).toHaveLength(2);
    const originalIds = new Set([condition.id, action.id]);
    const pastedEdge = after.edges.find((edge) => !originalIds.has(edge.from))!;
    expect(pastedEdge.branch).toBe('true');
    expect(originalIds.has(pastedEdge.to)).toBe(false);
    const pastedNodes = after.nodes.filter((node) => !originalIds.has(node.id));
    expect(pastedNodes).toHaveLength(2);
    expect(pastedEdge.from).toBe(pastedNodes[0].id);
    expect(pastedEdge.to).toBe(pastedNodes[1].id);
  });

  it('does not paste in read-only mode', () => {
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
            nodes: [{ id: 'node-1', kind: 'condition', x: 100, y: 100 }],
            edges: [],
          },
        });
      });
    });
    const beforePaste = JSON.stringify(controller.draft.flow.rules);
    keydown(window, 'v', { ctrlKey: true });
    expect(JSON.stringify(controller.draft.flow.rules)).toBe(beforePaste);
    expect(graphOf().nodes).toHaveLength(1);
  });
});

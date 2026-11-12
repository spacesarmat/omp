import { describe, expect, it } from 'vitest';
import { validateFlowGraph } from '../../design/flow-validation-graph';
import type {
  FlowDocument,
  FlowEdge,
  FlowEdgeBranch,
  FlowGraph,
  FlowNodeKind,
  FlowNodeView,
  FlowVariable,
  InteractionCondition,
  InteractionRule,
} from '../../design/schema';

const BASE = '0'.repeat(40);
const ROUTES = ['library', 'settings'];

function node(id: string, kind: FlowNodeKind, x = 0, y = 0, stepId?: string): FlowNodeView {
  return { id, kind, x, y, ...(stepId ? { stepId } : {}) };
}

function edge(id: string, from: string, to: string, branch: FlowEdgeBranch = 'default'): FlowEdge {
  return { id, from, to, branch };
}

function flowWith(rules: InteractionRule[], variables?: FlowVariable[]): FlowDocument {
  return { schemaVersion: 1, id: 'flow-1', baseCommit: BASE, rules, ...(variables ? { variables } : {}) };
}

// A connected graph: trigger -> condition -> (true: variable.set -> navigate, false: result toast).
function validGraph(): { rule: InteractionRule; graph: FlowGraph } {
  const graph: FlowGraph = {
    nodes: [
      node('t-1', 'trigger'),
      node('c-1', 'condition', 120, 0, 's-check'),
      node('s-1', 'action', 240, 0, 's-set'),
      node('a-1', 'action', 360, 0, 's-go'),
      node('r-1', 'result', 240, 120, 's-stop'),
    ],
    edges: [
      edge('e-tc', 't-1', 'c-1'),
      edge('e-cts', 'c-1', 's-1', 'true'),
      edge('e-ctr', 'c-1', 'r-1', 'false'),
      edge('e-sa', 's-1', 'a-1'),
    ],
  };
  const rule: InteractionRule = {
    id: 'rule-1',
    screenId: 'settings',
    elementId: 'continue-button',
    event: 'click',
    action: { type: 'toast', message: 'ignored in graph mode' },
    steps: [
      { id: 's-check', condition: { kind: 'eq', path: 'server.connected', value: true } },
      { id: 's-set', action: { type: 'variable.set', variableId: 'v-flag', value: true } },
      { id: 's-go', action: { type: 'navigate', screenId: 'library' } },
      { id: 's-stop', action: { type: 'toast', message: 'Stopped' } },
    ],
    graph,
  };
  return { rule, graph };
}

describe('validateFlowGraph', () => {
  it('accepts a connected graph with typed conditions and full route coverage', () => {
    const { rule } = validGraph();
    const flow = flowWith([rule], [{ id: 'v-flag', name: 'Flag', type: 'boolean', initial: false }]);
    expect(validateFlowGraph(flow, ROUTES)).toEqual([]);
  });

  it('rejects ambiguous branch destination', () => {
    const { rule, graph } = validGraph();
    graph.edges.push(edge('e-ta', 't-1', 'a-1'));
    const flow = flowWith([rule], [{ id: 'v-flag', name: 'Flag', type: 'boolean', initial: false }]);
    expect(validateFlowGraph(flow, ROUTES)).toContainEqual(
      expect.objectContaining({ code: 'AMBIGUOUS_BRANCH', ruleId: 'rule-1', nodeId: 't-1' }),
    );
  });

  it('rejects self-loop edges', () => {
    const { rule, graph } = validGraph();
    graph.edges.push(edge('e-loop', 'c-1', 'c-1', 'true'));
    const flow = flowWith([rule], [{ id: 'v-flag', name: 'Flag', type: 'boolean', initial: false }]);
    expect(validateFlowGraph(flow, ROUTES)).toContainEqual(
      expect.objectContaining({ code: 'SELF_LOOP', ruleId: 'rule-1', edgeId: 'e-loop' }),
    );
  });

  it('rejects cycle in the graph', () => {
    const { rule, graph } = validGraph();
    graph.edges.push(edge('e-back', 'a-1', 'c-1', 'error'));
    const flow = flowWith([rule], [{ id: 'v-flag', name: 'Flag', type: 'boolean', initial: false }]);
    expect(validateFlowGraph(flow, ROUTES)).toContainEqual(
      expect.objectContaining({ code: 'CYCLE', ruleId: 'rule-1' }),
    );
  });

  it('rejects edges referencing a missing node', () => {
    const { rule, graph } = validGraph();
    graph.edges.push(edge('e-ghost', 'a-1', 'ghost'));
    const flow = flowWith([rule], [{ id: 'v-flag', name: 'Flag', type: 'boolean', initial: false }]);
    expect(validateFlowGraph(flow, ROUTES)).toContainEqual(
      expect.objectContaining({ code: 'MISSING_NODE', ruleId: 'rule-1', edgeId: 'e-ghost' }),
    );
  });

  it('rejects wrong value types in conditions and variable.set', () => {
    const { rule } = validGraph();
    rule.steps = [
      { id: 's-check', condition: { kind: 'gt', path: 'server.connected', value: 'many' } },
      { id: 's-set', action: { type: 'variable.set', variableId: 'v-count', value: 'ten' } },
      { id: 's-go', action: { type: 'navigate', screenId: 'library' } },
      { id: 's-stop', action: { type: 'toast', message: 'Stopped' } },
    ];
    const flow = flowWith([rule], [{ id: 'v-count', name: 'Count', type: 'number', initial: 0 }]);
    const issues = validateFlowGraph(flow, ROUTES);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'WRONG_VALUE_TYPE', ruleId: 'rule-1', nodeId: 'c-1' }));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'WRONG_VALUE_TYPE', ruleId: 'rule-1', nodeId: 's-1' }));
  });

  it('rejects an unreachable result node', () => {
    const { rule, graph } = validGraph();
    graph.nodes.push(node('r-2', 'result', 480, 120, 's-stop'));
    const flow = flowWith([rule], [{ id: 'v-flag', name: 'Flag', type: 'boolean', initial: false }]);
    expect(validateFlowGraph(flow, ROUTES)).toContainEqual(
      expect.objectContaining({ code: 'UNREACHABLE_NODE', ruleId: 'rule-1', nodeId: 'r-2' }),
    );
  });

  it('rejects a trigger without a path to a result or terminal action', () => {
    const graph: FlowGraph = {
      nodes: [node('t-1', 'trigger'), node('a-1', 'action', 120, 0, 's-note')],
      edges: [edge('e-ta', 't-1', 'a-1')],
    };
    const rule: InteractionRule = {
      id: 'rule-1',
      screenId: 'settings',
      elementId: 'continue-button',
      event: 'click',
      action: { type: 'toast', message: 'ignored in graph mode' },
      steps: [{ id: 's-note', action: { type: 'toast', message: 'Note' } }],
      graph,
    };
    expect(validateFlowGraph(flowWith([rule]), ROUTES)).toContainEqual(
      expect.objectContaining({ code: 'NO_TERMINAL_PATH', ruleId: 'rule-1', nodeId: 't-1' }),
    );
  });

  it('rejects a new-action rule without steps or a graph as dead', () => {
    const rule: InteractionRule = {
      id: 'rule-1',
      screenId: 'settings',
      elementId: 'continue-button',
      event: 'click',
      action: { type: 'dialog', title: 'Title', message: 'Message' },
    };
    const flow = flowWith([rule]);
    expect(validateFlowGraph(flow, ROUTES)).toContainEqual(
      expect.objectContaining({ code: 'DEAD_RULE', ruleId: 'rule-1' }),
    );
  });

  it('accepts legacy-style rules without steps or a graph', () => {
    const rule: InteractionRule = {
      id: 'rule-1',
      screenId: 'settings',
      elementId: 'continue-button',
      event: 'click',
      action: { type: 'navigate', screenId: 'library' },
    };
    expect(validateFlowGraph(flowWith([rule]), ROUTES)).toEqual([]);
  });

  it('rejects unknown routes in graph step actions', () => {
    const { rule, graph } = validGraph();
    graph.edges = graph.edges.filter((entry) => entry.id !== 'e-sa');
    rule.steps = (rule.steps ?? []).map((step) =>
      step.id === 's-go' ? { ...step, action: { type: 'navigate', screenId: 'nowhere' } } : step,
    );
    const flow = flowWith([rule], [{ id: 'v-flag', name: 'Flag', type: 'boolean', initial: false }]);
    expect(validateFlowGraph(flow, ROUTES)).toContainEqual(
      expect.objectContaining({ code: 'UNKNOWN_ROUTE', ruleId: 'rule-1', nodeId: 'a-1' }),
    );
  });

  it('rejects empty toast and dialog messages', () => {
    const graph: FlowGraph = {
      nodes: [node('t-1', 'trigger'), node('a-1', 'action', 120, 0, 's-note'), node('a-2', 'action', 240, 0, 's-ask')],
      edges: [edge('e-t1', 't-1', 'a-1'), edge('e-12', 'a-1', 'a-2')],
    };
    const rule: InteractionRule = {
      id: 'rule-1',
      screenId: 'settings',
      elementId: 'continue-button',
      event: 'click',
      action: { type: 'toast', message: 'ignored in graph mode' },
      steps: [
        { id: 's-note', action: { type: 'toast', message: '  ' } },
        { id: 's-ask', action: { type: 'dialog', title: '', message: 'Message' } },
      ],
      graph,
    };
    const issues = validateFlowGraph(flowWith([rule]), ROUTES);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'EMPTY_MESSAGE', nodeId: 'a-1' }));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'EMPTY_MESSAGE', nodeId: 'a-2' }));
  });

  it('rejects variable conditions with mismatched value types', () => {
    const condition: InteractionCondition = { kind: 'eq', path: 'variable.v-count', value: true };
    const rule: InteractionRule = {
      id: 'rule-1',
      screenId: 'settings',
      elementId: 'continue-button',
      event: 'click',
      condition,
      action: { type: 'navigate', screenId: 'library' },
    };
    const flow = flowWith([rule], [{ id: 'v-count', name: 'Count', type: 'number', initial: 0 }]);
    expect(validateFlowGraph(flow, ROUTES)).toContainEqual(
      expect.objectContaining({ code: 'WRONG_VALUE_TYPE', ruleId: 'rule-1' }),
    );
  });

  it('rejects a graph without a trigger node', () => {
    const graph: FlowGraph = {
      nodes: [node('a-1', 'action', 120, 0, 's-go')],
      edges: [],
    };
    const rule: InteractionRule = {
      id: 'rule-1',
      screenId: 'settings',
      elementId: 'continue-button',
      event: 'click',
      action: { type: 'toast', message: 'ignored in graph mode' },
      steps: [{ id: 's-go', action: { type: 'navigate', screenId: 'library' } }],
      graph,
    };
    expect(validateFlowGraph(flowWith([rule]), ROUTES)).toContainEqual(
      expect.objectContaining({ code: 'NO_TRIGGER', ruleId: 'rule-1' }),
    );
  });

  it('rejects multiple trigger nodes in one graph', () => {
    const graph: FlowGraph = {
      nodes: [node('t-1', 'trigger'), node('t-2', 'trigger', 0, 120), node('a-1', 'action', 240, 0, 's-go')],
      edges: [edge('e-ta', 't-1', 'a-1')],
    };
    const rule: InteractionRule = {
      id: 'rule-1',
      screenId: 'settings',
      elementId: 'continue-button',
      event: 'click',
      action: { type: 'toast', message: 'ignored in graph mode' },
      steps: [{ id: 's-go', action: { type: 'navigate', screenId: 'library' } }],
      graph,
    };
    expect(validateFlowGraph(flowWith([rule]), ROUTES)).toContainEqual(
      expect.objectContaining({ code: 'MULTIPLE_TRIGGERS', ruleId: 'rule-1', nodeId: 't-2' }),
    );
  });

  it('rejects conditions and variable.set referencing undeclared variables', () => {
    const condition: InteractionCondition = {
      kind: 'all',
      conditions: [
        {
          kind: 'any',
          conditions: [
            { kind: 'not', condition: { kind: 'eq', path: 'variable.v-missing', value: true } },
            { kind: 'exists', path: 'variable.v-other' },
          ],
        },
        { kind: 'eq', path: 'server.connected', value: true },
      ],
    };
    const rule: InteractionRule = {
      id: 'rule-1',
      screenId: 'settings',
      elementId: 'continue-button',
      event: 'click',
      condition,
      action: { type: 'variable.set', variableId: 'v-absent', value: 1 },
    };
    const issues = validateFlowGraph(flowWith([rule]), ROUTES);
    const unknown = issues.filter((entry) => entry.code === 'UNKNOWN_VARIABLE');
    expect(unknown).toHaveLength(3);
    expect(unknown.every((entry) => entry.ruleId === 'rule-1')).toBe(true);
  });

  it('accepts documented context paths and declared variables in conditions', () => {
    const condition: InteractionCondition = {
      kind: 'all',
      conditions: [
        { kind: 'eq', path: 'server.connected', value: true },
        { kind: 'exists', path: 'network.online' },
        { kind: 'neq', path: 'screen.current', value: 'library' },
        { kind: 'exists', path: 'variable.v-flag' },
      ],
    };
    const rule: InteractionRule = {
      id: 'rule-1',
      screenId: 'settings',
      elementId: 'continue-button',
      event: 'click',
      condition,
      action: { type: 'navigate', screenId: 'library' },
    };
    const flow = flowWith([rule], [{ id: 'v-flag', name: 'Flag', type: 'boolean', initial: false }]);
    expect(validateFlowGraph(flow, ROUTES)).toEqual([]);
  });
});

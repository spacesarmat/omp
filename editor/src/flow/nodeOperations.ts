import type {
  FlowDocument,
  FlowEdge,
  FlowEdgeBranch,
  FlowGraph,
  FlowNodeKind,
  FlowNodeView,
  InteractionRule,
  InteractionStep,
} from '../../../design/schema.ts';
import { TERMINAL_ACTIONS } from '../../../design/flow-graph.ts';

// Node operations are pure FlowDocument -> FlowDocument transforms. The canvas wraps each
// operation in exactly one controller.update, so one edit is one undo step. Legacy rules
// without a graph are never touched: the canvas only edits rules that already own a graph
// or creates a new screen.enter rule, which the legacy click dispatcher never matches.
export class FlowOperationError extends Error {
  readonly code: 'SELF_LOOP' | 'TRIGGER_TARGET' | 'RESULT_SOURCE' | 'DUPLICATE_EDGE' | 'CYCLE' | 'BRANCH_MISMATCH' | 'UNKNOWN_NODE' | 'NO_GRAPH_RULE' | 'NO_TRIGGER' | 'MULTIPLE_TRIGGERS' | 'UNREACHABLE_NODE' | 'NO_TERMINAL_PATH';

  constructor(code: FlowOperationError['code'], message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

export interface FlowPosition {
  x: number;
  y: number;
}

export interface FlowNodeRef {
  flow: FlowDocument;
  ruleId: string;
  nodeId: string;
}

const NODE_SIZE = { width: 176, height: 64 };
export const FLOW_COLUMN_WIDTH = 220;
export const FLOW_ROW_HEIGHT = 120;

function ruleOf(flow: FlowDocument, ruleId: string): InteractionRule {
  const rule = flow.rules.find((entry) => entry.id === ruleId);
  if (!rule) throw new FlowOperationError('NO_GRAPH_RULE', `rule ${ruleId} not found`);
  return rule;
}

function graphOf(rule: InteractionRule): FlowGraph {
  return rule.graph ?? { nodes: [], edges: [] };
}

function uniqueId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let index = used.size + 1;
  let id = `${prefix}-${index}`;
  while (used.has(id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
}

function flowNodeIds(flow: FlowDocument): string[] {
  return flow.rules.flatMap((rule) => rule.graph?.nodes.map((node) => node.id) ?? []);
}

function flowStepIds(flow: FlowDocument): string[] {
  return flow.rules.flatMap((rule) => rule.steps?.map((step) => step.id) ?? []);
}

// Creates an editable graph rule for the screen. The placeholder terminal action keeps the
// document schema-valid; behavior comes from the graph and its steps, not from this action.
function ensureGraphRule(flow: FlowDocument, screenId: string): { flow: FlowDocument; ruleId: string } {
  const existing = flow.rules.find((rule) => rule.screenId === screenId && rule.graph);
  if (existing) return { flow, ruleId: existing.id };
  const ruleId = uniqueId(`flow-${screenId}`, flow.rules.map((rule) => rule.id));
  const rule: InteractionRule = {
    id: ruleId,
    screenId,
    elementId: 'flow-canvas',
    event: 'screen.enter',
    action: { type: 'back' },
    steps: [],
    graph: { nodes: [], edges: [] },
  };
  return { flow: { ...flow, rules: flow.rules.concat(rule) }, ruleId };
}

function withGraph(flow: FlowDocument, ruleId: string, graph: FlowGraph): FlowDocument {
  return {
    ...flow,
    rules: flow.rules.map((rule) => (rule.id === ruleId ? { ...rule, graph } : rule)),
  };
}

export function addFlowNode(
  flow: FlowDocument,
  screenId: string,
  kind: FlowNodeKind,
  position?: FlowPosition,
  options: { ruleId?: string } = {},
): FlowNodeRef {
  // The canvas may target a chosen graph rule of the screen (rule selector); anything else
  // falls back to the first graph rule or a fresh rule, exactly like before.
  const chosen = options.ruleId
    ? flow.rules.find((rule) => rule.id === options.ruleId && rule.screenId === screenId && rule.graph)
    : undefined;
  const ensured = chosen ? { flow, ruleId: chosen.id } : ensureGraphRule(flow, screenId);
  const rule = ruleOf(ensured.flow, ensured.ruleId);
  const graph = graphOf(rule);
  if (kind === 'trigger' && graph.nodes.some((node) => node.kind === 'trigger')) {
    throw new FlowOperationError('MULTIPLE_TRIGGERS', 'rule graph already has a trigger node');
  }
  const nodeId = uniqueId('node', flowNodeIds(ensured.flow));
  const offset = graph.nodes.length * 36;
  const node: FlowNodeView = {
    id: nodeId,
    kind,
    ruleId: ensured.ruleId,
    x: Math.round(position?.x ?? 80 + offset),
    y: Math.round(position?.y ?? 80 + offset),
  };
  if (kind === 'condition' || kind === 'action') {
    node.stepId = uniqueId('step', flowStepIds(ensured.flow));
  }
  const nextGraph = { nodes: graph.nodes.concat(node), edges: graph.edges };
  let nextFlow = withGraph(ensured.flow, ensured.ruleId, nextGraph);
  if (node.stepId) {
    nextFlow = {
      ...nextFlow,
      rules: nextFlow.rules.map((entry) => {
        if (entry.id !== ensured.ruleId) return entry;
        const step = node.kind === 'condition'
          ? { id: node.stepId!, condition: { kind: 'eq' as const, path: 'server.connected' as const, value: true } }
          : { id: node.stepId!, action: { type: 'toast' as const, message: 'Сообщение' } };
        return { ...entry, steps: [...(entry.steps ?? []), step] };
      }),
    };
  }
  return { flow: nextFlow, ruleId: ensured.ruleId, nodeId };
}

export function moveFlowNode(flow: FlowDocument, ruleId: string, nodeId: string, position: FlowPosition): FlowDocument {
  const rule = ruleOf(flow, ruleId);
  const graph = graphOf(rule);
  if (!graph.nodes.some((node) => node.id === nodeId)) {
    throw new FlowOperationError('UNKNOWN_NODE', `node ${nodeId} not found`);
  }
  return withGraph(flow, ruleId, {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === nodeId ? { ...node, x: Math.round(position.x), y: Math.round(position.y) } : node)),
  });
}

export const OUTPUT_BRANCHES: Record<FlowNodeKind, FlowEdgeBranch[]> = {
  trigger: ['default'],
  condition: ['true', 'false'],
  action: ['default', 'error'],
  result: [],
};

export function defaultBranchFor(kind: FlowNodeKind): FlowEdgeBranch {
  return kind === 'condition' ? 'true' : 'default';
}

function wouldReach(edges: FlowEdge[], from: string, target: string, visited: Set<string>): boolean {
  if (from === target) return true;
  if (visited.has(from)) return false;
  visited.add(from);
  return edges.filter((edge) => edge.from === from).some((edge) => wouldReach(edges, edge.to, target, visited));
}

export function connectFlowNodes(
  flow: FlowDocument,
  ruleId: string,
  fromId: string,
  toId: string,
  branch?: FlowEdgeBranch,
): { flow: FlowDocument; edgeId: string } {
  const rule = ruleOf(flow, ruleId);
  const graph = graphOf(rule);
  const from = graph.nodes.find((node) => node.id === fromId);
  const to = graph.nodes.find((node) => node.id === toId);
  if (!from || !to) throw new FlowOperationError('UNKNOWN_NODE', 'connection endpoint missing');
  if (fromId === toId) throw new FlowOperationError('SELF_LOOP', 'connection would loop into the same node');
  if (to.kind === 'trigger') throw new FlowOperationError('TRIGGER_TARGET', 'trigger cannot have incoming connections');
  const resolvedBranch = branch ?? defaultBranchFor(from.kind);
  if (!OUTPUT_BRANCHES[from.kind].includes(resolvedBranch)) {
    throw new FlowOperationError('BRANCH_MISMATCH', `branch ${resolvedBranch} is not an output of ${from.kind}`);
  }
  if (graph.edges.some((edge) => edge.from === fromId && edge.to === toId && edge.branch === resolvedBranch)) {
    throw new FlowOperationError('DUPLICATE_EDGE', 'identical connection already exists');
  }
  if (wouldReach(graph.edges, toId, fromId, new Set())) {
    throw new FlowOperationError('CYCLE', 'connection would create a cycle in the flow');
  }
  const edge: FlowEdge = { id: uniqueId('edge', graph.edges.map((entry) => entry.id)), from: fromId, to: toId, branch: resolvedBranch };
  return { flow: withGraph(flow, ruleId, { ...graph, edges: graph.edges.concat(edge) }), edgeId: edge.id };
}

function reachableFrom(nodes: FlowNodeView[], edges: FlowEdge[], roots: FlowNodeView[]): Set<string> {
  const reachable = new Set<string>();
  const queue = roots.map((node) => node.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const edge of edges.filter((entry) => entry.from === id)) queue.push(edge.to);
  }
  return reachable;
}

// Mirrors the NO_TERMINAL_PATH rule of validateFlowGraph: some node reachable from a trigger
// must be a result or carry a terminal action.
function hasTerminalPath(nodes: FlowNodeView[], edges: FlowEdge[], steps: ReadonlyMap<string, InteractionStep>): boolean {
  const triggers = nodes.filter((node) => node.kind === 'trigger');
  if (!triggers.length) return false;
  const reachable = reachableFrom(nodes, edges, triggers);
  return [...reachable].some((id) => {
    const node = nodes.find((entry) => entry.id === id);
    if (!node) return false;
    if (node.kind === 'result') return true;
    if (!node.stepId) return false;
    const action = steps.get(node.stepId)?.action;
    return Boolean(action && TERMINAL_ACTIONS.has(action.type));
  });
}

export function removeFlowNodes(flow: FlowDocument, ruleId: string, nodeIds: string[]): FlowDocument {
  const rule = ruleOf(flow, ruleId);
  const graph = graphOf(rule);
  const removed = new Set(nodeIds);
  const nodes = graph.nodes.filter((node) => !removed.has(node.id));
  const edges = graph.edges.filter((edge) => !removed.has(edge.from) && !removed.has(edge.to));
  // Deleting the last node deletes the containing rule: an empty graph rule is invalid
  // (NO_TRIGGER at validation), and one undo restores rule, nodes and steps together.
  if (nodes.length === 0) {
    return { ...flow, rules: flow.rules.filter((entry) => entry.id !== ruleId) };
  }
  // Removing the last trigger strands every remaining node, and dropping a middle node can
  // orphan nodes that were reachable before. Refuse both instead of writing an invalid graph.
  if (graph.nodes.some((node) => removed.has(node.id) && node.kind === 'trigger')) {
    throw new FlowOperationError('NO_TRIGGER', 'rule graph requires its trigger node');
  }
  const triggersBefore = graph.nodes.filter((node) => node.kind === 'trigger');
  if (triggersBefore.length) {
    const before = reachableFrom(graph.nodes, graph.edges, triggersBefore);
    const after = reachableFrom(nodes, edges, nodes.filter((node) => node.kind === 'trigger'));
    const orphaned = nodes.find((node) => before.has(node.id) && !after.has(node.id));
    if (orphaned) {
      throw new FlowOperationError('UNREACHABLE_NODE', `removing the node orphans ${orphaned.id}`);
    }
  }
  const stepsById = new Map((rule.steps ?? []).map((step) => [step.id, step]));
  if (
    hasTerminalPath(graph.nodes, graph.edges, stepsById)
    && nodes.some((node) => node.kind === 'trigger')
    && !hasTerminalPath(nodes, edges, stepsById)
  ) {
    throw new FlowOperationError('NO_TERMINAL_PATH', 'removing the node leaves no path to a result or terminal action');
  }
  const keptStepIds = new Set(nodes.map((node) => node.stepId).filter((stepId): stepId is string => Boolean(stepId)));
  const steps = (rule.steps ?? []).filter((step) => keptStepIds.has(step.id));
  const nextRule: InteractionRule = { ...rule, graph: { nodes, edges }, steps };
  return { ...flow, rules: flow.rules.map((entry) => (entry.id === ruleId ? nextRule : entry)) };
}

// Depth columns from the trigger (or from roots without incoming edges); unconnected nodes
// are appended after the last column. Positions never affect execution.
export function autoLayoutFlow(flow: FlowDocument, ruleId: string): FlowDocument {
  const rule = ruleOf(flow, ruleId);
  const graph = graphOf(rule);
  const incoming = new Map<string, number>();
  for (const edge of graph.edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  const roots = graph.nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0);
  const depth = new Map<string, number>();
  const queue = roots.map((node) => ({ id: node.id, depth: 0 }));
  while (queue.length) {
    const current = queue.shift()!;
    if ((depth.get(current.id) ?? -1) >= current.depth) continue;
    depth.set(current.id, current.depth);
    for (const edge of graph.edges.filter((entry) => entry.from === current.id)) {
      queue.push({ id: edge.to, depth: current.depth + 1 });
    }
  }
  let maxDepth = -1;
  for (const value of depth.values()) maxDepth = Math.max(maxDepth, value);
  const columns = new Map<number, number>();
  const nodes = graph.nodes.map((node) => {
    const column = depth.get(node.id) ?? maxDepth + 1;
    const row = columns.get(column) ?? 0;
    columns.set(column, row + 1);
    return { ...node, x: column * FLOW_COLUMN_WIDTH + 60, y: row * FLOW_ROW_HEIGHT + 60 };
  });
  return withGraph(flow, ruleId, { ...graph, nodes });
}

export function flowNodeSize(kind: FlowNodeKind): { width: number; height: number } {
  void kind;
  return { ...NODE_SIZE };
}

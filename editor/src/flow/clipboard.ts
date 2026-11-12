import type {
  FlowDocument,
  FlowEdge,
  FlowEdgeBranch,
  FlowNodeView,
  FlowVariable,
  InteractionCondition,
  InteractionRule,
  InteractionStep,
} from '../../../design/schema.ts';
import { FLOW_EDGE_BRANCHES, FLOW_NODE_KINDS, FLOW_VARIABLE_TYPES } from '../../../design/schema.ts';
import { FlowOperationError, OUTPUT_BRANCHES, type FlowPosition } from './nodeOperations.ts';

export const FLOW_CLIPBOARD_SCHEMA_VERSION = 1;
const PASTE_OFFSET = 48;

// Clipboard payload between copy and paste. Nodes keep their stepId and source ruleId so
// paste can resolve the behavior steps; every pasted node, edge and step still gets a fresh
// id, so one clipboard can be pasted many times without collisions.
export interface FlowClipboard {
  schemaVersion: 1;
  nodes: FlowNodeView[];
  edges: FlowEdge[];
  variables: FlowVariable[];
}

export type FlowClipboardErrorCode =
  | 'SCHEMA_VERSION'
  | 'SHAPE'
  | 'EMPTY_SELECTION'
  | 'UNKNOWN_NODE'
  | 'UNKNOWN_KIND'
  | 'DUPLICATE_NODE'
  | 'INVALID_POSITION'
  | 'DANGLING_EDGE'
  | 'TRIGGER_TARGET'
  | 'UNKNOWN_BRANCH'
  | 'BRANCH_MISMATCH'
  | 'SELF_LOOP'
  | 'DUPLICATE_EDGE'
  | 'CYCLE'
  | 'DANGLING_STEP'
  | 'UNKNOWN_VARIABLE_TYPE'
  | 'DUPLICATE_VARIABLE'
  | 'MULTIPLE_TRIGGERS';

export class FlowClipboardError extends Error {
  readonly code: FlowClipboardErrorCode;

  constructor(code: FlowClipboardErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

function freshId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let index = used.size + 1;
  let id = `${prefix}-${index}`;
  while (used.has(id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
}

function allFlowNodeIds(flow: FlowDocument): string[] {
  return flow.rules.flatMap((rule) => rule.graph?.nodes.map((node) => node.id) ?? []);
}

function allFlowStepIds(flow: FlowDocument): string[] {
  return flow.rules.flatMap((rule) => rule.steps?.map((step) => step.id) ?? []);
}

function ruleOf(flow: FlowDocument, ruleId: string): InteractionRule {
  const rule = flow.rules.find((entry) => entry.id === ruleId);
  if (!rule) throw new FlowOperationError('NO_GRAPH_RULE', `rule ${ruleId} not found`);
  return rule;
}

function collectConditionVariables(condition: InteractionCondition, into: Set<string>): void {
  if ('path' in condition && condition.path.startsWith('variable.')) into.add(condition.path.slice('variable.'.length));
  if ('conditions' in condition) for (const entry of condition.conditions) collectConditionVariables(entry, into);
  if ('condition' in condition) collectConditionVariables(condition.condition, into);
}

function stepVariableIds(step: InteractionStep): string[] {
  const ids = new Set<string>();
  if (step.condition) collectConditionVariables(step.condition, ids);
  if (step.action?.type === 'variable.set') ids.add(step.action.variableId);
  return [...ids];
}

// Copies the selected nodes in graph order. Only edges whose both endpoints stay inside the
// selection are kept, so the clipboard can never hold dangling references, and only variables
// referenced by copied steps ride along.
export function copyFlowSelection(flow: FlowDocument, ruleId: string, nodeIds: string[]): FlowClipboard {
  const rule = ruleOf(flow, ruleId);
  const graph = rule.graph ?? { nodes: [], edges: [] };
  if (nodeIds.length === 0) throw new FlowClipboardError('EMPTY_SELECTION', 'nothing to copy');
  const wanted = new Set(nodeIds);
  for (const nodeId of wanted) {
    if (!graph.nodes.some((node) => node.id === nodeId)) {
      throw new FlowClipboardError('UNKNOWN_NODE', `node ${nodeId} not in rule ${ruleId}`);
    }
  }
  const nodes = graph.nodes
    .filter((node) => wanted.has(node.id))
    .map((node) => ({ ...node }));
  const edges = graph.edges
    .filter((edge) => wanted.has(edge.from) && wanted.has(edge.to))
    .map((edge) => ({ ...edge }));
  const stepsById = new Map((rule.steps ?? []).map((step) => [step.id, step]));
  const variableIds = new Set<string>();
  for (const node of nodes) {
    if (!node.stepId) continue;
    const step = stepsById.get(node.stepId);
    if (step) for (const id of stepVariableIds(step)) variableIds.add(id);
  }
  const variables = (flow.variables ?? []).filter((variable) => variableIds.has(variable.id));
  return { schemaVersion: FLOW_CLIPBOARD_SCHEMA_VERSION, nodes, edges, variables };
}

function wouldReach(edges: FlowEdge[], from: string, target: string, visited: Set<string>): boolean {
  if (from === target) return true;
  if (visited.has(from)) return false;
  visited.add(from);
  return edges.filter((edge) => edge.from === from).some((edge) => wouldReach(edges, edge.to, target, visited));
}

// Validates the clipboard payload itself before touching the document: schema version,
// shapes, node kinds and positions, and every edge invariant the graph rules enforce
// (dangling endpoints, branch compatibility, self loops, duplicates, cycles).
function assertValidClipboard(clipboard: FlowClipboard): void {
  if (!clipboard || typeof clipboard !== 'object') {
    throw new FlowClipboardError('SHAPE', 'clipboard is not an object');
  }
  if (clipboard.schemaVersion !== FLOW_CLIPBOARD_SCHEMA_VERSION) {
    throw new FlowClipboardError('SCHEMA_VERSION', `expected schemaVersion 1, got ${String(clipboard.schemaVersion)}`);
  }
  if (!Array.isArray(clipboard.nodes) || !Array.isArray(clipboard.edges) || !Array.isArray(clipboard.variables)) {
    throw new FlowClipboardError('SHAPE', 'nodes, edges and variables must be arrays');
  }
  const nodeKinds = new Map<string, FlowNodeView['kind']>();
  const nodeIds = new Set<string>();
  for (const node of clipboard.nodes) {
    if (!node || typeof node !== 'object' || !FLOW_NODE_KINDS.includes(node.kind)) {
      throw new FlowClipboardError('UNKNOWN_KIND', `unknown node kind ${String((node as FlowNodeView | null)?.kind)}`);
    }
    if (nodeIds.has(node.id)) throw new FlowClipboardError('DUPLICATE_NODE', `node ${node.id} repeats in the clipboard`);
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      throw new FlowClipboardError('INVALID_POSITION', `node ${node.id} has a non-finite position`);
    }
    nodeIds.add(node.id);
    nodeKinds.set(node.id, node.kind);
    if ((node.kind === 'condition' || node.kind === 'action') && !node.stepId) {
      throw new FlowClipboardError('DANGLING_STEP', `node ${node.id} has no step to paste`);
    }
  }
  if (clipboard.nodes.filter((node) => node.kind === 'trigger').length > 1) {
    throw new FlowClipboardError('MULTIPLE_TRIGGERS', 'clipboard carries more than one trigger');
  }
  const edgeKeys = new Set<string>();
  for (const edge of clipboard.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new FlowClipboardError('DANGLING_EDGE', `edge ${edge.id} references a node outside the clipboard`);
    }
    if (edge.from === edge.to) throw new FlowClipboardError('SELF_LOOP', `edge ${edge.id} loops into its own node`);
    if (nodeKinds.get(edge.to) === 'trigger') {
      throw new FlowClipboardError('TRIGGER_TARGET', `edge ${edge.id} enters a trigger node`);
    }
    if (!FLOW_EDGE_BRANCHES.includes(edge.branch)) {
      throw new FlowClipboardError('UNKNOWN_BRANCH', `unknown branch ${String(edge.branch)}`);
    }
    if (!OUTPUT_BRANCHES[nodeKinds.get(edge.from)!].includes(edge.branch)) {
      throw new FlowClipboardError('BRANCH_MISMATCH', `branch ${edge.branch} is not an output of ${nodeKinds.get(edge.from)}`);
    }
    const key = `${edge.from}->${edge.to}:${edge.branch}`;
    if (edgeKeys.has(key)) throw new FlowClipboardError('DUPLICATE_EDGE', `edge ${key} repeats in the clipboard`);
    edgeKeys.add(key);
    if (wouldReach(clipboard.edges, edge.to, edge.from, new Set())) {
      throw new FlowClipboardError('CYCLE', `edge ${edge.id} would create a cycle`);
    }
  }
  const variableIds = new Set<string>();
  for (const variable of clipboard.variables) {
    if (!variable || !FLOW_VARIABLE_TYPES.includes(variable.type)) {
      throw new FlowClipboardError('UNKNOWN_VARIABLE_TYPE', `unknown variable type ${String((variable as FlowVariable | null)?.type)}`);
    }
    if (variableIds.has(variable.id)) {
      throw new FlowClipboardError('DUPLICATE_VARIABLE', `variable ${variable.id} repeats in the clipboard`);
    }
    variableIds.add(variable.id);
  }
}

export interface FlowPasteResult {
  flow: FlowDocument;
  ruleId: string;
  nodeIds: string[];
}

// Pastes a validated clipboard into the target rule with fresh ids for nodes, edges and
// steps. Variables are reused by id when the document already declares them and appended
// otherwise, so pasted steps never dangle. Positions shift by a small offset by default or
// anchor the copied bounding box to `at` when the canvas passes a drop point.
export function pasteFlowSelection(
  flow: FlowDocument,
  ruleId: string,
  clipboard: FlowClipboard,
  options: { at?: FlowPosition } = {},
): FlowPasteResult {
  assertValidClipboard(clipboard);
  const rule = ruleOf(flow, ruleId);
  const graph = rule.graph ?? { nodes: [], edges: [] };
  const pastedTrigger = clipboard.nodes.find((node) => node.kind === 'trigger');
  if (pastedTrigger && graph.nodes.some((node) => node.kind === 'trigger')) {
    throw new FlowOperationError('MULTIPLE_TRIGGERS', `rule ${ruleId} already has a trigger node`);
  }
  const stepsById = new Map(flow.rules.flatMap((entry) => (entry.steps ?? []).map((step) => [step.id, step])));
  for (const node of clipboard.nodes) {
    if (!node.stepId) continue;
    if (!stepsById.has(node.stepId)) {
      throw new FlowClipboardError('DANGLING_STEP', `step ${node.stepId} of node ${node.id} not found in the document`);
    }
  }
  let minX = Infinity;
  let minY = Infinity;
  for (const node of clipboard.nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
  }
  const offset = options.at
    ? { x: options.at.x - minX, y: options.at.y - minY }
    : { x: PASTE_OFFSET, y: PASTE_OFFSET };
  const takenNodeIds = allFlowNodeIds(flow);
  const takenStepIds = allFlowStepIds(flow);
  const takenEdgeIds = graph.edges.map((edge) => edge.id);
  const idByNodeId = new Map<string, string>();
  for (const node of clipboard.nodes) {
    const fresh = freshId('node', takenNodeIds);
    takenNodeIds.push(fresh);
    idByNodeId.set(node.id, fresh);
  }
  const stepIdByOldId = new Map<string, string>();
  for (const node of clipboard.nodes) {
    if (!node.stepId || stepIdByOldId.has(node.stepId)) continue;
    const fresh = freshId('step', takenStepIds);
    takenStepIds.push(fresh);
    stepIdByOldId.set(node.stepId, fresh);
  }
  const nodes: FlowNodeView[] = clipboard.nodes.map((node) => ({
    id: idByNodeId.get(node.id)!,
    kind: node.kind,
    ruleId,
    stepId: node.stepId ? stepIdByOldId.get(node.stepId) : undefined,
    x: Math.round(node.x + offset.x),
    y: Math.round(node.y + offset.y),
    label: node.label,
  }));
  const edges: FlowEdge[] = clipboard.edges.map((edge) => {
    const fresh = freshId('edge', takenEdgeIds);
    takenEdgeIds.push(fresh);
    return { id: fresh, from: idByNodeId.get(edge.from)!, to: idByNodeId.get(edge.to)!, branch: edge.branch as FlowEdgeBranch };
  });
  const pastedSteps: InteractionStep[] = clipboard.nodes
    .filter((node) => node.stepId)
    .map((node) => ({ ...structuredClone(stepsById.get(node.stepId!)!), id: stepIdByOldId.get(node.stepId!)! }));
  const knownVariableIds = new Set((flow.variables ?? []).map((variable) => variable.id));
  const missingVariables = clipboard.variables.filter((variable) => !knownVariableIds.has(variable.id));
  const nextRule: InteractionRule = {
    ...rule,
    graph: { nodes: [...graph.nodes, ...nodes], edges: [...graph.edges, ...edges] },
    steps: [...(rule.steps ?? []), ...pastedSteps],
  };
  return {
    flow: {
      ...flow,
      rules: flow.rules.map((entry) => (entry.id === ruleId ? nextRule : entry)),
      variables: missingVariables.length ? [...(flow.variables ?? []), ...missingVariables] : flow.variables,
    },
    ruleId,
    nodeIds: nodes.map((node) => node.id),
  };
}

import type { FlowDocument } from '../../../design/schema.ts';
import { FlowOperationError, type FlowPosition } from './nodeOperations.ts';

// Multi-select is canvas-local UI state; the reducer keeps it deterministic so shift
// add/remove, rule switches and pruning after undo behave the same everywhere.
export interface FlowSelection {
  ruleId: string | null;
  nodeIds: string[];
}

export const EMPTY_FLOW_SELECTION: FlowSelection = { ruleId: null, nodeIds: [] };

export type FlowSelectionAction =
  | { type: 'select'; ruleId: string; nodeId: string }
  | { type: 'toggle'; ruleId: string; nodeId: string }
  | { type: 'clear' }
  | { type: 'sync'; nodeIds: string[] };

export function reduceFlowSelection(selection: FlowSelection, action: FlowSelectionAction): FlowSelection {
  switch (action.type) {
    case 'select':
      return { ruleId: action.ruleId, nodeIds: [action.nodeId] };
    case 'toggle': {
      if (selection.ruleId !== action.ruleId) return { ruleId: action.ruleId, nodeIds: [action.nodeId] };
      if (selection.nodeIds.includes(action.nodeId)) {
        const nodeIds = selection.nodeIds.filter((id) => id !== action.nodeId);
        return nodeIds.length ? { ruleId: action.ruleId, nodeIds } : { ...EMPTY_FLOW_SELECTION };
      }
      return { ruleId: action.ruleId, nodeIds: [...selection.nodeIds, action.nodeId] };
    }
    case 'clear':
      return { ...EMPTY_FLOW_SELECTION };
    case 'sync': {
      const alive = new Set(action.nodeIds);
      const nodeIds = selection.nodeIds.filter((id) => alive.has(id));
      if (nodeIds.length === selection.nodeIds.length) return selection;
      return nodeIds.length && selection.ruleId ? { ruleId: selection.ruleId, nodeIds } : { ...EMPTY_FLOW_SELECTION };
    }
    default:
      return selection;
  }
}

// Group move for one drag gesture: every selected node shifts by the same delta and the
// whole move is a single FlowDocument, so the canvas wrap of it is one undo step.
export function moveFlowSelection(flow: FlowDocument, ruleId: string, nodeIds: string[], delta: FlowPosition): FlowDocument {
  const rule = flow.rules.find((entry) => entry.id === ruleId);
  if (!rule) throw new FlowOperationError('NO_GRAPH_RULE', `rule ${ruleId} not found`);
  const graph = rule.graph ?? { nodes: [], edges: [] };
  const moving = new Set(nodeIds);
  for (const nodeId of moving) {
    if (!graph.nodes.some((node) => node.id === nodeId)) {
      throw new FlowOperationError('UNKNOWN_NODE', `node ${nodeId} not found`);
    }
  }
  const nodes = graph.nodes.map((node) => (moving.has(node.id)
    ? { ...node, x: Math.round(node.x + delta.x), y: Math.round(node.y + delta.y) }
    : node));
  return {
    ...flow,
    rules: flow.rules.map((entry) => (entry.id === ruleId ? { ...entry, graph: { ...graph, nodes } } : entry)),
  };
}

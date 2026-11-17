import { TERMINAL_ACTIONS } from './flow-graph.ts';
import type {
  FlowDocument,
  FlowEdge,
  FlowGraph,
  FlowNodeView,
  FlowVariable,
  FlowVariableValue,
  InteractionAction,
  InteractionCondition,
  InteractionRule,
  InteractionStep,
} from './schema.ts';
import type { FlowIssue } from './flow-validation.ts';

// The legacy pass only executes navigate, back and toast rules without steps or a graph;
// a rule with any other action and no steps or graph never runs in either runtime.
const LEGACY_ACTION_TYPES = new Set(['navigate', 'back', 'toast']);

function variableAccepts(variable: FlowVariable, value: FlowVariableValue): boolean {
  if (variable.type === 'boolean') return typeof value === 'boolean';
  if (variable.type === 'number') return typeof value === 'number';
  if (variable.type === 'string') return typeof value === 'string';
  return typeof value === 'string' && (variable.values ?? []).includes(value);
}

interface RuleScope {
  rule: InteractionRule;
  variables: ReadonlyMap<string, FlowVariable>;
  routes: ReadonlySet<string>;
  issues: FlowIssue[];
  nodeByStep: Map<string, string>;
}

function checkCondition(condition: InteractionCondition, scope: RuleScope, nodeId?: string): void {
  if (condition.kind === 'all' || condition.kind === 'any') {
    for (const entry of condition.conditions) checkCondition(entry, scope, nodeId);
    return;
  }
  if (condition.kind === 'not') {
    checkCondition(condition.condition, scope, nodeId);
    return;
  }
  const issue = (code: FlowIssue['code'], message: string) =>
    scope.issues.push({ code, ruleId: scope.rule.id, ...(nodeId ? { nodeId } : {}), message });
  // Only documented read-only context paths resolve without a declaration; variable.<id>
  // paths must reference a declared variable in every leaf, including inside nested groups.
  let variable: FlowVariable | undefined;
  if (condition.path.startsWith('variable.')) {
    variable = scope.variables.get(condition.path.slice('variable.'.length));
    if (!variable) {
      issue('UNKNOWN_VARIABLE', `condition references undeclared variable ${condition.path.slice('variable.'.length)}`);
      return;
    }
  }
  if (condition.kind === 'exists') return;
  if (condition.kind === 'gt' || condition.kind === 'gte' || condition.kind === 'lt' || condition.kind === 'lte') {
    if (typeof condition.value !== 'number') issue('WRONG_VALUE_TYPE', `condition ${condition.kind} expects a number value`);
    return;
  }
  if (condition.kind === 'contains') {
    if (typeof condition.value !== 'string') issue('WRONG_VALUE_TYPE', 'condition contains expects a string value');
    return;
  }
  if (variable && (condition.kind === 'eq' || condition.kind === 'neq') && !variableAccepts(variable, condition.value)) {
    issue('WRONG_VALUE_TYPE', `condition on variable ${variable.id} expects a ${variable.type} value`);
  }
}

function checkAction(action: InteractionAction, scope: RuleScope, nodeId?: string): void {
  const issue = (code: FlowIssue['code'], message: string) =>
    scope.issues.push({ code, ruleId: scope.rule.id, ...(nodeId ? { nodeId } : {}), message });
  if ((action.type === 'navigate' || action.type === 'openScreen') && !scope.routes.has(action.screenId)) {
    issue('UNKNOWN_ROUTE', `unknown route ${action.screenId}`);
  }
  if (action.type === 'toast' && !action.message.trim()) issue('EMPTY_MESSAGE', 'toast message is empty');
  if (action.type === 'dialog' && (!action.title.trim() || !action.message.trim())) {
    issue('EMPTY_MESSAGE', 'dialog title and message are required');
  }
  if (action.type === 'variable.set') {
    const variable = scope.variables.get(action.variableId);
    if (!variable) {
      issue('UNKNOWN_VARIABLE', `variable.set references undeclared variable ${action.variableId}`);
    } else if (!variableAccepts(variable, action.value)) {
      issue('WRONG_VALUE_TYPE', `variable ${action.variableId} expects a ${variable.type} value`);
    }
  }
}

function isTerminal(node: FlowNodeView, steps: ReadonlyMap<string, InteractionStep>): boolean {
  if (node.kind === 'result') return true;
  if (!node.stepId) return false;
  const action = steps.get(node.stepId)?.action;
  return Boolean(action && TERMINAL_ACTIONS.has(action.type));
}

function validateGraph(scope: RuleScope, graph: FlowGraph): void {
  const { rule, issues } = scope;
  const nodes = new Map(graph.nodes.map((entry) => [entry.id, entry]));
  const known = (id: string) => nodes.has(id);

  const outgoing = new Map<string, FlowEdge[]>();
  for (const edge of graph.edges) {
    if (!known(edge.from) || !known(edge.to)) {
      issues.push({
        code: 'MISSING_NODE',
        ruleId: rule.id,
        edgeId: edge.id,
        message: `edge ${edge.id} references an unknown node`,
      });
    }
    if (edge.from === edge.to) {
      issues.push({ code: 'SELF_LOOP', ruleId: rule.id, edgeId: edge.id, message: `edge ${edge.id} loops onto its own node` });
    }
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }
  for (const [from, branches] of outgoing) {
    const byBranch = new Map<string, FlowEdge[]>();
    for (const edge of branches) byBranch.set(edge.branch, [...(byBranch.get(edge.branch) ?? []), edge]);
    for (const [branch, edges] of byBranch) {
      if (edges.length > 1) {
        issues.push({
          code: 'AMBIGUOUS_BRANCH',
          ruleId: rule.id,
          nodeId: from,
          edgeId: edges[1].id,
          message: `node ${from} has ${edges.length} outgoing ${branch} edges`,
        });
      }
    }
  }

  // Cycle detection and reachability walk only over edges between existing nodes.
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!known(edge.from) || !known(edge.to)) continue;
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string): void => {
    state.set(id, 'visiting');
    for (const next of adjacency.get(id) ?? []) {
      const status = state.get(next);
      if (status === 'visiting') {
        issues.push({ code: 'CYCLE', ruleId: rule.id, nodeId: next, message: `cycle reaches node ${next}` });
      } else if (status !== 'done') {
        visit(next);
      }
    }
    state.set(id, 'done');
  };
  for (const entry of graph.nodes) {
    if (!state.has(entry.id)) visit(entry.id);
  }

  const triggers = graph.nodes.filter((entry) => entry.kind === 'trigger');
  if (!triggers.length) {
    issues.push({ code: 'NO_TRIGGER', ruleId: rule.id, message: `rule ${rule.id} graph has no trigger node` });
    return;
  }
  if (triggers.length > 1) {
    issues.push({
      code: 'MULTIPLE_TRIGGERS',
      ruleId: rule.id,
      nodeId: triggers[1].id,
      message: `rule ${rule.id} graph has ${triggers.length} trigger nodes`,
    });
  }
  const reachable = new Set<string>();
  const queue = triggers.map((entry) => entry.id);
  for (const id of queue) reachable.add(id);
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of adjacency.get(id) ?? []) {
      if (reachable.has(next)) continue;
      reachable.add(next);
      queue.push(next);
    }
  }
  for (const entry of graph.nodes) {
    if (!reachable.has(entry.id)) {
      issues.push({
        code: 'UNREACHABLE_NODE',
        ruleId: rule.id,
        nodeId: entry.id,
        message: `node ${entry.id} is not reachable from a trigger`,
      });
    }
  }
  const steps = new Map((rule.steps ?? []).map((entry) => [entry.id, entry]));
  const hasTerminalPath = [...reachable].some((id) => {
    const entry = nodes.get(id);
    return Boolean(entry && isTerminal(entry, steps));
  });
  if (!hasTerminalPath) {
    issues.push({
      code: 'NO_TERMINAL_PATH',
      ruleId: rule.id,
      nodeId: triggers[0].id,
      message: `trigger ${triggers[0].id} has no path to a result or terminal action`,
    });
  }
}

export function validateFlowGraph(flow: FlowDocument, routeIds: string[]): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const variables = new Map((flow.variables ?? []).map((entry) => [entry.id, entry]));
  const routes = new Set(routeIds);
  for (const rule of flow.rules) {
    const nodeByStep = new Map(
      (rule.graph?.nodes ?? []).flatMap((entry) => (entry.stepId ? [[entry.stepId, entry.id] as const] : [])),
    );
    const scope: RuleScope = { rule, variables, routes, issues, nodeByStep };
    if (!rule.graph && !(rule.steps?.length) && !LEGACY_ACTION_TYPES.has(rule.action.type)) {
      issues.push({
        code: 'DEAD_RULE',
        ruleId: rule.id,
        message: `rule ${rule.id} has a ${rule.action.type} action but no steps or graph, so no runtime executes it`,
      });
    }
    if (rule.condition) checkCondition(rule.condition, scope);
    checkAction(rule.action, scope);
    for (const step of rule.steps ?? []) {
      const nodeId = nodeByStep.get(step.id);
      if (step.condition) checkCondition(step.condition, scope, nodeId);
      if (step.action) checkAction(step.action, scope, nodeId);
    }
    if (rule.graph) validateGraph(scope, rule.graph);
  }
  return issues;
}

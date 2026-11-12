import type { FlowDocument, InteractionRule } from './schema.ts';

export { validateFlowGraph } from './flow-validation-graph.ts';

export type FlowIssueCode =
  | 'SHADOWED_RULE'
  | 'UNKNOWN_ROUTE'
  | 'DUPLICATE_RULE'
  | 'AMBIGUOUS_BRANCH'
  | 'SELF_LOOP'
  | 'MISSING_NODE'
  | 'CYCLE'
  | 'WRONG_VALUE_TYPE'
  | 'UNREACHABLE_NODE'
  | 'NO_TERMINAL_PATH'
  | 'DEAD_RULE'
  | 'EMPTY_MESSAGE';

export interface FlowIssue {
  code: FlowIssueCode;
  ruleId?: string;
  nodeId?: string;
  edgeId?: string;
  message: string;
}

function shadows(earlier: InteractionRule, later: InteractionRule): boolean {
  if (earlier.condition) return false;
  if (earlier.elementId !== later.elementId || earlier.event !== later.event) return false;
  return earlier.screenId === '*' || earlier.screenId === later.screenId;
}

export function validateFlow(flow: FlowDocument, routeIds: string[]): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const routes = new Set(routeIds);
  const seen = new Set<string>();
  for (const rule of flow.rules) {
    if (seen.has(rule.id)) issues.push({ code: 'DUPLICATE_RULE', ruleId: rule.id, message: `Duplicate rule id ${rule.id}` });
    seen.add(rule.id);
    if (rule.action.type === 'navigate' && !routes.has(rule.action.screenId)) {
      issues.push({ code: 'UNKNOWN_ROUTE', ruleId: rule.id, message: `Unknown route ${rule.action.screenId}` });
    }
  }
  for (let later = 0; later < flow.rules.length; later += 1) {
    for (let earlier = 0; earlier < later; earlier += 1) {
      if (shadows(flow.rules[earlier], flow.rules[later])) {
        issues.push({
          code: 'SHADOWED_RULE',
          ruleId: flow.rules[later].id,
          message: `${flow.rules[later].id} is shadowed by ${flow.rules[earlier].id}`,
        });
        break;
      }
    }
  }
  return issues;
}

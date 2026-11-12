import type { DesignTarget, FlowDocument, InteractionCondition, InteractionRule } from './schema.ts';

export interface InteractionContext {
  target: DesignTarget;
  screenId: string;
  serverConnected: boolean;
}

export interface InteractionEvent {
  screenId: string;
  elementId: string;
  type: 'click';
}

export interface InteractionDispatcher {
  navigate(screenId: string): void;
  back(): void;
  toast(message: string): void;
}

export interface InteractionTrace {
  ruleId: string;
  event: 'click';
  action: 'navigate' | 'back' | 'toast';
  target?: string;
  message?: string;
  condition?: InteractionCondition;
}

// Shared operator semantics for legacy and graph condition evaluation.
export function compareCondition(kind: string, actual: unknown, value: unknown): boolean {
  if (kind === 'eq') return actual === value;
  if (kind === 'neq') return actual !== value;
  if (kind === 'gt' || kind === 'gte' || kind === 'lt' || kind === 'lte') {
    if (typeof actual !== 'number' || typeof value !== 'number') return false;
    if (kind === 'gt') return actual > value;
    if (kind === 'gte') return actual >= value;
    if (kind === 'lt') return actual < value;
    return actual <= value;
  }
  if (kind === 'contains') return typeof actual === 'string' && typeof value === 'string' && actual.includes(value);
  return false;
}

function conditionMatches(condition: InteractionCondition | undefined, context: InteractionContext): boolean {
  if (!condition) return true;
  if (condition.kind === 'all') return condition.conditions.every((entry) => conditionMatches(entry, context));
  if (condition.kind === 'any') return condition.conditions.some((entry) => conditionMatches(entry, context));
  if (condition.kind === 'not') return !conditionMatches(condition.condition, context);
  const actual = condition.path === 'server.connected'
    ? context.serverConnected
    : condition.path === 'target'
      ? context.target
      : condition.path === 'screen.current'
        ? context.screenId
        : undefined;
  if (condition.kind === 'exists') return actual !== undefined;
  return compareCondition(condition.kind, actual, condition.value);
}

function ruleMatches(rule: InteractionRule, event: InteractionEvent, context: InteractionContext): boolean {
  // Rules with steps or a graph belong to the flow graph runtime and never match in the legacy pass.
  if (rule.graph || (rule.steps && rule.steps.length)) return false;
  if (rule.action.type !== 'navigate' && rule.action.type !== 'back' && rule.action.type !== 'toast') return false;
  if (rule.screenId !== '*' && rule.screenId !== event.screenId) return false;
  if (rule.elementId !== event.elementId || rule.event !== event.type) return false;
  return conditionMatches(rule.condition, context);
}

export function dispatchInteraction(
  flow: FlowDocument,
  event: InteractionEvent,
  context: InteractionContext,
  dispatcher: InteractionDispatcher,
): InteractionTrace[] {
  const rule = flow.rules.find((entry) => ruleMatches(entry, event, context));
  if (!rule) return [];
  const action = rule.action;
  if (action.type !== 'navigate' && action.type !== 'back' && action.type !== 'toast') return [];
  const trace: InteractionTrace = { ruleId: rule.id, event: 'click', action: action.type };
  if (rule.condition) trace.condition = rule.condition;
  if (action.type === 'navigate') {
    trace.target = action.screenId;
    dispatcher.navigate(action.screenId);
  } else if (action.type === 'back') {
    dispatcher.back();
  } else {
    trace.message = action.message;
    dispatcher.toast(action.message);
  }
  return [trace];
}

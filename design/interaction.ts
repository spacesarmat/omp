import type { DesktopDesignTarget, FlowDocument, InteractionCondition, InteractionRule } from './schema.ts';

export interface InteractionContext {
  target: DesktopDesignTarget;
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

function conditionMatches(condition: InteractionCondition | undefined, context: InteractionContext): boolean {
  if (!condition) return true;
  if (condition.kind === 'eq') {
    const actual = condition.path === 'server.connected' ? context.serverConnected : condition.path === 'target' ? context.target : context.screenId;
    return actual === condition.value;
  }
  if (condition.kind === 'all') return condition.conditions.every((entry) => conditionMatches(entry, context));
  if (condition.kind === 'any') return condition.conditions.some((entry) => conditionMatches(entry, context));
  return !conditionMatches(condition.condition, context);
}

function ruleMatches(rule: InteractionRule, event: InteractionEvent, context: InteractionContext): boolean {
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
  const trace: InteractionTrace = { ruleId: rule.id, event: 'click', action: rule.action.type };
  if (rule.condition) trace.condition = rule.condition;
  if (rule.action.type === 'navigate') {
    trace.target = rule.action.screenId;
    dispatcher.navigate(rule.action.screenId);
  } else if (rule.action.type === 'back') {
    dispatcher.back();
  } else {
    trace.message = rule.action.message;
    dispatcher.toast(rule.action.message);
  }
  return [trace];
}

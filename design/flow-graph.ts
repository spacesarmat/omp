import { compareCondition, dispatchInteraction, type InteractionContext, type InteractionDispatcher } from './interaction.ts';
import type {
  ConditionPath,
  FlowDocument,
  FlowEdge,
  FlowEdgeBranch,
  FlowEnvironment,
  FlowEventType,
  FlowGraph,
  FlowNodeKind,
  FlowNodeView,
  FlowVariable,
  FlowVariableValue,
  InteractionAction,
  InteractionCondition,
  InteractionRule,
} from './schema.ts';

// Runtime and execution policy limits (design 2026-11-12, section 9).
export const FLOW_STEP_LIMIT = 32;

export interface FlowDispatchOutcome {
  ok: boolean;
  error?: string;
}

// Typed synchronous dispatcher: graph actions call these instead of executing directly.
// Async application APIs stay in the existing adapters; the interpreter never awaits them.
export interface FlowDispatcher {
  navigate(screenId: string): FlowDispatchOutcome;
  back(): FlowDispatchOutcome;
  openScreen(screenId: string): FlowDispatchOutcome;
  toast(message: string): FlowDispatchOutcome;
  dialog(title: string, message: string): FlowDispatchOutcome;
  playbackPlayPause(): FlowDispatchOutcome;
  playbackStop(): FlowDispatchOutcome;
  playbackNextEpisode(): FlowDispatchOutcome;
  queueAdd(): FlowDispatchOutcome;
  queueReplace(): FlowDispatchOutcome;
  serverConnect(): FlowDispatchOutcome;
  serverReconnect(): FlowDispatchOutcome;
  serverRetry(): FlowDispatchOutcome;
  sourceRetry(): FlowDispatchOutcome;
  sourceNext(): FlowDispatchOutcome;
  linkOpen(url: string): FlowDispatchOutcome;
  telegramOpen(target: string): FlowDispatchOutcome;
}

export interface FlowEvent {
  type: FlowEventType;
  screenId: string;
  elementId: string;
}

// One event creates one execution context: documented read-only environment values plus
// session variables. Variables never leave the session and are dropped by resetFlowSession.
export interface ExecutionContext extends FlowEnvironment {
  variables: Record<string, FlowVariableValue>;
}

export type ExecutionStatus = 'completed' | 'not-matched' | 'error' | 'step-limit';

export interface ExecutionTraceEntry {
  ruleId: string;
  nodeId?: string;
  stepId?: string;
  kind?: FlowNodeKind;
  branch?: FlowEdgeBranch;
  condition?: boolean;
  action?: string;
  target?: string;
  message?: string;
  error?: string;
}

export interface ExecutionResult {
  status: ExecutionStatus;
  matched: 'legacy' | 'graph' | null;
  trace: ExecutionTraceEntry[];
  steps: number;
  variables: Record<string, FlowVariableValue>;
  route?: string;
  toast?: string;
  error?: string;
}

const DEFAULT_ENVIRONMENT: FlowEnvironment = {
  target: 'desktop-windows',
  screenId: 'settings',
  serverConnected: false,
  networkOnline: true,
  accountSignedIn: false,
  playbackState: 'idle',
  downloadState: 'idle',
};

interface FlowSession {
  env: FlowEnvironment;
  variables: Record<string, FlowVariableValue>;
  lastRunAt: Record<string, number>;
}

let session: FlowSession | null = null;

function currentSession(): FlowSession {
  if (!session) session = { env: { ...DEFAULT_ENVIRONMENT }, variables: {}, lastRunAt: {} };
  return session;
}

export function beginFlowSession(env: FlowEnvironment): void {
  session = { env: { ...env }, variables: {}, lastRunAt: {} };
}

export function resetFlowSession(): void {
  session = null;
}

// Production publishers refresh the read-only environment values between events without
// dropping session variables or cooldown bookkeeping.
export function updateFlowEnvironment(env: FlowEnvironment): void {
  currentSession().env = { ...env };
}

function createContext(event: FlowEvent): ExecutionContext & { route?: string; toast?: string; error?: string } {
  const active = currentSession();
  return { ...active.env, screenId: event.screenId, variables: { ...active.variables } };
}

function commitContext(context: ExecutionContext): void {
  currentSession().variables = { ...context.variables };
}

function ensureDocumentVariables(flow: FlowDocument, active: FlowSession): void {
  for (const variable of flow.variables ?? []) {
    if (active.variables[variable.id] === undefined) active.variables[variable.id] = variable.initial;
  }
}

function resolvePath(path: ConditionPath, context: ExecutionContext): FlowVariableValue | undefined {
  if (path === 'server.connected') return context.serverConnected;
  if (path === 'target') return context.target;
  if (path === 'screen.current') return context.screenId;
  if (path === 'network.online') return context.networkOnline;
  if (path === 'account.signedIn') return context.accountSignedIn;
  if (path === 'playback.state') return context.playbackState;
  if (path === 'download.state') return context.downloadState;
  return context.variables[path.slice('variable.'.length)];
}

function evaluateCondition(condition: InteractionCondition, context: ExecutionContext): boolean {
  if (condition.kind === 'all') return condition.conditions.every((entry) => evaluateCondition(entry, context));
  if (condition.kind === 'any') return condition.conditions.some((entry) => evaluateCondition(entry, context));
  if (condition.kind === 'not') return !evaluateCondition(condition.condition, context);
  const actual = resolvePath(condition.path, context);
  if (condition.kind === 'exists') return actual !== undefined;
  return compareCondition(condition.kind, actual, condition.value);
}

function variableAccepts(variable: FlowVariable, value: FlowVariableValue): boolean {
  if (variable.type === 'boolean') return typeof value === 'boolean';
  if (variable.type === 'number') return typeof value === 'number';
  if (variable.type === 'string') return typeof value === 'string';
  return typeof value === 'string' && (variable.values ?? []).includes(value);
}

export interface MutableContext extends ExecutionContext {
  route?: string;
  toast?: string;
  error?: string;
}

function runAction(
  action: InteractionAction,
  context: MutableContext,
  dispatcher: FlowDispatcher,
  declared: ReadonlyMap<string, FlowVariable>,
): FlowDispatchOutcome {
  switch (action.type) {
    case 'navigate': {
      const outcome = dispatcher.navigate(action.screenId);
      if (outcome.ok) context.route = action.screenId;
      return outcome;
    }
    case 'back':
      return dispatcher.back();
    case 'openScreen': {
      const outcome = dispatcher.openScreen(action.screenId);
      if (outcome.ok) context.route = action.screenId;
      return outcome;
    }
    case 'toast': {
      const outcome = dispatcher.toast(action.message);
      if (outcome.ok) context.toast = action.message;
      return outcome;
    }
    case 'dialog':
      return dispatcher.dialog(action.title, action.message);
    case 'playback.playPause':
      return dispatcher.playbackPlayPause();
    case 'playback.stop':
      return dispatcher.playbackStop();
    case 'playback.nextEpisode':
      return dispatcher.playbackNextEpisode();
    case 'queue.add':
      return dispatcher.queueAdd();
    case 'queue.replace':
      return dispatcher.queueReplace();
    case 'server.connect':
      return dispatcher.serverConnect();
    case 'server.reconnect':
      return dispatcher.serverReconnect();
    case 'server.retry':
      return dispatcher.serverRetry();
    case 'source.retry':
      return dispatcher.sourceRetry();
    case 'source.next':
      return dispatcher.sourceNext();
    case 'variable.set': {
      const variable = declared.get(action.variableId);
      if (!variable) return { ok: false, error: `unknown variable ${action.variableId}` };
      if (!variableAccepts(variable, action.value)) return { ok: false, error: `variable ${action.variableId} expects ${variable.type}` };
      context.variables[action.variableId] = action.value;
      return { ok: true };
    }
    case 'link.open':
      return dispatcher.linkOpen(action.url);
    case 'telegram.open':
      return dispatcher.telegramOpen(action.target);
  }
}

// Terminal actions end the branch after they run; toast, dialog and telegram.open are
// fire-and-forget and let the walk continue along the default edge.
export const TERMINAL_ACTIONS = new Set([
  'navigate',
  'back',
  'openScreen',
  'playback.playPause',
  'playback.stop',
  'playback.nextEpisode',
  'queue.add',
  'queue.replace',
  'server.connect',
  'server.reconnect',
  'server.retry',
  'source.retry',
  'source.next',
  'link.open',
]);

interface RunState {
  steps: number;
}

export interface RunOutcome {
  status: ExecutionStatus;
}

function traceError(trace: ExecutionTraceEntry[], ruleId: string, message: string): void {
  trace.push({ ruleId, error: message });
}

function nextByBranch(edges: FlowEdge[], from: string, branch: FlowEdgeBranch): FlowEdge | undefined {
  return edges.find((edge) => edge.from === from && edge.branch === branch);
}

// The walk is a generator so a debugger can drive the same execution node by node:
// executeGraphRule ignores the yielded node ids and drives to completion, the editor
// debugger steps and pauses on them. Yields happen after a node executed and, for graph
// rules, once for the trigger before any node runs.
function* runGraphWalk(
  rule: InteractionRule,
  graph: FlowGraph,
  context: MutableContext,
  dispatcher: FlowDispatcher,
  declared: ReadonlyMap<string, FlowVariable>,
  trace: ExecutionTraceEntry[],
  state: RunState,
): Generator<string, RunOutcome> {
  const steps = new Map((rule.steps ?? []).map((entry) => [entry.id, entry]));
  const outgoing = new Map<string, FlowEdge[]>();
  for (const edge of graph.edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }
  const trigger = graph.nodes.find((node) => node.kind === 'trigger')
    ?? graph.nodes.find((node) => !graph.edges.some((edge) => edge.to === node.id));
  let current: FlowNodeView | undefined;
  if (trigger) {
    yield trigger.id;
    const entryEdge = nextByBranch(outgoing.get(trigger.id) ?? [], trigger.id, 'default');
    current = entryEdge ? graph.nodes.find((node) => node.id === entryEdge.to) : undefined;
  }
  while (current) {
    if (state.steps >= FLOW_STEP_LIMIT) {
      traceError(trace, rule.id, `step limit of ${FLOW_STEP_LIMIT} reached`);
      context.error = `step limit of ${FLOW_STEP_LIMIT} reached`;
      return { status: 'step-limit' };
    }
    state.steps += 1;
    const step = current.stepId ? steps.get(current.stepId) : undefined;
    if (current.kind === 'condition') {
      const matched = step?.condition ? evaluateCondition(step.condition, context) : false;
      trace.push({ ruleId: rule.id, nodeId: current.id, stepId: current.stepId, kind: 'condition', condition: matched });
      const edge = nextByBranch(outgoing.get(current.id) ?? [], current.id, matched ? 'true' : 'false');
      yield current.id;
      current = edge ? graph.nodes.find((node) => node.id === edge.to) : undefined;
      continue;
    }
    if (current.kind === 'action' || current.kind === 'result') {
      const entry: ExecutionTraceEntry = { ruleId: rule.id, nodeId: current.id, stepId: current.stepId, kind: current.kind };
      trace.push(entry);
      if (step?.action) {
        entry.action = step.action.type;
        if (step.action.type === 'navigate' || step.action.type === 'openScreen') entry.target = step.action.screenId;
        if (step.action.type === 'toast') entry.message = step.action.message;
        let outcome: FlowDispatchOutcome;
        try {
          outcome = runAction(step.action, context, dispatcher, declared);
        } catch (error) {
          outcome = { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
        if (!outcome.ok) {
          entry.error = outcome.error ?? 'action failed';
          context.error = entry.error;
          const edge = nextByBranch(outgoing.get(current.id) ?? [], current.id, 'error');
          yield current.id;
          if (!edge) return { status: 'error' };
          current = graph.nodes.find((node) => node.id === edge.to);
          continue;
        }
      }
      if (current.kind === 'result' || (step?.action && TERMINAL_ACTIONS.has(step.action.type))) {
        yield current.id;
        return { status: 'completed' };
      }
      yield current.id;
      const edge = nextByBranch(outgoing.get(current.id) ?? [], current.id, 'default');
      current = edge ? graph.nodes.find((node) => node.id === edge.to) : undefined;
      continue;
    }
    // Unknown kinds cannot pass validation; stop the walk instead of guessing.
    return { status: 'completed' };
  }
  return { status: 'completed' };
}

function driveWalk(walk: Generator<string, RunOutcome>): RunOutcome {
  let result = walk.next();
  while (!result.done) result = walk.next();
  return result.value;
}

function runGraph(
  rule: InteractionRule,
  graph: FlowGraph,
  context: MutableContext,
  dispatcher: FlowDispatcher,
  declared: ReadonlyMap<string, FlowVariable>,
  trace: ExecutionTraceEntry[],
  state: RunState,
): RunOutcome {
  return driveWalk(runGraphWalk(rule, graph, context, dispatcher, declared, trace, state));
}

function* runStepsWalk(
  rule: InteractionRule,
  context: MutableContext,
  dispatcher: FlowDispatcher,
  declared: ReadonlyMap<string, FlowVariable>,
  trace: ExecutionTraceEntry[],
  state: RunState,
): Generator<string, RunOutcome> {
  for (const step of rule.steps ?? []) {
    if (state.steps >= FLOW_STEP_LIMIT) {
      traceError(trace, rule.id, `step limit of ${FLOW_STEP_LIMIT} reached`);
      context.error = `step limit of ${FLOW_STEP_LIMIT} reached`;
      return { status: 'step-limit' };
    }
    state.steps += 1;
    if (step.condition) {
      const matched = evaluateCondition(step.condition, context);
      trace.push({ ruleId: rule.id, stepId: step.id, kind: 'condition', condition: matched });
      if (!matched) {
        yield step.id;
        return { status: 'completed' };
      }
    }
    if (step.action) {
      const entry: ExecutionTraceEntry = { ruleId: rule.id, stepId: step.id, kind: 'action', action: step.action.type };
      trace.push(entry);
      let outcome: FlowDispatchOutcome;
      try {
        outcome = runAction(step.action, context, dispatcher, declared);
      } catch (error) {
        outcome = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      if (!outcome.ok) {
        entry.error = outcome.error ?? 'action failed';
        context.error = entry.error;
        yield step.id;
        return { status: 'error' };
      }
      if (TERMINAL_ACTIONS.has(step.action.type)) {
        yield step.id;
        return { status: 'completed' };
      }
    }
    yield step.id;
  }
  // The rule action is the terminal step of an ordered chain without a graph.
  if (state.steps >= FLOW_STEP_LIMIT) {
    traceError(trace, rule.id, `step limit of ${FLOW_STEP_LIMIT} reached`);
    context.error = `step limit of ${FLOW_STEP_LIMIT} reached`;
    return { status: 'step-limit' };
  }
  state.steps += 1;
  const terminal: ExecutionTraceEntry = { ruleId: rule.id, kind: 'action', action: rule.action.type };
  if (rule.action.type === 'navigate' || rule.action.type === 'openScreen') terminal.target = rule.action.screenId;
  if (rule.action.type === 'toast') terminal.message = rule.action.message;
  trace.push(terminal);
  let terminalOutcome: FlowDispatchOutcome;
  try {
    terminalOutcome = runAction(rule.action, context, dispatcher, declared);
  } catch (error) {
    terminalOutcome = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (!terminalOutcome.ok) {
    terminal.error = terminalOutcome.error ?? 'action failed';
    context.error = terminal.error;
    return { status: 'error' };
  }
  return { status: 'completed' };
}

function triggerMatches(rule: InteractionRule, event: FlowEvent, context: ExecutionContext): boolean {
  const active = currentSession();
  if (rule.cooldownMs && active.lastRunAt[rule.id] !== undefined && Date.now() - active.lastRunAt[rule.id] < rule.cooldownMs) {
    return false;
  }
  if (rule.screenId !== '*' && rule.screenId !== event.screenId) return false;
  if (rule.event !== event.type) return false;
  if (rule.elementId !== '*' && rule.elementId !== event.elementId) return false;
  if (rule.condition && !evaluateCondition(rule.condition, context)) return false;
  active.lastRunAt[rule.id] = Date.now();
  return true;
}

function buildResult(
  status: ExecutionStatus,
  matched: ExecutionResult['matched'],
  trace: ExecutionTraceEntry[],
  state: RunState,
  context: MutableContext,
): ExecutionResult {
  const result: ExecutionResult = {
    status,
    matched,
    trace,
    steps: state.steps,
    variables: { ...context.variables },
  };
  if (context.route !== undefined) result.route = context.route;
  if (context.toast !== undefined) result.toast = context.toast;
  if (context.error !== undefined) result.error = context.error;
  return result;
}

export function executeGraphRule(
  rule: InteractionRule,
  event: FlowEvent,
  dispatcher: FlowDispatcher,
  variables: FlowVariable[] = [],
): ExecutionResult {
  const context = createContext(event);
  const state: RunState = { steps: 0 };
  const trace: ExecutionTraceEntry[] = [];
  if (!triggerMatches(rule, event, context)) {
    return buildResult('not-matched', null, trace, state, context);
  }
  const declared = new Map(variables.map((variable) => [variable.id, variable]));
  const outcome = rule.graph
    ? runGraph(rule, rule.graph, context, dispatcher, declared, trace, state)
    : driveWalk(runStepsWalk(rule, context, dispatcher, declared, trace, state));
  commitContext(context);
  return buildResult(outcome.status, 'graph', trace, state, context);
}

export interface RuleWalkStep {
  done: boolean;
  nodeId?: string;
  outcome?: RunOutcome;
}

// A re-entrant rule execution: the editor debugger drives it one node at a time while
// executeGraphRule drives an identical walk to completion, so stepping and running share
// one implementation. An optional external context (the debug session context) is mutated
// in place instead of the module session; variables commit stays with the module session.
export interface RuleWalk {
  readonly matched: boolean;
  readonly context: MutableContext;
  readonly trace: ExecutionTraceEntry[];
  readonly steps: number;
  step(): RuleWalkStep;
}

export function createRuleWalk(
  rule: InteractionRule,
  event: FlowEvent,
  dispatcher: FlowDispatcher,
  variables: FlowVariable[] = [],
  context?: ExecutionContext,
): RuleWalk {
  const active: MutableContext = context ? (context as MutableContext) : createContext(event);
  const state: RunState = { steps: 0 };
  const trace: ExecutionTraceEntry[] = [];
  const matched = triggerMatches(rule, event, active);
  const declared = new Map(variables.map((variable) => [variable.id, variable]));
  const walk = matched
    ? rule.graph
      ? runGraphWalk(rule, rule.graph, active, dispatcher, declared, trace, state)
      : runStepsWalk(rule, active, dispatcher, declared, trace, state)
    : null;
  return {
    matched,
    context: active,
    trace,
    get steps() {
      return state.steps;
    },
    step() {
      if (!walk) return { done: true, outcome: { status: 'not-matched' } };
      const result = walk.next();
      if (result.done) {
        if (!context) commitContext(active);
        return { done: true, outcome: result.value };
      }
      return { done: false, nodeId: result.value };
    },
  };
}

function isGraphRule(rule: InteractionRule): boolean {
  return Boolean(rule.graph || (rule.steps && rule.steps.length));
}

function legacyDispatcher(dispatcher: FlowDispatcher): InteractionDispatcher {
  return {
    navigate: (screenId) => {
      dispatcher.navigate(screenId);
    },
    back: () => {
      dispatcher.back();
    },
    toast: (message) => {
      dispatcher.toast(message);
    },
  };
}

function legacyResult(traces: ReturnType<typeof dispatchInteraction>, variables: Record<string, FlowVariableValue>): ExecutionResult {
  const trace: ExecutionTraceEntry[] = traces.map((entry) => {
    const mapped: ExecutionTraceEntry = { ruleId: entry.ruleId, kind: 'action', action: entry.action };
    if (entry.target !== undefined) mapped.target = entry.target;
    if (entry.message !== undefined) mapped.message = entry.message;
    return mapped;
  });
  const result: ExecutionResult = {
    status: 'completed',
    matched: 'legacy',
    trace,
    steps: trace.length,
    variables: { ...variables },
  };
  const last = traces[traces.length - 1];
  if (last?.action === 'navigate' && last.target) result.route = last.target;
  if (last?.action === 'toast' && last.message) result.toast = last.message;
  return result;
}

// One entry point for an event: legacy rules keep their original order and error semantics
// through the existing dispatchInteraction, and graph rules run only when no legacy rule matched.
export function executeFlow(flow: FlowDocument, event: FlowEvent, dispatcher: FlowDispatcher): ExecutionResult {
  const active = currentSession();
  ensureDocumentVariables(flow, active);
  if (event.type === 'click') {
    const legacyContext: InteractionContext = {
      target: active.env.target,
      screenId: event.screenId,
      serverConnected: active.env.serverConnected,
    };
    const legacyEvent = { type: 'click' as const, screenId: event.screenId, elementId: event.elementId };
    const traces = dispatchInteraction(flow, legacyEvent, legacyContext, legacyDispatcher(dispatcher));
    if (traces.length) return legacyResult(traces, active.variables);
  }
  for (const rule of flow.rules) {
    if (!isGraphRule(rule)) continue;
    const result = executeGraphRule(rule, event, dispatcher, flow.variables ?? []);
    if (result.matched === 'graph') return result;
  }
  return {
    status: 'not-matched',
    matched: null,
    trace: [],
    steps: 0,
    variables: { ...active.variables },
  };
}

import {
  createRuleWalk,
  type ExecutionContext,
  type ExecutionTraceEntry,
  type FlowDispatcher,
  type FlowEvent,
  type RuleWalk,
} from '../../../design/flow-graph.ts';
import type {
  DesignTarget,
  FlowDownloadState,
  FlowPlaybackState,
  FlowVariable,
  InteractionRule,
} from '../../../design/schema.ts';

export type DebugStatus = 'idle' | 'paused' | 'completed' | 'error' | 'stopped' | 'not-matched';

export type DebugBreakpoint =
  | { kind: 'node'; ruleId: string; nodeId: string }
  | { kind: 'rule'; ruleId: string };

export interface DebugSession {
  status: DebugStatus;
  event: FlowEvent;
  context: ExecutionContext & { route?: string; toast?: string; error?: string };
  breakpoints: DebugBreakpoint[];
  currentNodeId: string | null;
  trace: ExecutionTraceEntry[];
}

// Mock-only environment knobs: they feed the session context and the mock dispatcher,
// never the editor settings or any real adapter.
export interface DebugMocks {
  serverConnected: boolean;
  networkOnline: boolean;
  accountSignedIn: boolean;
  playbackState: FlowPlaybackState;
  downloadState: FlowDownloadState;
}

export interface CreateDebugSessionOptions {
  rule: InteractionRule;
  event: FlowEvent;
  target: DesignTarget;
  mocks: DebugMocks;
  variables?: FlowVariable[];
  dispatcher?: FlowDispatcher;
}

export interface TraceDifference {
  index: number;
  first: ExecutionTraceEntry | null;
  second: ExecutionTraceEntry | null;
}

interface SessionInternals {
  rule: InteractionRule;
  target: DesignTarget;
  mocks: DebugMocks;
  variables: FlowVariable[];
  dispatcher: FlowDispatcher;
  walk: RuleWalk | null;
  pauseRequested: boolean;
}

const internals = new WeakMap<DebugSession, SessionInternals>();

function internalsOf(session: DebugSession): SessionInternals {
  const internal = internals.get(session);
  if (!internal) throw new Error('unknown debug session');
  return internal;
}

// A recording dispatcher over the local mocks: every action succeeds and only the mock
// state object moves, so debugging can never touch real settings or the network.
export function createDebugDispatcher(mocks: DebugMocks): FlowDispatcher {
  const ok = () => ({ ok: true as const });
  return {
    navigate: ok,
    back: ok,
    openScreen: ok,
    toast: ok,
    dialog: ok,
    playbackPlayPause: () => {
      mocks.playbackState = mocks.playbackState === 'playing' ? 'paused' : 'playing';
      return ok();
    },
    playbackStop: () => {
      mocks.playbackState = 'stopped';
      return ok();
    },
    playbackNextEpisode: ok,
    queueAdd: ok,
    queueReplace: ok,
    serverConnect: () => {
      mocks.serverConnected = true;
      return ok();
    },
    serverReconnect: () => {
      if (mocks.networkOnline) mocks.serverConnected = true;
      return ok();
    },
    serverRetry: () => {
      if (mocks.networkOnline) mocks.serverConnected = true;
      return ok();
    },
    sourceRetry: ok,
    sourceNext: ok,
    linkOpen: ok,
    telegramOpen: ok,
  };
}

export function selectDebugRule(flow: { rules: InteractionRule[] }, screenId: string): InteractionRule | null {
  return flow.rules.find((rule) =>
    (rule.graph || (rule.steps?.length ?? 0) > 0) && (rule.screenId === '*' || rule.screenId === screenId),
  ) ?? null;
}

function seedVariables(variables: FlowVariable[]): Record<string, string | number | boolean> {
  const seeded: Record<string, string | number | boolean> = {};
  for (const variable of variables) seeded[variable.id] = variable.initial;
  return seeded;
}

export function createDebugSession(options: CreateDebugSessionOptions): DebugSession {
  const session: DebugSession = {
    status: 'idle',
    event: options.event,
    context: {
      target: options.target,
      screenId: options.event.screenId,
      serverConnected: options.mocks.serverConnected,
      networkOnline: options.mocks.networkOnline,
      accountSignedIn: options.mocks.accountSignedIn,
      playbackState: options.mocks.playbackState,
      downloadState: options.mocks.downloadState,
      variables: seedVariables(options.variables ?? []),
    },
    breakpoints: [],
    currentNodeId: null,
    trace: [],
  };
  internals.set(session, {
    rule: options.rule,
    target: options.target,
    mocks: options.mocks,
    variables: options.variables ?? [],
    dispatcher: options.dispatcher ?? createDebugDispatcher(options.mocks),
    walk: null,
    pauseRequested: false,
  });
  return session;
}

export function addBreakpoint(session: DebugSession, breakpoint: DebugBreakpoint): void {
  if (!session.breakpoints.some((entry) => sameBreakpoint(entry, breakpoint))) {
    session.breakpoints.push(breakpoint);
  }
}

export function removeBreakpoint(session: DebugSession, breakpoint: DebugBreakpoint): void {
  session.breakpoints = session.breakpoints.filter((entry) => !sameBreakpoint(entry, breakpoint));
}

function sameBreakpoint(a: DebugBreakpoint, b: DebugBreakpoint): boolean {
  if (a.kind !== b.kind || a.ruleId !== b.ruleId) return false;
  return a.kind === 'node' && b.kind === 'node' ? a.nodeId === b.nodeId : true;
}

function breakpointHit(session: DebugSession, ruleId: string, nodeId: string): boolean {
  return session.breakpoints.some((breakpoint) =>
    breakpoint.kind === 'rule'
      ? breakpoint.ruleId === ruleId
      : breakpoint.ruleId === ruleId && breakpoint.nodeId === nodeId,
  );
}

function nodeKind(rule: InteractionRule, nodeId: string): string | null {
  const view = rule.graph?.nodes.find((node) => node.id === nodeId);
  if (view) return view.kind;
  const step = rule.steps?.find((entry) => entry.id === nodeId);
  if (step) return step.condition ? 'condition' : 'action';
  return null;
}

function ensureWalk(session: DebugSession): RuleWalk | null {
  const internal = internalsOf(session);
  if (!internal.walk) {
    if (session.status !== 'idle') return null;
    internal.walk = createRuleWalk(internal.rule, session.event, internal.dispatcher, internal.variables, session.context);
    session.trace = internal.walk.trace;
  }
  return internal.walk;
}

function mapOutcome(status: string): DebugStatus {
  if (status === 'completed') return 'completed';
  if (status === 'not-matched') return 'not-matched';
  return 'error';
}

type PauseMode = 'none' | 'any' | 'action';

function drive(session: DebugSession, mode: PauseMode): void {
  if (session.status !== 'idle' && session.status !== 'paused') return;
  const internal = internalsOf(session);
  const walk = ensureWalk(session);
  if (!walk) return;
  for (;;) {
    const step = walk.step();
    if (step.done) {
      session.status = mapOutcome(step.outcome?.status ?? 'completed');
      session.currentNodeId = null;
      internal.walk = null;
      return;
    }
    const nodeId = step.nodeId ?? null;
    session.currentNodeId = nodeId;
    if (internal.pauseRequested) {
      internal.pauseRequested = false;
      session.status = 'paused';
      return;
    }
    if (nodeId && breakpointHit(session, internal.rule.id, nodeId)) {
      session.status = 'paused';
      return;
    }
    if (mode === 'any') {
      session.status = 'paused';
      return;
    }
    if (mode === 'action' && nodeId && nodeKind(internal.rule, nodeId) !== 'condition' && nodeKind(internal.rule, nodeId) !== 'trigger') {
      session.status = 'paused';
      return;
    }
  }
}

export function startDebug(session: DebugSession): void {
  drive(session, 'none');
}

export function pauseDebug(session: DebugSession): void {
  if (session.status === 'idle' || session.status === 'paused') {
    internalsOf(session).pauseRequested = true;
  }
}

export function stepInto(session: DebugSession): void {
  drive(session, 'any');
}

export function stepOver(session: DebugSession): void {
  drive(session, 'action');
}

export function stopDebug(session: DebugSession): void {
  if (session.status !== 'idle' && session.status !== 'paused') return;
  const internal = internalsOf(session);
  internal.walk = null;
  internal.pauseRequested = false;
  session.status = 'stopped';
  session.currentNodeId = null;
}

export function resetDebug(session: DebugSession): void {
  const internal = internalsOf(session);
  internal.walk = null;
  internal.pauseRequested = false;
  session.trace = [];
  session.currentNodeId = null;
  session.status = 'idle';
  session.context = {
    target: internal.target,
    screenId: session.event.screenId,
    serverConnected: internal.mocks.serverConnected,
    networkOnline: internal.mocks.networkOnline,
    accountSignedIn: internal.mocks.accountSignedIn,
    playbackState: internal.mocks.playbackState,
    downloadState: internal.mocks.downloadState,
    variables: seedVariables(internal.variables),
  };
}

function sameTraceEntry(a: ExecutionTraceEntry | null, b: ExecutionTraceEntry | null): boolean {
  if (!a || !b) return false;
  return a.ruleId === b.ruleId
    && a.nodeId === b.nodeId
    && a.stepId === b.stepId
    && a.kind === b.kind
    && a.branch === b.branch
    && a.condition === b.condition
    && a.action === b.action
    && a.target === b.target
    && a.message === b.message
    && a.error === b.error;
}

export function compareTraces(first: ExecutionTraceEntry[], second: ExecutionTraceEntry[]): TraceDifference | null {
  const length = Math.max(first.length, second.length);
  for (let index = 0; index < length; index += 1) {
    const a = first[index] ?? null;
    const b = second[index] ?? null;
    if (!sameTraceEntry(a, b)) return { index, first: a, second: b };
  }
  return null;
}

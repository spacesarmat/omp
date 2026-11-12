import { describe, expect, it } from 'vitest';
import {
  addBreakpoint,
  compareTraces,
  createDebugDispatcher,
  createDebugSession,
  pauseDebug,
  removeBreakpoint,
  resetDebug,
  selectDebugRule,
  startDebug,
  stepInto,
  stepOver,
  stopDebug,
  type DebugMocks,
} from '../../editor/src/flow/debugger';
import type { ExecutionTraceEntry, FlowDispatcher } from '../../design/flow-graph';
import type {
  FlowDocument,
  FlowEdge,
  FlowEdgeBranch,
  FlowGraph,
  FlowNodeKind,
  FlowNodeView,
  FlowVariable,
  InteractionRule,
  InteractionStep,
} from '../../design/schema';

const BASE = '0000000000000000000000000000000000000000';

const MOCKS: DebugMocks = {
  serverConnected: true,
  networkOnline: true,
  accountSignedIn: false,
  playbackState: 'idle',
  downloadState: 'idle',
};

function node(id: string, kind: FlowNodeKind, stepId?: string): FlowNodeView {
  return stepId ? { id, kind, stepId, x: 0, y: 0 } : { id, kind, x: 0, y: 0 };
}

function edge(id: string, from: string, to: string, branch: FlowEdgeBranch = 'default'): FlowEdge {
  return { id, from, to, branch };
}

function graph(nodes: FlowNodeView[], edges: FlowEdge[]): FlowGraph {
  return { nodes, edges };
}

function flowDoc(rules: InteractionRule[], variables: FlowVariable[] = []): FlowDocument {
  return { schemaVersion: 1, id: 'test-flow', baseCommit: BASE, rules, ...(variables.length ? { variables } : {}) };
}

function graphRule(id: string, elementId: string, g: FlowGraph, steps: InteractionStep[] = []): InteractionRule {
  return {
    id,
    screenId: 'settings',
    elementId,
    event: 'click',
    action: { type: 'toast', message: 'unused legacy action' },
    graph: g,
    steps,
  };
}

const click = (elementId: string, screenId = 'settings') => ({ type: 'click' as const, screenId, elementId });

// trigger -> condition(server.connected) -true-> action(toast, не terminal)
//                              |
//                              -false-> result(navigate connect)
function branchingFlow(): FlowDocument {
  return flowDoc([
    graphRule('rule-1', 'settings-continue', graph(
      [node('t', 'trigger'), node('c', 'condition', 's-c'), node('a', 'action', 's-a'), node('r-false', 'result', 's-rf')],
      [edge('e1', 't', 'c'), edge('e2', 'c', 'a', 'true'), edge('e3', 'c', 'r-false', 'false')],
    ), [
      { id: 's-c', condition: { kind: 'eq', path: 'server.connected', value: true } },
      { id: 's-a', action: { type: 'toast', message: 'connected' } },
      { id: 's-rf', action: { type: 'navigate', screenId: 'connect' } },
    ]),
  ]);
}

function createSessionFor(flow: FlowDocument, overrides: Partial<Parameters<typeof createDebugSession>[0]> = {}) {
  const rule = selectDebugRule(flow, 'settings');
  expect(rule).not.toBeNull();
  return createDebugSession({ rule: rule!, event: click(rule!.elementId), target: 'desktop-windows', mocks: { ...MOCKS }, ...overrides });
}

function failingDispatcher(failures: Record<string, string>): FlowDispatcher {
  const record = (name: string) => () => (failures[name] ? { ok: false as const, error: failures[name] } : { ok: true as const });
  return {
    navigate: record('navigate'),
    back: record('back'),
    openScreen: record('openScreen'),
    toast: record('toast'),
    dialog: record('dialog'),
    playbackPlayPause: record('playback.playPause'),
    playbackStop: record('playback.stop'),
    playbackNextEpisode: record('playback.nextEpisode'),
    queueAdd: record('queue.add'),
    queueReplace: record('queue.replace'),
    serverConnect: record('server.connect'),
    serverReconnect: record('server.reconnect'),
    serverRetry: record('server.retry'),
    sourceRetry: record('source.retry'),
    sourceNext: record('source.next'),
    linkOpen: record('link.open'),
    telegramOpen: record('telegram.open'),
  };
}

describe('flow debugger session', () => {
  it('creates an idle session with mock environment and initial variables', () => {
    const flow = flowDoc([graphRule('rule-1', 'settings-continue', graph([node('t', 'trigger')], []))], [
      { id: 'v1', name: 'Retries', type: 'number', initial: 0 },
    ]);
    const session = createSessionFor(flow, { variables: flow.variables });
    expect(session.status).toBe('idle');
    expect(session.currentNodeId).toBeNull();
    expect(session.trace).toEqual([]);
    expect(session.breakpoints).toEqual([]);
    expect(session.context.serverConnected).toBe(true);
    expect(session.context.screenId).toBe('settings');
    expect(session.context.variables).toEqual({ v1: 0 });
    expect(session.event).toEqual(click('settings-continue'));
  });

  it('start runs to completion and records the trace through the mock dispatcher', () => {
    const session = createSessionFor(branchingFlow());
    startDebug(session);
    expect(session.status).toBe('completed');
    expect(session.currentNodeId).toBeNull();
    const kinds = session.trace.map((entry) => entry.kind);
    expect(kinds).toEqual(['condition', 'action']);
    expect(session.trace[0]).toMatchObject({ ruleId: 'rule-1', nodeId: 'c', condition: true });
    expect(session.trace[1]).toMatchObject({ nodeId: 'a', action: 'toast', message: 'connected' });
    expect(session.context.toast).toBe('connected');
    expect(session.trace.length).toBe(2);
  });

  it('start pauses on a node breakpoint and continue resumes to completion', () => {
    const session = createSessionFor(branchingFlow());
    addBreakpoint(session, { kind: 'node', ruleId: 'rule-1', nodeId: 'a' });
    startDebug(session);
    expect(session.status).toBe('paused');
    expect(session.currentNodeId).toBe('a');
    expect(session.trace.map((entry) => entry.nodeId)).toEqual(['c', 'a']);
    startDebug(session);
    expect(session.status).toBe('completed');
    expect(session.trace).toHaveLength(2);
  });

  it('start pauses on a rule breakpoint at the trigger before any node runs', () => {
    const session = createSessionFor(branchingFlow());
    addBreakpoint(session, { kind: 'rule', ruleId: 'rule-1' });
    startDebug(session);
    expect(session.status).toBe('paused');
    expect(session.currentNodeId).toBe('t');
    startDebug(session);
    expect(session.status).toBe('paused');
    expect(session.currentNodeId).toBe('c');
  });

  it('pause asks the next start to stop at the first node', () => {
    const session = createSessionFor(branchingFlow());
    pauseDebug(session);
    startDebug(session);
    expect(session.status).toBe('paused');
    expect(session.currentNodeId).toBe('t');
    expect(session.trace).toEqual([]);
  });

  it('stepInto pauses on every node including trigger and condition', () => {
    const session = createSessionFor(branchingFlow());
    stepInto(session);
    expect(session.status).toBe('paused');
    expect(session.currentNodeId).toBe('t');
    expect(session.trace).toEqual([]);
    stepInto(session);
    expect(session.currentNodeId).toBe('c');
    expect(session.trace.map((entry) => entry.kind)).toEqual(['condition']);
    stepInto(session);
    expect(session.currentNodeId).toBe('a');
    stepInto(session);
    expect(session.status).toBe('completed');
    expect(session.currentNodeId).toBeNull();
  });

  it('stepOver pauses only on action and result nodes', () => {
    const session = createSessionFor(branchingFlow());
    stepOver(session);
    expect(session.status).toBe('paused');
    expect(session.currentNodeId).toBe('a');
    expect(session.trace.map((entry) => entry.kind)).toEqual(['condition', 'action']);
    stepOver(session);
    expect(session.status).toBe('completed');
  });

  it('stop aborts the run and blocks further steps until reset', () => {
    const session = createSessionFor(branchingFlow());
    addBreakpoint(session, { kind: 'node', ruleId: 'rule-1', nodeId: 'a' });
    startDebug(session);
    expect(session.status).toBe('paused');
    stopDebug(session);
    expect(session.status).toBe('stopped');
    expect(session.currentNodeId).toBeNull();
    expect(session.trace.map((entry) => entry.nodeId)).toEqual(['c', 'a']);
    stepInto(session);
    startDebug(session);
    expect(session.status).toBe('stopped');
  });

  it('reset returns to idle, clears trace and keeps breakpoints', () => {
    const session = createSessionFor(branchingFlow());
    addBreakpoint(session, { kind: 'node', ruleId: 'rule-1', nodeId: 'a' });
    startDebug(session);
    expect(session.status).toBe('paused');
    resetDebug(session);
    expect(session.status).toBe('idle');
    expect(session.trace).toEqual([]);
    expect(session.currentNodeId).toBeNull();
    expect(session.breakpoints).toEqual([{ kind: 'node', ruleId: 'rule-1', nodeId: 'a' }]);
    startDebug(session);
    expect(session.status).toBe('paused');
    expect(session.currentNodeId).toBe('a');
  });

  it('variable.set updates session variables with a type check', () => {
    const flow = flowDoc([graphRule('rule-1', 'settings-continue', graph(
      [node('t', 'trigger'), node('a', 'action', 's-a')],
      [edge('e1', 't', 'a')],
    ), [
      { id: 's-a', action: { type: 'variable.set', variableId: 'v1', value: 2 } },
    ])], [{ id: 'v1', name: 'Retries', type: 'number', initial: 0 }]);
    const session = createSessionFor(flow, { variables: flow.variables });
    startDebug(session);
    expect(session.status).toBe('completed');
    expect(session.context.variables).toEqual({ v1: 2 });
  });

  it('a failing action lands on the error status with an error trace entry', () => {
    const flow = flowDoc([graphRule('rule-1', 'settings-continue', graph(
      [node('t', 'trigger'), node('a', 'action', 's-a')],
      [edge('e1', 't', 'a')],
    ), [{ id: 's-a', action: { type: 'toast', message: 'boom' } }])]);
    const session = createSessionFor(flow, { dispatcher: failingDispatcher({ toast: 'toast failed' }) });
    startDebug(session);
    expect(session.status).toBe('error');
    expect(session.trace[0]).toMatchObject({ nodeId: 'a', action: 'toast', error: 'toast failed' });
  });

  it('a failing action follows the error branch when one exists', () => {
    const flow = flowDoc([graphRule('rule-1', 'settings-continue', graph(
      [node('t', 'trigger'), node('a', 'action', 's-a'), node('e', 'result', 's-e')],
      [edge('e1', 't', 'a'), edge('e2', 'a', 'e', 'error')],
    ), [
      { id: 's-a', action: { type: 'toast', message: 'boom' } },
      { id: 's-e', action: { type: 'navigate', screenId: 'connect' } },
    ])]);
    const session = createSessionFor(flow, { dispatcher: failingDispatcher({ toast: 'toast failed' }) });
    startDebug(session);
    expect(session.status).toBe('completed');
    expect(session.trace.map((entry) => entry.nodeId)).toEqual(['a', 'e']);
    expect(session.trace[0].error).toBe('toast failed');
    expect(session.context.route).toBe('connect');
  });

  it('mocks stay local: calls are recorded and the environment snapshot is unchanged', () => {
    const mocks: DebugMocks = { ...MOCKS, serverConnected: false };
    const session = createSessionFor(branchingFlow(), { mocks });
    startDebug(session);
    expect(session.context.serverConnected).toBe(false);
    const dispatcher = createDebugDispatcher(mocks);
    dispatcher.serverConnect();
    dispatcher.playbackPlayPause();
    expect(mocks.serverConnected).toBe(true);
    expect(mocks.playbackState).toBe('playing');
    expect(session.context.serverConnected).toBe(false);
    expect(session.context.playbackState).toBe('idle');
  });

  it('a non-matching event reports not-matched', () => {
    const flow = branchingFlow();
    const rule = selectDebugRule(flow, 'settings')!;
    const session = createDebugSession({ rule, event: click('other-element'), target: 'desktop-windows', mocks: { ...MOCKS } });
    startDebug(session);
    expect(session.status).toBe('not-matched');
    expect(session.trace).toEqual([]);
  });

  it('selectDebugRule returns null when the screen has no graph rule', () => {
    expect(selectDebugRule(flowDoc([]), 'settings')).toBeNull();
  });

  it('removeBreakpoint drops only the matching breakpoint', () => {
    const session = createSessionFor(branchingFlow());
    addBreakpoint(session, { kind: 'node', ruleId: 'rule-1', nodeId: 'a' });
    addBreakpoint(session, { kind: 'rule', ruleId: 'rule-1' });
    removeBreakpoint(session, { kind: 'node', ruleId: 'rule-1', nodeId: 'a' });
    expect(session.breakpoints).toEqual([{ kind: 'rule', ruleId: 'rule-1' }]);
  });
});

describe('compareTraces', () => {
  const entry = (overrides: Partial<ExecutionTraceEntry>): ExecutionTraceEntry => ({ ruleId: 'rule-1', ...overrides });

  it('returns null for identical traces', () => {
    const a = [entry({ nodeId: 'c', kind: 'condition', condition: true }), entry({ nodeId: 'a', kind: 'action', action: 'toast' })];
    expect(compareTraces(a, a.map((item) => ({ ...item })))).toBeNull();
  });

  it('finds the first differing entry', () => {
    const a = [entry({ nodeId: 'c', kind: 'condition', condition: true }), entry({ nodeId: 'a', kind: 'action', action: 'toast' })];
    const b = [entry({ nodeId: 'c', kind: 'condition', condition: false }), entry({ nodeId: 'a', kind: 'action', action: 'toast' })];
    expect(compareTraces(a, b)).toEqual({ index: 0, first: a[0], second: b[0] });
  });

  it('reports a length mismatch as a difference', () => {
    const a = [entry({ nodeId: 'c', kind: 'condition', condition: true })];
    const b = [...a, entry({ nodeId: 'a', kind: 'action', action: 'toast' })];
    expect(compareTraces(a, b)).toEqual({ index: 1, first: null, second: b[1] });
    expect(compareTraces(b, a)).toEqual({ index: 1, first: b[1], second: null });
  });
});

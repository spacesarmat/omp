import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  beginFlowSession,
  executeFlow,
  executeGraphRule,
  resetFlowSession,
  type FlowDispatcher,
} from '../../design/flow-graph';
import { createDefaultFlow } from '../../design/defaults';
import type {
  FlowDocument,
  FlowEdge,
  FlowEdgeBranch,
  FlowEnvironment,
  FlowGraph,
  FlowNodeKind,
  FlowNodeView,
  FlowVariable,
  InteractionRule,
  InteractionStep,
} from '../../design/schema';

const BASE = '0000000000000000000000000000000000000000';

const ENV: FlowEnvironment = {
  target: 'desktop-windows',
  screenId: 'settings',
  serverConnected: true,
  networkOnline: true,
  accountSignedIn: false,
  playbackState: 'idle',
  downloadState: 'idle',
};

function node(id: string, kind: FlowNodeKind, x: number, stepId?: string): FlowNodeView {
  return stepId ? { id, kind, stepId, x, y: 0 } : { id, kind, x, y: 0 };
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

function graphRule(id: string, elementId: string, g: FlowGraph, steps: InteractionStep[] = [], extra: Partial<InteractionRule> = {}): InteractionRule {
  return {
    id,
    screenId: '*',
    elementId,
    event: 'click',
    action: { type: 'toast', message: 'unused legacy action' },
    graph: g,
    steps,
    ...extra,
  };
}

function stepsRule(id: string, elementId: string, steps: InteractionStep[], action: InteractionRule['action']): InteractionRule {
  return { id, screenId: '*', elementId, event: 'click', steps, action };
}

function makeDispatcher(calls: string[], failures: Record<string, string> = {}, throwers: string[] = []): FlowDispatcher {
  const record = (name: string) => (...args: string[]) => {
    calls.push(args.length ? `${name}(${args.join(',')})` : name);
    if (throwers.includes(name)) throw new Error(`${name} exploded`);
    return failures[name] ? { ok: false as const, error: failures[name] } : { ok: true as const };
  };
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

const click = (elementId: string, screenId = 'settings') => ({ type: 'click' as const, screenId, elementId });

beforeEach(() => {
  beginFlowSession(ENV);
});

afterEach(() => {
  resetFlowSession();
});

describe('flow graph interpreter', () => {
  it('legacy rules keep precedence over graph rules', () => {
    const flow = flowDoc([
      graphRule('graph', 'settings-continue', graph(
        [node('t', 'trigger', 0), node('a', 'action', 1, 's1')],
        [edge('e1', 't', 'a')],
      ), [{ id: 's1', action: { type: 'toast', message: 'graph ran' } }]),
      { id: 'legacy', screenId: '*', elementId: 'settings-continue', event: 'click', action: { type: 'navigate', screenId: 'library' } },
    ]);
    const calls: string[] = [];
    const result = executeFlow(flow, click('settings-continue'), makeDispatcher(calls));
    expect(calls).toEqual(['navigate(library)']);
    expect(result.matched).toBe('legacy');
    expect(result.status).toBe('completed');
  });

  it('runs a graph rule only when no legacy rule matches', () => {
    const flow = flowDoc([
      graphRule('graph', 'settings-continue', graph(
        [node('t', 'trigger', 0), node('a', 'action', 1, 's1')],
        [edge('e1', 't', 'a')],
      ), [{ id: 's1', action: { type: 'toast', message: 'graph ran' } }]),
    ]);
    const calls: string[] = [];
    const result = executeFlow(flow, click('settings-continue'), makeDispatcher(calls));
    expect(calls).toEqual(['toast(graph ran)']);
    expect(result.matched).toBe('graph');
    expect(result.status).toBe('completed');
  });

  it('follows true and false branches of a condition node', () => {
    const flow = flowDoc([
      graphRule('branch', 'settings-continue', graph(
        [node('t', 'trigger', 0), node('c', 'condition', 1, 'check'), node('yes', 'action', 2, 'on-yes'), node('no', 'action', 3, 'on-no')],
        [edge('e1', 't', 'c'), edge('e2', 'c', 'yes', 'true'), edge('e3', 'c', 'no', 'false')],
      ), [
        { id: 'check', condition: { kind: 'eq', path: 'server.connected', value: true } },
        { id: 'on-yes', action: { type: 'toast', message: 'yes' } },
        { id: 'on-no', action: { type: 'toast', message: 'no' } },
      ]),
    ]);
    const calls: string[] = [];
    executeFlow(flow, click('settings-continue'), makeDispatcher(calls));
    expect(calls).toEqual(['toast(yes)']);
    beginFlowSession({ ...ENV, serverConnected: false });
    executeFlow(flow, click('settings-continue'), makeDispatcher(calls));
    expect(calls).toEqual(['toast(yes)', 'toast(no)']);
  });

  it('routes dispatcher errors to the error branch and stops without one', () => {
    const withErrorBranch = flowDoc([
      graphRule('recover', 'settings-continue', graph(
        [node('t', 'trigger', 0), node('a', 'action', 1, 'go'), node('e', 'action', 2, 'fix')],
        [edge('e1', 't', 'a'), edge('e2', 'a', 'e', 'error')],
      ), [
        { id: 'go', action: { type: 'navigate', screenId: 'library' } },
        { id: 'fix', action: { type: 'toast', message: 'recovered' } },
      ]),
    ]);
    const calls: string[] = [];
    const recovered = executeFlow(withErrorBranch, click('settings-continue'), makeDispatcher(calls, { navigate: 'storage full' }));
    expect(calls).toEqual(['navigate(library)', 'toast(recovered)']);
    expect(recovered.status).toBe('completed');

    const withoutErrorBranch = flowDoc([
      graphRule('fail', 'settings-continue', graph(
        [node('t', 'trigger', 0), node('a', 'action', 1, 'go')],
        [edge('e1', 't', 'a')],
      ), [{ id: 'go', action: { type: 'navigate', screenId: 'library' } }]),
    ]);
    calls.length = 0;
    const failed = executeFlow(withoutErrorBranch, click('settings-continue'), makeDispatcher(calls, { navigate: 'storage full' }));
    expect(failed.status).toBe('error');
    expect(failed.error).toBe('storage full');
    expect(calls).toEqual(['navigate(library)']);
  });

  it('treats a synchronous dispatcher throw as an action error', () => {
    const flow = flowDoc([
      graphRule('throw', 'settings-continue', graph(
        [node('t', 'trigger', 0), node('a', 'action', 1, 'go')],
        [edge('e1', 't', 'a')],
      ), [{ id: 'go', action: { type: 'navigate', screenId: 'library' } }]),
    ]);
    const calls: string[] = [];
    const result = executeFlow(flow, click('settings-continue'), makeDispatcher(calls, {}, ['navigate']));
    expect(result.status).toBe('error');
    expect(result.error).toContain('exploded');
  });

  it('keeps typed variables in the session until reset', () => {
    const variables: FlowVariable[] = [
      { id: 'counter', name: 'Counter', type: 'number', initial: 0 },
      { id: 'mode', name: 'Mode', type: 'enum', initial: 'a', values: ['a', 'b'] },
    ];
    const flow = flowDoc([
      stepsRule('set-counter', 'inc', [{ id: 's1', action: { type: 'variable.set', variableId: 'counter', value: 5 } }], { type: 'navigate', screenId: 'library' }),
      stepsRule('check-counter', 'check', [{ id: 's1', condition: { kind: 'eq', path: 'variable.counter', value: 5 }, action: { type: 'toast', message: 'five' } }], { type: 'back' }),
    ], variables);
    const calls: string[] = [];
    const first = executeFlow(flow, click('inc'), makeDispatcher(calls));
    expect(first.variables).toEqual({ counter: 5, mode: 'a' });
    executeFlow(flow, click('check'), makeDispatcher(calls));
    expect(calls).toEqual(['navigate(library)', 'toast(five)', 'back']);
    resetFlowSession();
    const afterReset = executeFlow(flow, click('check'), makeDispatcher(calls));
    expect(afterReset.variables).toEqual({ counter: 0, mode: 'a' });
    expect(calls).toEqual(['navigate(library)', 'toast(five)', 'back']);
  });

  it('stops after 32 steps', () => {
    const nodes = [node('t', 'trigger', 0)];
    const edges: FlowEdge[] = [];
    let previous = 't';
    for (let index = 1; index <= 40; index += 1) {
      const id = `a${index}`;
      nodes.push(node(id, 'action', index, 'tick'));
      edges.push(edge(`e${index}`, previous, id));
      previous = id;
    }
    const flow = flowDoc([
      graphRule('long', 'settings-continue', graph(nodes, edges), [{ id: 'tick', action: { type: 'toast', message: 'tick' } }]),
    ]);
    const calls: string[] = [];
    const result = executeFlow(flow, click('settings-continue'), makeDispatcher(calls));
    expect(result.status).toBe('step-limit');
    expect(result.steps).toBe(32);
    expect(calls).toHaveLength(32);
  });

  it('collects one trace per event', () => {
    const flow = flowDoc([
      graphRule('trace', 'settings-continue', graph(
        [node('t', 'trigger', 0), node('c', 'condition', 1, 'check'), node('a1', 'action', 2, 's1'), node('a2', 'action', 3, 's2')],
        [edge('e1', 't', 'c'), edge('e2', 'c', 'a1', 'true'), edge('e3', 'a1', 'a2')],
      ), [
        { id: 'check', condition: { kind: 'eq', path: 'server.connected', value: true } },
        { id: 's1', action: { type: 'toast', message: 'one' } },
        { id: 's2', action: { type: 'toast', message: 'two' } },
      ]),
    ]);
    const calls: string[] = [];
    const first = executeFlow(flow, click('settings-continue'), makeDispatcher(calls));
    expect(first.trace.map((entry) => entry.kind)).toEqual(['condition', 'action', 'action']);
    const snapshot = first.trace;
    executeFlow(flow, click('settings-continue'), makeDispatcher(calls));
    expect(snapshot).toHaveLength(3);
    expect(first.trace).not.toBe(executeFlow(flow, click('settings-continue'), makeDispatcher(calls)).trace);
  });

  it('completes a terminal action without a result node', () => {
    const flow = flowDoc([
      graphRule('terminal', 'settings-continue', graph(
        [node('t', 'trigger', 0), node('a', 'action', 1, 'go'), node('b', 'action', 2, 'never')],
        [edge('e1', 't', 'a'), edge('e2', 'a', 'b')],
      ), [
        { id: 'go', action: { type: 'navigate', screenId: 'library' } },
        { id: 'never', action: { type: 'toast', message: 'never' } },
      ]),
    ]);
    const calls: string[] = [];
    const result = executeFlow(flow, click('settings-continue'), makeDispatcher(calls));
    expect(result.status).toBe('completed');
    expect(result.error).toBeUndefined();
    expect(calls).toEqual(['navigate(library)']);
    expect(result.route).toBe('library');
  });

  it('ends without action when the matching branch is missing', () => {
    const flow = flowDoc([
      graphRule('dangling', 'settings-continue', graph(
        [node('t', 'trigger', 0), node('c', 'condition', 1, 'check'), node('a', 'action', 2, 's1')],
        [edge('e1', 't', 'c'), edge('e2', 'c', 'a', 'true')],
      ), [
        { id: 'check', condition: { kind: 'eq', path: 'server.connected', value: true } },
        { id: 's1', action: { type: 'toast', message: 'unreachable' } },
      ]),
    ]);
    const calls: string[] = [];
    beginFlowSession({ ...ENV, serverConnected: false });
    const result = executeFlow(flow, click('settings-continue'), makeDispatcher(calls));
    expect(result.status).toBe('completed');
    expect(calls).toEqual([]);
  });

  it('runs ordered steps without a graph', () => {
    const flow = flowDoc([
      stepsRule('chain', 'settings-continue', [
        { id: 's1', action: { type: 'toast', message: 'one' } },
        { id: 's2', action: { type: 'toast', message: 'two' } },
      ], { type: 'navigate', screenId: 'library' }),
    ]);
    const calls: string[] = [];
    const result = executeFlow(flow, click('settings-continue'), makeDispatcher(calls));
    expect(calls).toEqual(['toast(one)', 'toast(two)', 'navigate(library)']);
    expect(result.status).toBe('completed');
  });

  it('stops ordered steps when a condition fails', () => {
    const flow = flowDoc([
      stepsRule('gated', 'settings-continue', [
        { id: 's1', condition: { kind: 'eq', path: 'server.connected', value: true }, action: { type: 'toast', message: 'gated' } },
        { id: 's2', action: { type: 'toast', message: 'after' } },
      ], { type: 'navigate', screenId: 'library' }),
    ]);
    const calls: string[] = [];
    beginFlowSession({ ...ENV, serverConnected: false });
    executeFlow(flow, click('settings-continue'), makeDispatcher(calls));
    expect(calls).toEqual([]);
  });

  it('reports not-matched when no rule fits', () => {
    const calls: string[] = [];
    const result = executeFlow(flowDoc([]), click('settings-continue'), makeDispatcher(calls));
    expect(result.status).toBe('not-matched');
    expect(result.matched).toBeNull();
    expect(result.trace).toEqual([]);
    expect(result.steps).toBe(0);
  });

  it('executes legacy documents through the legacy path', () => {
    const calls: string[] = [];
    beginFlowSession({ ...ENV, serverConnected: false });
    const result = executeFlow(createDefaultFlow(BASE), click('settings-continue'), makeDispatcher(calls));
    expect(calls).toEqual(['navigate(connect)']);
    expect(result.matched).toBe('legacy');
    expect(result.route).toBe('connect');
  });

  it('treats a result node as the terminal collector', () => {
    const flow = flowDoc([
      graphRule('collect', 'settings-continue', graph(
        [node('t', 'trigger', 0), node('a', 'action', 1, 's1'), node('r', 'result', 2, 'fin')],
        [edge('e1', 't', 'a'), edge('e2', 'a', 'r')],
      ), [
        { id: 's1', action: { type: 'toast', message: 'done' } },
        { id: 'fin', action: { type: 'navigate', screenId: 'library' } },
      ]),
    ]);
    const calls: string[] = [];
    const result = executeFlow(flow, click('settings-continue'), makeDispatcher(calls));
    expect(calls).toEqual(['toast(done)', 'navigate(library)']);
    expect(result.status).toBe('completed');
    expect(result.route).toBe('library');
    expect(result.trace[result.trace.length - 1]).toMatchObject({ kind: 'result' });
  });

  it('executeGraphRule skips a rule whose trigger does not match', () => {
    const rule = graphRule('scoped', 'settings-continue', graph(
      [node('t', 'trigger', 0), node('a', 'action', 1, 's1')],
      [edge('e1', 't', 'a')],
    ), [{ id: 's1', action: { type: 'toast', message: 'hi' } }], { screenId: 'settings' });
    const calls: string[] = [];
    const result = executeGraphRule(rule, click('settings-continue', 'library'), makeDispatcher(calls), []);
    expect(result.status).toBe('not-matched');
    expect(calls).toEqual([]);
  });

  it('runs timer triggers only from explicit timer events without background execution', () => {
    const flow = flowDoc([
      graphRule('heartbeat', '*', graph(
        [node('t', 'trigger', 0), node('a', 'action', 1, 's1')],
        [edge('e1', 't', 'a')],
      ), [{ id: 's1', action: { type: 'toast', message: 'tick' } }], { event: 'timer', intervalMs: 60000 }),
    ]);
    const calls: string[] = [];
    const timer = executeFlow(flow, { type: 'timer', screenId: 'settings', elementId: 'heartbeat' }, makeDispatcher(calls));
    expect(timer.matched).toBe('graph');
    expect(calls).toEqual(['toast(tick)']);
    executeFlow(flow, click('heartbeat'), makeDispatcher(calls));
    expect(calls).toEqual(['toast(tick)']);
  });

  it('applies cooldownMs between repeated triggers', () => {
    const flow = flowDoc([
      graphRule('cool', 'settings-continue', graph(
        [node('t', 'trigger', 0), node('a', 'action', 1, 's1')],
        [edge('e1', 't', 'a')],
      ), [{ id: 's1', action: { type: 'toast', message: 'once' } }], { cooldownMs: 50000 }),
    ]);
    const calls: string[] = [];
    const first = executeFlow(flow, click('settings-continue'), makeDispatcher(calls));
    expect(first.matched).toBe('graph');
    const second = executeFlow(flow, click('settings-continue'), makeDispatcher(calls));
    expect(second.status).toBe('not-matched');
    expect(calls).toHaveLength(1);
    resetFlowSession();
    beginFlowSession(ENV);
    const third = executeFlow(flow, click('settings-continue'), makeDispatcher(calls));
    expect(third.matched).toBe('graph');
    expect(calls).toHaveLength(2);
  });
});

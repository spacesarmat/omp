import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowDocument, InteractionRule } from '../../design/schema';
import type { FlowDispatcher } from '../../design/flow-graph';
import type { ProductionFlowOptions } from '../../design/production-flow';

const generated = vi.hoisted(() => ({
  flow: {
    schemaVersion: 1,
    id: 'desktop-default',
    baseCommit: '0'.repeat(40),
    rules: [],
  } as FlowDocument,
}));

vi.mock('../../design/generated/flow.ts', () => ({ PRODUCTION_FLOW: generated.flow }));

import {
  activateProductionFlow,
  createFlowExportPlan,
  diffFlowDocuments,
  installProductionFlow,
} from '../../design/production-flow';
import { executeFlow, resetFlowSession } from '../../design/flow-graph';

function rule(patch: Partial<InteractionRule> & Pick<InteractionRule, 'id' | 'elementId'>): InteractionRule {
  return {
    screenId: '*',
    event: 'click',
    action: { type: 'navigate', screenId: 'library' },
    ...patch,
  };
}

function eventRule(id: string, elementId: string, event: InteractionRule['event'], message: string): InteractionRule {
  return {
    ...rule({ id, elementId, event, action: { type: 'back' } }),
    steps: [{ id: `${id}-s1`, action: { type: 'toast', message } }],
    graph: {
      nodes: [
        { id: `${id}-n1`, kind: 'trigger', x: 0, y: 0 },
        { id: `${id}-n2`, kind: 'action', stepId: `${id}-s1`, x: 1, y: 0 },
      ],
      edges: [{ id: `${id}-e1`, from: `${id}-n1`, to: `${id}-n2`, branch: 'default' }],
    },
  };
}

function timerRule(id: string, elementId = '*', message = 'tick'): InteractionRule {
  return {
    ...eventRule(id, elementId, 'timer', message),
    intervalMs: 1000,
  };
}

function flowDoc(rules: InteractionRule[], variables?: FlowDocument['variables']): FlowDocument {
  return {
    schemaVersion: 1,
    id: 'desktop-default',
    baseCommit: '0'.repeat(40),
    rules,
    ...(variables ? { variables } : {}),
  };
}

interface DispatcherSpy {
  dispatcher: FlowDispatcher;
  calls: string[];
}

function dispatcherSpy(): DispatcherSpy {
  const calls: string[] = [];
  const record = (name: string, arg?: string) => {
    calls.push(arg === undefined ? name : `${name}:${arg}`);
    return { ok: true };
  };
  const dispatcher: FlowDispatcher = {
    navigate: (screenId) => record('navigate', screenId),
    back: () => record('back'),
    openScreen: (screenId) => record('openScreen', screenId),
    toast: (message) => record('toast', message),
    dialog: (title) => record('dialog', title),
    playbackPlayPause: () => record('playbackPlayPause'),
    playbackStop: () => record('playbackStop'),
    playbackNextEpisode: () => record('playbackNextEpisode'),
    queueAdd: () => record('queueAdd'),
    queueReplace: () => record('queueReplace'),
    serverConnect: () => record('serverConnect'),
    serverReconnect: () => record('serverReconnect'),
    serverRetry: () => record('serverRetry'),
    sourceRetry: () => record('sourceRetry'),
    sourceNext: () => record('sourceNext'),
    linkOpen: (url) => record('linkOpen', url),
    telegramOpen: (target) => record('telegramOpen', target),
  };
  return { dispatcher, calls };
}

function optionsFor(spy: DispatcherSpy, patch: Partial<ProductionFlowOptions> = {}): ProductionFlowOptions {
  return {
    target: 'desktop-windows',
    screenOf: () => 'settings',
    environment: () => ({
      serverConnected: false,
      networkOnline: true,
      accountSignedIn: false,
      playbackState: 'idle',
      downloadState: 'idle',
    }),
    dispatcher: spy.dispatcher,
    ...patch,
  };
}

function click(root: HTMLElement, elementId: string): void {
  const element = root.querySelector(`[data-design-id="${elementId}"]`);
  if (!element) throw new Error(`no element ${elementId}`);
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

beforeEach(() => {
  generated.flow.rules = [];
});

afterEach(() => {
  vi.useRealTimers();
  resetFlowSession();
  document.body.innerHTML = '';
});

describe('installProductionFlow', () => {
  it('stays a no-op until an export writes a nonempty flow document', () => {
    const spy = dispatcherSpy();
    const root = document.createElement('div');
    root.innerHTML = '<button data-design-id="settings-continue">Go</button>';
    document.body.appendChild(root);
    const stop = installProductionFlow(root, optionsFor(spy));
    click(root, 'settings-continue');
    expect(spy.calls).toEqual([]);
    stop();
    click(root, 'settings-continue');
    expect(spy.calls).toEqual([]);
  });

  it('runs exported click rules through the typed dispatcher', () => {
    generated.flow.rules = [rule({ id: 'go', elementId: 'settings-continue', action: { type: 'navigate', screenId: 'library' } })];
    const spy = dispatcherSpy();
    const root = document.createElement('div');
    root.innerHTML = '<button data-design-id="settings-continue">Go</button><button data-design-id="other">Other</button>';
    document.body.appendChild(root);
    installProductionFlow(root, optionsFor(spy));
    click(root, 'settings-continue');
    expect(spy.calls).toEqual(['navigate:library']);
    spy.calls.length = 0;
    click(root, 'other');
    expect(spy.calls).toEqual([]);
  });

  it('ignores clicks on elements without a design identity', () => {
    generated.flow.rules = [rule({ id: 'go', elementId: 'settings-continue' })];
    const spy = dispatcherSpy();
    const root = document.createElement('div');
    root.innerHTML = '<button>Plain</button><span><b data-design-id="settings-continue">Deep</b></span>';
    document.body.appendChild(root);
    installProductionFlow(root, optionsFor(spy));
    root.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(spy.calls).toEqual([]);
    click(root, 'settings-continue');
    expect(spy.calls).toEqual(['navigate:library']);
  });

  it('keeps legacy precedence over graph rules with legacy error semantics', () => {
    generated.flow.rules = [
      rule({ id: 'legacy-go', elementId: 'settings-continue', action: { type: 'navigate', screenId: 'library' } }),
      {
        ...rule({ id: 'graph-go', elementId: 'settings-continue', action: { type: 'back' } }),
        steps: [{ id: 's1', action: { type: 'toast', message: 'from graph' } }],
      },
    ];
    const spy = dispatcherSpy();
    const root = document.createElement('div');
    root.innerHTML = '<button data-design-id="settings-continue">Go</button>';
    document.body.appendChild(root);
    installProductionFlow(root, optionsFor(spy));
    click(root, 'settings-continue');
    expect(spy.calls).toEqual(['navigate:library']);
  });

  it('matches executeFlow behavior one to one (preview/production parity)', () => {
    const graphRule: InteractionRule = {
      id: 'graph-go',
      screenId: 'settings',
      elementId: 'settings-continue',
      event: 'click',
      action: { type: 'back' },
      steps: [{ id: 's1', action: { type: 'toast', message: 'from graph' } }],
      graph: {
        nodes: [
          { id: 'n1', kind: 'trigger', x: 0, y: 0 },
          { id: 'n2', kind: 'action', stepId: 's1', x: 1, y: 1 },
        ],
        edges: [{ id: 'e1', from: 'n1', to: 'n2', branch: 'default' }],
      },
    };
    const document_ = flowDoc([
      rule({ id: 'legacy-other', elementId: 'elsewhere', action: { type: 'navigate', screenId: 'news' } }),
      graphRule,
    ]);
    generated.flow.rules = document_.rules;
    const direct = executeFlow(document_, { type: 'click', screenId: 'settings', elementId: 'settings-continue' }, dispatcherSpy().dispatcher);
    expect(direct.matched).toBe('graph');
    expect(direct.toast).toBe('from graph');

    const spy = dispatcherSpy();
    const root = document.createElement('div');
    root.innerHTML = '<button data-design-id="settings-continue">Go</button>';
    document.body.appendChild(root);
    installProductionFlow(root, optionsFor(spy, { screenOf: () => 'settings' }));
    click(root, 'settings-continue');
    expect(spy.calls).toEqual(['toast:from graph']);
  });

  it('publishes typed non-click events through the provided app publishers', () => {
    generated.flow.rules = [
      eventRule('up', 'status', 'server.connected', 'server up'),
      eventRule('down', 'status', 'server.disconnected', 'server down'),
    ];
    const spy = dispatcherSpy();
    let notifyServer: ((connected: boolean) => void) | undefined;
    const root = document.createElement('div');
    document.body.appendChild(root);
    installProductionFlow(root, optionsFor(spy, {
      publishers: {
        subscribeServer: (notify) => {
          notifyServer = notify;
          return () => undefined;
        },
      },
    }));
    notifyServer?.(true);
    notifyServer?.(true);
    notifyServer?.(false);
    expect(spy.calls).toEqual(['toast:server up', 'toast:server down']);
  });

  it('re-evaluates conditions against the published environment state', () => {
    generated.flow.rules = [
      {
        ...eventRule('offline', 'status', 'server.disconnected', 'offline'),
        condition: { kind: 'eq', path: 'network.online', value: false },
      },
    ];
    const spy = dispatcherSpy();
    let notifyServer: ((connected: boolean) => void) | undefined;
    let notifyNetwork: ((online: boolean) => void) | undefined;
    const root = document.createElement('div');
    document.body.appendChild(root);
    installProductionFlow(root, optionsFor(spy, {
      environment: () => ({
        serverConnected: true,
        networkOnline: true,
        accountSignedIn: false,
        playbackState: 'idle',
        downloadState: 'idle',
      }),
      publishers: {
        subscribeServer: (notify) => {
          notifyServer = notify;
          return () => undefined;
        },
        subscribeNetwork: (notify) => {
          notifyNetwork = notify;
          return () => undefined;
        },
      },
    }));
    notifyServer?.(false);
    expect(spy.calls).toEqual([]);
    notifyServer?.(true);
    notifyNetwork?.(false);
    notifyServer?.(false);
    expect(spy.calls).toEqual(['toast:offline']);
  });

  it('emits screen.leave before screen.enter when the app screen changes', () => {
    generated.flow.rules = [
      eventRule('leave', 'chrome', 'screen.leave', 'left settings'),
      eventRule('enter', 'chrome', 'screen.enter', 'entered library'),
    ];
    const spy = dispatcherSpy();
    let current = 'settings';
    let notifyScreen: (() => void) | undefined;
    const root = document.createElement('div');
    document.body.appendChild(root);
    installProductionFlow(root, optionsFor(spy, {
      screenOf: () => current,
      subscribeScreen: (notify) => {
        notifyScreen = notify;
        return () => undefined;
      },
    }));
    current = 'library';
    notifyScreen?.();
    expect(spy.calls).toEqual(['toast:left settings', 'toast:entered library']);
    notifyScreen?.();
    expect(spy.calls).toEqual(['toast:left settings', 'toast:entered library']);
  });

  it('starts timers only for an exported document and stops them on uninstall', () => {
    vi.useFakeTimers();
    generated.flow.rules = [
      timerRule('tick'),
    ];
    const spy = dispatcherSpy();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const stop = installProductionFlow(root, optionsFor(spy));
    vi.advanceTimersByTime(3500);
    expect(spy.calls).toEqual(['toast:tick', 'toast:tick', 'toast:tick']);
    stop();
    vi.advanceTimersByTime(3000);
    expect(spy.calls).toHaveLength(3);
  });

  it('does not start timers while the exported document is empty', () => {
    vi.useFakeTimers();
    const spy = dispatcherSpy();
    const root = document.createElement('div');
    document.body.appendChild(root);
    installProductionFlow(root, optionsFor(spy));
    vi.advanceTimersByTime(10000);
    expect(spy.calls).toEqual([]);
  });

  it('resets the timer registry on a repeated install (repeated export)', () => {
    vi.useFakeTimers();
    generated.flow.rules = [
      timerRule('tick'),
    ];
    const spy = dispatcherSpy();
    const root = document.createElement('div');
    document.body.appendChild(root);
    installProductionFlow(root, optionsFor(spy));
    installProductionFlow(root, optionsFor(spy));
    vi.advanceTimersByTime(2500);
    expect(spy.calls).toEqual(['toast:tick', 'toast:tick']);
  });

  it('registers at most 16 timer flows', () => {
    vi.useFakeTimers();
    generated.flow.rules = Array.from({ length: 20 }, (_, index) => (
      timerRule(`tick-${index}`, `t${index}`)
    ));
    const spy = dispatcherSpy();
    const root = document.createElement('div');
    document.body.appendChild(root);
    installProductionFlow(root, optionsFor(spy));
    vi.advanceTimersByTime(1000);
    expect(spy.calls).toHaveLength(16);
  });

  it('takes over a matched click before native handlers and passes unmatched clicks through', () => {
    generated.flow.rules = [rule({ id: 'go', elementId: 'settings-continue' })];
    const spy = dispatcherSpy();
    const root = document.createElement('div');
    root.innerHTML = '<button id="native" data-design-id="settings-continue">Go</button><button id="plain" data-design-id="other">Other</button>';
    document.body.appendChild(root);
    const nativeCalls: string[] = [];
    root.querySelector('#native')!.addEventListener('click', () => nativeCalls.push('native'));
    root.querySelector('#plain')!.addEventListener('click', () => nativeCalls.push('plain'));
    installProductionFlow(root, optionsFor(spy));
    click(root, 'settings-continue');
    expect(spy.calls).toEqual(['navigate:library']);
    expect(nativeCalls).toEqual([]);
    click(root, 'other');
    expect(nativeCalls).toEqual(['plain']);
  });

  it('activateProductionFlow drives the same runtime for preview harnesses', () => {
    const document_ = flowDoc([rule({ id: 'go', elementId: 'settings-continue' })]);
    const spy = dispatcherSpy();
    const root = document.createElement('div');
    root.innerHTML = '<button data-design-id="settings-continue">Go</button>';
    document.body.appendChild(root);
    activateProductionFlow(root, document_, optionsFor(spy));
    click(root, 'settings-continue');
    expect(spy.calls).toEqual(['navigate:library']);
  });
});

describe('createFlowExportPlan', () => {
  const draft = () => ({
    flow: flowDoc([
      rule({ id: 'r-settings', elementId: 'settings-continue' }),
      rule({ id: 'r-library', elementId: 'card-play', screenId: 'library' }),
    ]),
  });

  it('ships the flow json and the generated production module for the all scope', () => {
    const plan = createFlowExportPlan(draft(), { kind: 'all' });
    expect(plan.flow.rules.map((entry) => entry.id)).toEqual(['r-settings', 'r-library']);
    const paths = plan.files.map((file) => file.path);
    expect(paths).toEqual(['design/flows/desktop-default.json', 'design/generated/flow.ts']);
    const jsonFile = plan.files.find((file) => file.path.endsWith('.json'))!;
    expect(JSON.parse(jsonFile.content)).toMatchObject({ id: 'desktop-default', rules: [{ id: 'r-settings' }, { id: 'r-library' }] });
    const moduleFile = plan.files.find((file) => file.path.endsWith('flow.ts'))!;
    expect(moduleFile.content).toContain('export const PRODUCTION_FLOW');
    expect(moduleFile.content).toContain('r-settings');
  });

  it('scopes a page export to the rules of that screen and the variables they use', () => {
    const scoped = draft();
    scoped.flow.rules[1] = {
      ...scoped.flow.rules[1],
      steps: [{ id: 's1', action: { type: 'variable.set', variableId: 'last-play', value: 'x' } }],
    };
    scoped.flow.variables = [
      { id: 'last-play', name: 'Last play', type: 'string', initial: '' },
      { id: 'unused', name: 'Unused', type: 'boolean', initial: false },
    ];
    const plan = createFlowExportPlan(scoped, { kind: 'page', screenId: 'library' });
    expect(plan.flow.rules.map((entry) => entry.id)).toEqual(['r-library']);
    expect(plan.flow.variables?.map((entry) => entry.id)).toEqual(['last-play']);
    expect(plan.files.map((file) => file.path)).toEqual(['design/flows/desktop-default.json']);
  });

  it('scopes a component export to the rules bound to that element', () => {
    const plan = createFlowExportPlan(draft(), { kind: 'component', nodeId: 'settings-continue' });
    expect(plan.flow.rules.map((entry) => entry.id)).toEqual(['r-settings']);
    expect(plan.files.map((file) => file.path)).toEqual(['design/flows/desktop-default.json']);
  });

  it('rejects an unknown scope shape', () => {
    expect(() => createFlowExportPlan(draft(), { kind: 'weird' })).toThrow();
    expect(() => createFlowExportPlan(draft(), { kind: 'page' })).toThrow();
  });
});

describe('diffFlowDocuments', () => {
  it('reports added, removed and changed rules, nodes, edges and variables by id', () => {
    const before = flowDoc([
      rule({ id: 'keep', elementId: 'a' }),
      rule({ id: 'gone', elementId: 'b' }),
      rule({ id: 'edited', elementId: 'c', action: { type: 'navigate', screenId: 'library' } }),
    ], [{ id: 'var-1', name: 'One', type: 'string', initial: '' }]);
    before.rules[0].graph = {
      nodes: [
        { id: 'n1', kind: 'trigger', x: 0, y: 0 },
        { id: 'n2', kind: 'action', stepId: 's1', x: 5, y: 5 },
      ],
      edges: [{ id: 'e1', from: 'n1', to: 'n2', branch: 'default' }],
    };
    const after = flowDoc([
      rule({ id: 'keep', elementId: 'a' }),
      rule({ id: 'new', elementId: 'd' }),
      rule({ id: 'edited', elementId: 'c', action: { type: 'navigate', screenId: 'news' } }),
    ], [
      { id: 'var-1', name: 'One', type: 'string', initial: 'changed' },
      { id: 'var-2', name: 'Two', type: 'number', initial: 0 },
    ]);
    after.rules[0].graph = {
      nodes: [
        { id: 'n1', kind: 'trigger', x: 40, y: 40 },
        { id: 'n3', kind: 'action', stepId: 's2', x: 6, y: 6 },
      ],
      edges: [{ id: 'e2', from: 'n1', to: 'n3', branch: 'default' }],
    };
    const diff = diffFlowDocuments(before, after);
    expect(diff.rules.added).toEqual(['new']);
    expect(diff.rules.removed).toEqual(['gone']);
    expect(diff.rules.changed).toEqual(['edited']);
    expect(diff.nodes.added).toEqual(['n3']);
    expect(diff.nodes.removed).toEqual(['n2']);
    expect(diff.nodes.changed).toEqual([]);
    expect(diff.edges.added).toEqual(['e2']);
    expect(diff.edges.removed).toEqual(['e1']);
    expect(diff.variables.added).toEqual(['var-2']);
    expect(diff.variables.changed).toEqual(['var-1']);
  });

  it('reports a node as changed when its rule or step binding changes, not on moves', () => {
    const before = flowDoc([rule({ id: 'r', elementId: 'a' })]);
    before.rules[0].graph = {
      nodes: [{ id: 'n1', kind: 'action', stepId: 's1', x: 0, y: 0 }],
      edges: [],
    };
    const after = flowDoc([rule({ id: 'r', elementId: 'a' })]);
    after.rules[0].graph = {
      nodes: [
        { id: 'n1', kind: 'action', stepId: 's1', x: 300, y: 200 },
        { id: 'n2', kind: 'action', stepId: 's2', x: 0, y: 0 },
      ],
      edges: [],
    };
    const diff = diffFlowDocuments(before, after);
    expect(diff.nodes.changed).toEqual([]);
    expect(diff.nodes.added).toEqual(['n2']);
  });
});

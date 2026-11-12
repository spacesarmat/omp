import { describe, expect, it } from 'vitest';
import { FLOW_TEMPLATES, instantiateFlowTemplate, type FlowTemplateId } from '../../design/flow-templates';
import type { FlowDocument } from '../../design/schema';
import { validateFlow } from '../../design/flow-validation';
import { validateFlowGraph } from '../../design/flow-validation-graph';
import { beginFlowSession, executeFlow, resetFlowSession } from '../../design/flow-graph';
import { DESKTOP_ROUTES } from '../../desktop/src/shell/routes';

const ROUTE_IDS = DESKTOP_ROUTES.map((route) => route.id);

const TEMPLATE_IDS: FlowTemplateId[] = ['connect-server', 'offline-retry', 'episode-queue', 'playback-fallback', 'restore-position'];

function createContext(overrides: Record<string, unknown> = {}) {
  return { id: 'tpl-doc', baseCommit: '0'.repeat(40), ...overrides };
}

function allIds(flow: FlowDocument): string[] {
  const ids: string[] = [];
  for (const rule of flow.rules) {
    ids.push(rule.id);
    for (const step of rule.steps ?? []) ids.push(step.id);
    for (const node of rule.graph?.nodes ?? []) ids.push(node.id);
    for (const edge of rule.graph?.edges ?? []) ids.push(edge.id);
  }
  for (const variable of flow.variables ?? []) ids.push(variable.id);
  return ids;
}

function expectValid(flow: FlowDocument) {
  expect(validateFlow(flow, ROUTE_IDS)).toEqual([]);
  expect(validateFlowGraph(flow, ROUTE_IDS)).toEqual([]);
}

describe('FLOW_TEMPLATES', () => {
  it('lists exactly the five template ids', () => {
    expect(FLOW_TEMPLATES.map((template) => template.id)).toEqual(TEMPLATE_IDS);
    for (const template of FLOW_TEMPLATES) {
      expect(template.title.trim()).not.toBe('');
      expect(template.description.trim()).not.toBe('');
    }
  });
});

describe('instantiateFlowTemplate', () => {
  it('creates a valid document for every template', () => {
    for (const id of TEMPLATE_IDS) {
      const flow = instantiateFlowTemplate(id, createContext());
      expect(flow.schemaVersion).toBe(1);
      expect(flow.id).toBe('tpl-doc');
      expect(flow.baseCommit).toBe('0'.repeat(40));
      expect(flow.rules.length).toBeGreaterThan(0);
      expectValid(flow);
    }
  });

  it('generates new unique ids on every instantiation', () => {
    for (const id of TEMPLATE_IDS) {
      const first = instantiateFlowTemplate(id, createContext());
      const second = instantiateFlowTemplate(id, createContext());
      const firstIds = new Set(allIds(first));
      for (const entry of allIds(second)) expect(firstIds.has(entry)).toBe(false);
      expect(new Set(allIds(first)).size).toBe(allIds(first).length);
    }
  });

  it('does not mutate the source template when the result is edited', () => {
    const snapshot = JSON.stringify(FLOW_TEMPLATES);
    const flow = instantiateFlowTemplate('connect-server', createContext());
    const first = flow.rules[0]!;
    first.id = 'hacked-rule';
    first.graph!.nodes[0]!.id = 'hacked-node';
    first.graph!.edges[0]!.from = 'hacked-node';
    const again = instantiateFlowTemplate('connect-server', createContext());
    expect(JSON.stringify(FLOW_TEMPLATES)).toBe(snapshot);
    expect(again.rules[0]!.id).not.toBe('hacked-rule');
    expect(again.rules[0]!.graph!.nodes[0]!.id).not.toBe('hacked-node');
  });

  it('throws for an unknown template id', () => {
    expect(() => instantiateFlowTemplate('nope' as FlowTemplateId, createContext())).toThrow(/unknown flow template/i);
  });

  it('applies context screen, element and route without secrets', () => {
    const flow = instantiateFlowTemplate('connect-server', createContext({ screenId: 'settings', elementId: 'my-continue', routeId: 'news' }));
    const rule = flow.rules[0];
    expect(rule.screenId).toBe('settings');
    expect(rule.elementId).toBe('my-continue');
    const steps = rule.steps ?? [];
    expect(steps.some((step) => step.action?.type === 'navigate' && step.action.screenId === 'news')).toBe(true);
    expectValid(flow);
  });

  it('restore-position declares variables from saved context values', () => {
    const flow = instantiateFlowTemplate('restore-position', createContext({ savedRoute: 'search', savedPosition: 120, savedElement: 'card-7' }));
    const stripToken = (value: string) => value.replace(/-[0-9a-f]{12}$/, '');
    const variables = new Map((flow.variables ?? []).map((variable) => [stripToken(variable.id), variable]));
    expect([...variables.keys()].sort()).toEqual(['return-element', 'return-position', 'return-route']);
    expect(variables.get('return-route')?.initial).toBe('search');
    expect(variables.get('return-position')?.initial).toBe(120);
    expect(variables.get('return-element')?.initial).toBe('card-7');
    const steps = flow.rules.flatMap((rule) => rule.steps ?? []);
    const positionSet = steps.find((step) => step.action?.type === 'variable.set' && stripToken(step.action.variableId) === 'return-position');
    expect(positionSet?.action).toMatchObject({ value: 120 });
    expectValid(flow);
  });
});

describe('template runtime behavior', () => {
  it('connect-server navigates to the catalog when the server is connected', () => {
    const flow = instantiateFlowTemplate('connect-server', createContext());
    beginFlowSession({ target: 'desktop-windows', screenId: 'connect', serverConnected: true, networkOnline: true, accountSignedIn: false, playbackState: 'idle', downloadState: 'idle' });
    try {
      const result = executeFlow(flow, { type: 'click', screenId: 'connect', elementId: 'connect-continue' }, dispatcher());
      expect(result.matched).toBe('graph');
      expect(result.route).toBe('library');
    } finally {
      resetFlowSession();
    }
  });

  it('playback-fallback reports the error branch when the next source fails', () => {
    const flow = instantiateFlowTemplate('playback-fallback', createContext());
    beginFlowSession({ target: 'desktop-windows', screenId: 'remote', serverConnected: true, networkOnline: true, accountSignedIn: false, playbackState: 'idle', downloadState: 'idle' });
    try {
      const result = executeFlow(flow, { type: 'click', screenId: 'remote', elementId: 'source-fallback' }, dispatcher({ fail: ['sourceNext'] }));
      expect(result.matched).toBe('graph');
      expect(result.toast).toBe('Не удалось открыть другой источник');
    } finally {
      resetFlowSession();
    }
  });
});

function dispatcher(overrides: { fail?: string[] } = {}) {
  const failing = new Set(overrides.fail ?? []);
  const ok = (name: string) => (failing.has(name) ? { ok: false as const, error: `${name} failed` } : { ok: true as const });
  return {
    navigate: () => ({ ok: true as const }),
    back: () => ({ ok: true as const }),
    openScreen: () => ({ ok: true as const }),
    toast: () => ({ ok: true as const }),
    dialog: () => ({ ok: true as const }),
    playbackPlayPause: () => ok('playbackPlayPause'),
    playbackStop: () => ok('playbackStop'),
    playbackNextEpisode: () => ok('playbackNextEpisode'),
    queueAdd: () => ok('queueAdd'),
    queueReplace: () => ok('queueReplace'),
    serverConnect: () => ok('serverConnect'),
    serverReconnect: () => ok('serverReconnect'),
    serverRetry: () => ok('serverRetry'),
    sourceRetry: () => ok('sourceRetry'),
    sourceNext: () => ok('sourceNext'),
    linkOpen: () => ({ ok: true as const }),
    telegramOpen: () => ({ ok: true as const }),
  };
}

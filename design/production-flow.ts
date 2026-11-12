import { PRODUCTION_FLOW } from './generated/flow.ts';
import {
  beginFlowSession,
  executeFlow,
  executeGraphRule,
  resetFlowSession,
  updateFlowEnvironment,
  type FlowDispatcher,
  type FlowDispatchOutcome,
} from './flow-graph.ts';
import { FLOW_MODULE_OUTPUT, generateFlowModule } from './flow-module.ts';

export type { FlowDispatcher, FlowDispatchOutcome } from './flow-graph.ts';
import type {
  DesignTarget,
  FlowDocument,
  FlowDownloadState,
  FlowEventType,
  FlowNodeView,
  FlowPlaybackState,
  InteractionCondition,
  InteractionRule,
} from './schema.ts';

// Production flow integration: the runtime stays a no-op until an export writes a nonempty
// generated flow document. Events reach the shared interpreter through typed publishers on
// top of the existing app APIs; arbitrary JavaScript and network access from flow data stay
// impossible. One install owns the timer registry: a repeated install (a repeated export)
// tears the previous runtime down, so timers never accumulate.

export const FLOW_TIMER_REGISTRY_LIMIT = 16;

// Events that are not tied to a DOM element still carry the rule elementId the document
// declares ('*' rules get a placeholder), mirroring the editor debugger event construction.
const WILDCARD_EVENT_ELEMENT = 'flow-event';

export interface ProductionFlowEnvironment {
  serverConnected: boolean;
  networkOnline: boolean;
  accountSignedIn: boolean;
  playbackState: FlowPlaybackState;
  downloadState: FlowDownloadState;
}

// Typed event sources: each subscription reports through an existing app API (signals,
// window events) and the runtime maps the new state to the documented flow events.
// Playback and download carry the event explicitly: a finished playback is a stopped
// state but a distinct event.
export interface ProductionFlowPublishers {
  subscribeServer?(notify: (connected: boolean) => void): () => void;
  subscribeNetwork?(notify: (online: boolean) => void): () => void;
  subscribeAccount?(notify: (signedIn: boolean) => void): () => void;
  subscribePlayback?(notify: (update: PlaybackFlowUpdate) => void): () => void;
  subscribeDownload?(notify: (update: DownloadFlowUpdate) => void): () => void;
}

export interface PlaybackFlowUpdate {
  state: FlowPlaybackState;
  event: 'playback.started' | 'playback.paused' | 'playback.stopped' | 'playback.finished' | null;
}

export interface DownloadFlowUpdate {
  state: FlowDownloadState;
  event: 'download.started' | 'download.completed' | 'download.failed' | null;
}

export interface ProductionFlowOptions {
  target: DesignTarget;
  screenOf(): string | null;
  subscribeScreen?(notify: () => void): () => void;
  environment?(): Partial<ProductionFlowEnvironment>;
  publishers?: ProductionFlowPublishers;
  dispatcher: FlowDispatcher;
}

const DEFAULT_ENVIRONMENT: ProductionFlowEnvironment = {
  serverConnected: false,
  networkOnline: true,
  accountSignedIn: false,
  playbackState: 'idle',
  downloadState: 'idle',
};

// Fills a dispatcher with explicit unsupported outcomes so an app wires every action it
// exposes instead of silently dropping it; overrides are the typed app API adapters.
export function createProductionDispatcher(partial: Partial<FlowDispatcher>): FlowDispatcher {
  const unsupported = (name: string) => (): FlowDispatchOutcome => ({
    ok: false,
    error: `${name} has no production publisher on this platform`,
  });
  return {
    navigate: unsupported('navigate'),
    back: unsupported('back'),
    openScreen: unsupported('openScreen'),
    toast: unsupported('toast'),
    dialog: unsupported('dialog'),
    playbackPlayPause: unsupported('playback.playPause'),
    playbackStop: unsupported('playback.stop'),
    playbackNextEpisode: unsupported('playback.nextEpisode'),
    queueAdd: unsupported('queue.add'),
    queueReplace: unsupported('queue.replace'),
    serverConnect: unsupported('server.connect'),
    serverReconnect: unsupported('server.reconnect'),
    serverRetry: unsupported('server.retry'),
    sourceRetry: unsupported('source.retry'),
    sourceNext: unsupported('source.next'),
    linkOpen: unsupported('link.open'),
    telegramOpen: unsupported('telegram.open'),
    ...partial,
  };
}

// A documented platform validation error for actions the platform cannot perform: the
// dispatcher stays synchronous and explicit instead of silently succeeding.
export function unavailableProductionAction(action: string, platform: string, reason: string): FlowDispatchOutcome {
  return { ok: false, error: `${action} is unavailable on ${platform}: ${reason}` };
}

const flowTimers = new Set<ReturnType<typeof setInterval>>();

export function clearProductionFlowTimers(): void {
  for (const timer of flowTimers) clearInterval(timer);
  flowTimers.clear();
}

function environmentOf(options: ProductionFlowOptions) {
  return { ...DEFAULT_ENVIRONMENT, ...(options.environment?.() ?? {}) };
}

// The interpreter keeps legacy precedence (legacy rules first, graph rules only otherwise),
// so production behavior matches the editor preview and debugger for the same document.
// DOM-less events (screen/server/network/account/playback/download) are dispatched per rule:
// the event carries the rule elementId exactly like the editor debugger builds its events.
// Each matching rule executes exactly once - one published event never runs the first
// matching rule twice - and rules without steps or a graph never run for non-click events.
function dispatchForRules(flow: FlowDocument, options: ProductionFlowOptions, type: FlowEventType, screenId: string): void {
  for (const rule of flow.rules) {
    if (rule.event !== type) continue;
    if (rule.screenId !== '*' && rule.screenId !== screenId) continue;
    if (!(rule.graph || (rule.steps && rule.steps.length))) continue;
    executeGraphRule(rule, {
      type,
      screenId,
      elementId: rule.elementId === '*' ? WILDCARD_EVENT_ELEMENT : rule.elementId,
    }, options.dispatcher, flow.variables ?? []);
  }
}

export function activateProductionFlow(root: HTMLElement, flow: FlowDocument, options: ProductionFlowOptions): () => void {
  // A repeated activation (a repeated export) starts from a clean timer registry.
  clearProductionFlowTimers();
  const target = options.target;
  let screen = options.screenOf() ?? '*';
  // Values published through the typed subscriptions accumulate on top of the environment
  // reader: one publisher must never clobber the state another one already reported.
  let published: Partial<ProductionFlowEnvironment> = {};
  const sessionEnvironmentNow = () => ({
    target,
    screenId: screen,
    ...environmentOf(options),
    ...published,
  });
  beginFlowSession(sessionEnvironmentNow());

  // Clicks are captured before the app's own handlers: a matched rule takes over the click
  // (no double navigation), while an unmatched click falls through untouched, so documents
  // without a matching rule change nothing about the native behavior.
  const onClick = (event: MouseEvent): void => {
    const origin = event.target instanceof Element ? event.target : null;
    const element = origin?.closest<HTMLElement>('[data-design-id]');
    if (!element || !root.contains(element)) return;
    const elementId = element.dataset.designId;
    if (!elementId) return;
    const result = executeFlow(flow, { type: 'click', screenId: screen, elementId }, options.dispatcher);
    if (result.matched) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  root.addEventListener('click', onClick, true);

  const refreshScreen = (): void => {
    const next = options.screenOf() ?? '*';
    if (next === screen) return;
    const previous = screen;
    screen = next;
    updateFlowEnvironment(sessionEnvironmentNow());
    dispatchForRules(flow, options, 'screen.leave', previous);
    dispatchForRules(flow, options, 'screen.enter', screen);
  };
  const unsubscribeScreen = options.subscribeScreen?.(refreshScreen);

  const watch = <T extends ProductionFlowEnvironment[keyof ProductionFlowEnvironment]>(
    subscribe: ((notify: (value: T) => void) => () => void) | undefined,
    key: keyof ProductionFlowEnvironment,
    events: ReadonlyArray<[FlowEventType, T]>,
  ): (() => void) | undefined => {
    if (!subscribe) return undefined;
    let current = environmentOf(options)[key] as T;
    return subscribe((next) => {
      if (next === current) return;
      current = next;
      published = { ...published, [key]: next };
      updateFlowEnvironment(sessionEnvironmentNow());
      for (const [type, value] of events) {
        if (value === next) dispatchForRules(flow, options, type, screen);
      }
    });
  };

  const watchUpdates = <S extends FlowPlaybackState | FlowDownloadState>(
    subscribe: ((notify: (update: { state: S; event: FlowEventType | null }) => void) => () => void) | undefined,
    key: 'playbackState' | 'downloadState',
  ): (() => void) | undefined => {
    if (!subscribe) return undefined;
    return subscribe((update) => {
      published = { ...published, [key]: update.state };
      updateFlowEnvironment(sessionEnvironmentNow());
      if (update.event) dispatchForRules(flow, options, update.event, screen);
    });
  };

  const unsubscribers = [
    watch(options.publishers?.subscribeServer, 'serverConnected', [['server.connected', true], ['server.disconnected', false]]),
    watch(options.publishers?.subscribeNetwork, 'networkOnline', [['network.online', true], ['network.offline', false]]),
    watch(options.publishers?.subscribeAccount, 'accountSignedIn', [['account.signed-in', true], ['account.signed-out', false]]),
    watchUpdates(options.publishers?.subscribePlayback, 'playbackState'),
    watchUpdates(options.publishers?.subscribeDownload, 'downloadState'),
  ];

  for (const rule of flow.rules) {
    if (rule.event !== 'timer' || flowTimers.size >= FLOW_TIMER_REGISTRY_LIMIT) continue;
    // A timer belongs to its rule: the interval is the rule's own, so the event carries the
    // rule elementId directly instead of broadcasting to every timer rule.
    const elementId = rule.elementId === '*' ? WILDCARD_EVENT_ELEMENT : rule.elementId;
    const timer = setInterval(() => {
      executeFlow(flow, { type: 'timer', screenId: screen, elementId }, options.dispatcher);
    }, rule.intervalMs ?? 0);
    flowTimers.add(timer);
  }

  return () => {
    root.removeEventListener('click', onClick, true);
    unsubscribeScreen?.();
    for (const unsubscribe of unsubscribers) unsubscribe?.();
    clearProductionFlowTimers();
    resetFlowSession();
  };
}

const installedFlows = new WeakMap<HTMLElement, () => void>();

export function installProductionFlow(root: HTMLElement, options: ProductionFlowOptions): () => void {
  installedFlows.get(root)?.();
  installedFlows.delete(root);
  if (!PRODUCTION_FLOW.rules.length) return () => undefined;
  const stop = activateProductionFlow(root, PRODUCTION_FLOW, options);
  installedFlows.set(root, stop);
  return () => {
    if (installedFlows.get(root) === stop) installedFlows.delete(root);
    stop();
  };
}

export type FlowExportScope =
  | { kind: 'all' }
  | { kind: 'page'; screenId: string }
  | { kind: 'component'; nodeId: string };

export interface FlowExportPlan {
  scope: FlowExportScope;
  flow: FlowDocument;
  files: Array<{ path: string; content: string }>;
}

const SCOPE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function normalizeScope(scope: unknown): FlowExportScope {
  if (typeof scope !== 'object' || scope === null || Array.isArray(scope)) throw new Error('INVALID_EXPORT_SCOPE');
  const source = scope as Record<string, unknown>;
  if (source.kind === 'all') return { kind: 'all' };
  if (source.kind === 'page' && typeof source.screenId === 'string' && SCOPE_ID.test(source.screenId)) {
    return { kind: 'page', screenId: source.screenId };
  }
  if (source.kind === 'component' && typeof source.nodeId === 'string' && SCOPE_ID.test(source.nodeId)) {
    return { kind: 'component', nodeId: source.nodeId };
  }
  throw new Error('INVALID_EXPORT_SCOPE');
}

// A rule belongs to a page scope by its screen, to a component scope by its trigger element.
export function flowRuleInScope(rule: InteractionRule, scope: FlowExportScope): boolean {
  if (scope.kind === 'page') return rule.screenId === scope.screenId;
  if (scope.kind === 'component') return rule.elementId === scope.nodeId;
  return true;
}

function referencedVariableIds(rules: InteractionRule[]): Set<string> {
  const ids = new Set<string>();
  const visit = (condition: InteractionCondition | undefined): void => {
    if (!condition) return;
    if (condition.kind === 'all' || condition.kind === 'any') {
      for (const entry of condition.conditions) visit(entry);
      return;
    }
    if (condition.kind === 'not') {
      visit(condition.condition);
      return;
    }
    if (condition.path.startsWith('variable.')) ids.add(condition.path.slice('variable.'.length));
  };
  for (const rule of rules) {
    visit(rule.condition);
    for (const step of rule.steps ?? []) {
      visit(step.condition);
      if (step.action?.type === 'variable.set') ids.add(step.action.variableId);
    }
  }
  return ids;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// The flow contribution of an export. The all scope ships the complete document and the
// generated production module; a scoped export ships only the rules the scope owns, with
// the variables those rules reference, so unrelated screens keep their behavior. Merging
// with the files on disk happens in the export step.
export function createFlowExportPlan(draft: { flow: FlowDocument }, scopeInput: unknown): FlowExportPlan {
  const scope = normalizeScope(scopeInput);
  const flow = draft.flow;
  if (!SCOPE_ID.test(flow.id)) throw new Error('INVALID_FLOW_ID');
  const flowPath = `design/flows/${flow.id}.json`;
  if (scope.kind === 'all') {
    return {
      scope,
      flow,
      files: [
        { path: flowPath, content: json(flow) },
        { path: FLOW_MODULE_OUTPUT, content: generateFlowModule(flow) },
      ].sort((a, b) => a.path.localeCompare(b.path)),
    };
  }
  const rules = flow.rules.filter((rule) => flowRuleInScope(rule, scope));
  const variables = (flow.variables ?? []).filter((variable) => referencedVariableIds(rules).has(variable.id));
  const scoped: FlowDocument = {
    schemaVersion: 1,
    id: flow.id,
    baseCommit: flow.baseCommit,
    rules,
    ...(variables.length ? { variables } : {}),
  };
  return { scope, flow: scoped, files: [{ path: flowPath, content: json(scoped) }] };
}

export interface FlowIdDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

export interface FlowDocumentDiff {
  rules: FlowIdDiff;
  nodes: FlowIdDiff;
  edges: FlowIdDiff;
  variables: FlowIdDiff;
}

function diffIds<T>(before: T[], after: T[], same: (left: T, right: T) => boolean): FlowIdDiff {
  const beforeById = new Map(before.map((entry) => [(entry as { id: string }).id, entry]));
  const afterById = new Map(after.map((entry) => [(entry as { id: string }).id, entry]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [id, entry] of afterById) {
    const previous = beforeById.get(id);
    if (!previous) added.push(id);
    else if (!same(previous, entry)) changed.push(id);
  }
  for (const id of beforeById.keys()) {
    if (!afterById.has(id)) removed.push(id);
  }
  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
  };
}

// Export review diff by identity: rules compare without their graph (nodes and edges have
// their own sections) and node moves on the canvas are not logic changes.
export function diffFlowDocuments(before: FlowDocument, after: FlowDocument): FlowDocumentDiff {
  const ruleView = (rule: InteractionRule): InteractionRule => {
    const { graph: _graph, ...rest } = rule;
    return rest;
  };
  const nodeView = (node: FlowNodeView) => {
    const { x: _x, y: _y, ...rest } = node;
    return rest;
  };
  const beforeNodes = before.rules.flatMap((rule) => rule.graph?.nodes ?? []);
  const afterNodes = after.rules.flatMap((rule) => rule.graph?.nodes ?? []);
  const beforeEdges = before.rules.flatMap((rule) => rule.graph?.edges ?? []);
  const afterEdges = after.rules.flatMap((rule) => rule.graph?.edges ?? []);
  return {
    rules: diffIds(before.rules.map(ruleView), after.rules.map(ruleView), (left, right) => JSON.stringify(left) === JSON.stringify(right)),
    nodes: diffIds(beforeNodes.map(nodeView), afterNodes.map(nodeView), (left, right) => JSON.stringify(left) === JSON.stringify(right)),
    edges: diffIds(beforeEdges, afterEdges, (left, right) => JSON.stringify(left) === JSON.stringify(right)),
    variables: diffIds(before.variables ?? [], after.variables ?? [], (left, right) => JSON.stringify(left) === JSON.stringify(right)),
  };
}

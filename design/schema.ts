export const DESIGN_SCHEMA_VERSION = 1 as const;

export const DESIGN_TARGETS = ['android-phone', 'android-tv', 'lg-webos', 'desktop-windows', 'desktop-macos', 'desktop-linux'] as const;
export type DesignTarget = (typeof DESIGN_TARGETS)[number];
export const DESKTOP_DESIGN_TARGETS = ['desktop-windows', 'desktop-macos', 'desktop-linux'] as const;
export type DesktopDesignTarget = (typeof DESKTOP_DESIGN_TARGETS)[number];
export const DESIGN_FORMATS = ['portrait', 'landscape'] as const;
export type DesignFormat = (typeof DESIGN_FORMATS)[number];
export const DESIGN_STATES = ['default', 'hover', 'focus', 'active', 'disabled', 'error'] as const;
export type DesignState = (typeof DESIGN_STATES)[number];
export type TokenMap = Record<string, string>;
export type OverrideScope = 'target' | 'component' | 'screen' | 'element' | 'format' | 'state';

export const LAYOUT_MODES = ['flow', 'absolute'] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];
export const LAYOUT_ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export type LayoutAnchor = (typeof LAYOUT_ANCHORS)[number];
export const LAYOUT_DIRECTIONS = ['row', 'column', 'auto'] as const;
export type LayoutDirection = (typeof LAYOUT_DIRECTIONS)[number];
export const LAYOUT_ALIGNMENTS = ['start', 'center', 'end', 'stretch'] as const;
export type LayoutAlignment = (typeof LAYOUT_ALIGNMENTS)[number];
export const LAYOUT_DISTRIBUTIONS = ['start', 'center', 'end', 'space-between', 'space-around'] as const;
export type LayoutDistribution = (typeof LAYOUT_DISTRIBUTIONS)[number];

export interface LayoutContext {
  target: DesignTarget;
  screenId: string;
  format: DesignFormat;
}

export interface LayoutContainer extends LayoutContext {
  id: string;
  nodeId: string;
  order: string[];
  direction?: LayoutDirection;
  padding?: string;
  alignment?: LayoutAlignment;
  distribution?: LayoutDistribution;
}

export interface LayoutPlacement extends LayoutContext {
  id: string;
  nodeId: string;
  mode: LayoutMode;
  x: number;
  y: number;
  anchor: LayoutAnchor;
  width: number | 'auto';
  height: number | 'auto';
  // Size basis captured when a flow node converts to absolute: percent width and height keep
  // resolving against these pixel sizes instead of the current parent, so a content-sized
  // parent that shrinks after the child leaves the flow cannot collapse the absolute size.
  // Absent on legacy documents, which keep the responsive percent behavior.
  basisWidth?: number;
  basisHeight?: number;
  minWidth?: number | 'auto';
  maxWidth?: number | 'auto';
  minHeight?: number | 'auto';
  maxHeight?: number | 'auto';
  margin?: string;
  zIndex: number;
  hidden: boolean;
  locked: boolean;
  label: string;
}

export interface LayoutDocument {
  containers: LayoutContainer[];
  placements: LayoutPlacement[];
  clones?: LayoutClone[];
}

export const LAYOUT_CLONE_HTML_LIMIT = 50000;

// A clone is a duplicated or pasted layout node: the runtime materializes its sanitized html
// snapshot into the parent container, so the copy renders even after reload or on a page where
// the source node does not exist. Only the clone root is layout-addressable.
export interface LayoutClone extends LayoutContext {
  id: string;
  nodeId: string;
  parentId: string;
  label: string;
  sourceNodeId?: string;
  html: string;
}

export interface StylePreset {
  id: string;
  name: string;
  tokens: TokenMap;
}

export interface ThemeOverride {
  id: string;
  scope: OverrideScope;
  target?: DesignTarget;
  componentId?: string;
  screenId?: string;
  elementId?: string;
  format?: DesignFormat;
  state?: DesignState;
  tokens: TokenMap;
}

export interface ReleaseIntent {
  target: DesignTarget;
  version: string;
  channel: 'beta' | 'stable';
}

export interface ThemeDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  baseCommit: string;
  tokens: TokenMap;
  overrides: ThemeOverride[];
  releaseIntents: ReleaseIntent[];
  layout?: LayoutDocument;
  stylePresets?: StylePreset[];
}

export type ConditionPath =
  | 'server.connected'
  | 'target'
  | 'screen.current'
  | 'network.online'
  | 'account.signedIn'
  | 'playback.state'
  | 'download.state'
  | `variable.${string}`;

export type ConditionValue = string | number | boolean;

export type InteractionCondition =
  | { kind: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains'; path: ConditionPath; value: ConditionValue }
  | { kind: 'exists'; path: ConditionPath }
  | { kind: 'all'; conditions: InteractionCondition[] }
  | { kind: 'any'; conditions: InteractionCondition[] }
  | { kind: 'not'; condition: InteractionCondition };

export const FLOW_EVENT_TYPES = [
  'click',
  'screen.enter',
  'screen.leave',
  'server.connected',
  'server.disconnected',
  'network.online',
  'network.offline',
  'account.signed-in',
  'account.signed-out',
  'playback.started',
  'playback.paused',
  'playback.stopped',
  'playback.finished',
  'download.started',
  'download.completed',
  'download.failed',
  'timer',
] as const;
export type FlowEventType = (typeof FLOW_EVENT_TYPES)[number];

// Timer triggers are representable now, but nothing starts them in the background:
// a bounded interval is validated here, and only an explicit timer event runs the rule.
export const FLOW_TIMER_INTERVAL_MIN = 1000;
export const FLOW_TIMER_INTERVAL_MAX = 3600000;

export const FLOW_NODE_KINDS = ['trigger', 'condition', 'action', 'result'] as const;
export type FlowNodeKind = (typeof FLOW_NODE_KINDS)[number];
export const FLOW_EDGE_BRANCHES = ['default', 'true', 'false', 'error'] as const;
export type FlowEdgeBranch = (typeof FLOW_EDGE_BRANCHES)[number];

// Graph nodes are views over the typed rule parts: a node references its step by id
// instead of carrying behavior, and positions never affect execution.
export interface FlowNodeView {
  id: string;
  kind: FlowNodeKind;
  ruleId?: string;
  stepId?: string;
  x: number;
  y: number;
  label?: string;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  branch: FlowEdgeBranch;
}

export interface FlowGraph {
  nodes: FlowNodeView[];
  edges: FlowEdge[];
}

export const FLOW_VARIABLE_TYPES = ['boolean', 'string', 'number', 'enum'] as const;
export type FlowVariableType = (typeof FLOW_VARIABLE_TYPES)[number];
export type FlowVariableValue = string | number | boolean;

export interface FlowVariable {
  id: string;
  name: string;
  type: FlowVariableType;
  initial: FlowVariableValue;
  values?: string[];
}

export type FlowPlaybackState = 'idle' | 'playing' | 'paused' | 'stopped';
export type FlowDownloadState = 'idle' | 'active' | 'completed' | 'failed';

// Documented read-only environment values available to conditions during one execution.
export interface FlowEnvironment {
  target: DesignTarget;
  screenId: string;
  serverConnected: boolean;
  networkOnline: boolean;
  accountSignedIn: boolean;
  playbackState: FlowPlaybackState;
  downloadState: FlowDownloadState;
}

// Documented project links only: HTTPS targets the OMP project already publishes.
export const FLOW_LINK_HOSTS = ['t.me'] as const;
export const FLOW_TELEGRAM_TARGETS = ['channel', 'billing-bot'] as const;

export type InteractionAction =
  | { type: 'navigate'; screenId: string }
  | { type: 'back' }
  | { type: 'toast'; message: string }
  | { type: 'openScreen'; screenId: string }
  | { type: 'dialog'; title: string; message: string }
  | { type: 'playback.playPause' }
  | { type: 'playback.stop' }
  | { type: 'playback.nextEpisode' }
  | { type: 'queue.add' }
  | { type: 'queue.replace' }
  | { type: 'server.connect' }
  | { type: 'server.reconnect' }
  | { type: 'server.retry' }
  | { type: 'source.retry' }
  | { type: 'source.next' }
  | { type: 'variable.set'; variableId: string; value: FlowVariableValue }
  | { type: 'link.open'; url: string }
  | { type: 'telegram.open'; target: string };

// The runtime whitelist mirrors the InteractionAction union one to one: protocol and
// editor boundaries validate posted values against these names instead of trusting strings.
export const INTERACTION_ACTION_TYPES: ReadonlyArray<InteractionAction['type']> = [
  'navigate',
  'back',
  'toast',
  'openScreen',
  'dialog',
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
  'variable.set',
  'link.open',
  'telegram.open',
];

export interface InteractionStep {
  id: string;
  condition?: InteractionCondition;
  action?: InteractionAction;
}

export interface InteractionRule {
  id: string;
  screenId: string;
  elementId: string;
  event: FlowEventType;
  condition?: InteractionCondition;
  action: InteractionAction;
  steps?: InteractionStep[];
  graph?: FlowGraph;
  cooldownMs?: number;
  intervalMs?: number;
}

export interface FlowDocument {
  schemaVersion: 1;
  id: string;
  baseCommit: string;
  rules: InteractionRule[];
  variables?: FlowVariable[];
}

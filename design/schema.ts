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

export type ConditionPath = 'server.connected' | 'target' | 'screen.current';
export type InteractionCondition =
  | { kind: 'eq'; path: ConditionPath; value: string | boolean }
  | { kind: 'all'; conditions: InteractionCondition[] }
  | { kind: 'any'; conditions: InteractionCondition[] }
  | { kind: 'not'; condition: InteractionCondition };

export type InteractionAction =
  | { type: 'navigate'; screenId: string }
  | { type: 'back' }
  | { type: 'toast'; message: string };

export interface InteractionRule {
  id: string;
  screenId: string;
  elementId: string;
  event: 'click';
  condition?: InteractionCondition;
  action: InteractionAction;
}

export interface FlowDocument {
  schemaVersion: 1;
  id: string;
  baseCommit: string;
  rules: InteractionRule[];
}

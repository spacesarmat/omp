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

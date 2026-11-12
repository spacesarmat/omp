import {
  DESIGN_FORMATS,
  DESIGN_STATES,
  DESIGN_TARGETS,
  LAYOUT_ALIGNMENTS,
  LAYOUT_ANCHORS,
  LAYOUT_DIRECTIONS,
  LAYOUT_DISTRIBUTIONS,
  LAYOUT_MODES,
  type DesignFormat,
  type DesignState,
  type DesignTarget,
  type ConditionPath,
  type FlowDocument,
  type InteractionAction,
  type InteractionCondition,
  type InteractionRule,
  type LayoutContainer,
  type LayoutClone,
  type LayoutDocument,
  type LayoutPlacement,
  type ReleaseIntent,
  type StylePreset,
  type ThemeDocument,
  type ThemeOverride,
  type TokenMap,
} from './schema.ts';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const SIZE = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?px$/;
const VERSION = /^\d+\.\d+\.\d+(?:-beta\.\d+)?$/;
const COLORS = new Set(['--omp-color-background', '--omp-color-panel', '--omp-color-text', '--omp-color-accent', '--omp-color-muted', '--omp-color-danger']);
const SIZES = new Set(['--omp-size-space', '--omp-size-font', '--omp-size-sidebar', '--omp-size-radius']);
const CONDITION_PATHS = new Set(['server.connected', 'target', 'screen.current']);
const SCOPES = new Set(['target', 'component', 'screen', 'element', 'format', 'state']);
export const LAYOUT_GEOMETRY_LIMIT = 10000;
export const LAYOUT_ZINDEX_LIMIT = 999;
// Spacing values (margins, paddings, size tokens) share one document limit so the editor fields,
// the draft schema and the app runtime all accept the same range.
export const LAYOUT_SIZE_PX_LIMIT = 512;
const LAYOUT_CLONE_HTML_LIMIT = 50000;

export function isLayoutGeometryValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= LAYOUT_GEOMETRY_LIMIT;
}

export function isLayoutSizeValue(value: unknown): value is number | 'auto' {
  return value === 'auto' || isLayoutGeometryValue(value);
}

export function isLayoutZIndexValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= LAYOUT_ZINDEX_LIMIT;
}

export function isLayoutMarginValue(value: unknown): value is string {
  return typeof value === 'string' && SIZE.test(value) && Number.parseFloat(value) <= LAYOUT_SIZE_PX_LIMIT;
}

export class DesignValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'DesignValidationError';
    this.path = path;
  }
}

function fail(path: string, message: string): never {
  throw new DesignValidationError(path, message);
}

function plain(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'object required');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && Object.getPrototypeOf(prototype) !== null) fail(path, 'plain object required');
  if (Object.prototype.hasOwnProperty.call(value, '__proto__')) fail(path, '__proto__ is not allowed');
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(`${path}.${key}`, 'unknown field');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string, max = 120): string {
  if (typeof value !== 'string' || !value.length || value.length > max) fail(path, `string of 1..${max} characters required`);
  return value;
}

function id(value: unknown, path: string): string {
  const result = text(value, path, 64);
  if (!ID.test(result)) fail(path, 'invalid id');
  return result;
}

function commit(value: unknown, path: string): string {
  if (typeof value !== 'string' || !COMMIT.test(value)) fail(path, '40 lowercase hex characters required');
  return value;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) fail(path, `expected one of ${values.join(', ')}`);
  return value as T;
}

function tokens(value: unknown, path: string, complete = false): TokenMap {
  const source = plain(value, path, [...COLORS, ...SIZES]);
  const result: TokenMap = {};
  for (const [key, raw] of Object.entries(source)) {
    if (COLORS.has(key)) {
      if (typeof raw !== 'string' || !HEX.test(raw)) fail(`${path}.${key}`, 'six-digit hex color required');
      result[key] = raw.toUpperCase();
    } else if (SIZES.has(key)) {
      if (typeof raw !== 'string' || !SIZE.test(raw) || Number.parseFloat(raw) > LAYOUT_SIZE_PX_LIMIT) {
        fail(`${path}.${key}`, `size from 0px to ${LAYOUT_SIZE_PX_LIMIT}px with at most two decimals required`);
      }
      result[key] = raw;
    } else {
      fail(`${path}.${key}`, 'unknown design token');
    }
  }
  if (complete) {
    for (const key of [...COLORS, ...SIZES]) {
      if (!(key in result)) fail(`${path}.${key}`, 'base token is required');
    }
  }
  return result;
}

function override(value: unknown, path: string): ThemeOverride {
  const keys = ['id', 'scope', 'target', 'componentId', 'screenId', 'elementId', 'format', 'state', 'tokens'];
  const source = plain(value, path, keys);
  const scope = oneOf(source.scope, [...SCOPES], `${path}.scope`) as ThemeOverride['scope'];
  const result: ThemeOverride = {
    id: id(source.id, `${path}.id`),
    scope,
    tokens: tokens(source.tokens, `${path}.tokens`),
  };
  if (source.target !== undefined) result.target = oneOf(source.target, DESIGN_TARGETS, `${path}.target`);
  if (source.componentId !== undefined) result.componentId = id(source.componentId, `${path}.componentId`);
  if (source.screenId !== undefined) result.screenId = id(source.screenId, `${path}.screenId`);
  if (source.elementId !== undefined) result.elementId = id(source.elementId, `${path}.elementId`);
  if (source.format !== undefined) result.format = oneOf(source.format, DESIGN_FORMATS, `${path}.format`) as DesignFormat;
  if (source.state !== undefined) result.state = oneOf(source.state, DESIGN_STATES, `${path}.state`) as DesignState;
  if (scope === 'target' && !result.target) fail(`${path}.target`, 'target scope requires target');
  if (scope === 'component' && !result.componentId) fail(`${path}.componentId`, 'component scope requires componentId');
  if (scope === 'screen' && !result.screenId) fail(`${path}.screenId`, 'screen scope requires screenId');
  if (scope === 'element' && !result.elementId) fail(`${path}.elementId`, 'element scope requires elementId');
  if (scope === 'format' && !result.format) fail(`${path}.format`, 'format scope requires format');
  if (scope === 'state' && !result.state) fail(`${path}.state`, 'state scope requires state');
  return result;
}

function releaseIntent(value: unknown, path: string): ReleaseIntent {
  const source = plain(value, path, ['target', 'version', 'channel']);
  const target = oneOf(source.target, DESIGN_TARGETS, `${path}.target`) as DesignTarget;
  const version = text(source.version, `${path}.version`, 40);
  const channel = oneOf(source.channel, ['beta', 'stable'] as const, `${path}.channel`);
  if (!VERSION.test(version)) fail(`${path}.version`, 'semantic version required');
  if (channel === 'beta' && !version.includes('-beta.')) fail(`${path}.version`, 'beta channel requires -beta.N');
  if (channel === 'stable' && version.includes('-')) fail(`${path}.version`, 'stable channel forbids a prerelease suffix');
  return { target, version, channel };
}

function layoutGeometry(value: unknown, path: string): number {
  if (!isLayoutGeometryValue(value)) {
    fail(path, `integer from 0 to ${LAYOUT_GEOMETRY_LIMIT} required`);
  }
  return value;
}

function layoutSize(value: unknown, path: string): number | 'auto' {
  if (value === 'auto') return value;
  return layoutGeometry(value, path);
}

function layoutZIndex(value: unknown, path: string): number {
  if (!isLayoutZIndexValue(value)) {
    fail(path, `integer from 0 to ${LAYOUT_ZINDEX_LIMIT} required`);
  }
  return value;
}

function layoutLabel(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > 120) fail(path, 'string of at most 120 characters required');
  return value;
}

function layoutContextFields(source: Record<string, unknown>, path: string, result: { target: DesignTarget; screenId: string; format: DesignFormat }): void {
  result.target = oneOf(source.target, DESIGN_TARGETS, `${path}.target`) as DesignTarget;
  result.screenId = id(source.screenId, `${path}.screenId`);
  result.format = oneOf(source.format, DESIGN_FORMATS, `${path}.format`) as DesignFormat;
}

function layoutIdentity(entry: { target: string; screenId: string; format: string; nodeId: string }): string {
  return `${entry.target}|${entry.screenId}|${entry.format}|${entry.nodeId}`;
}

function layoutContainer(value: unknown, path: string): LayoutContainer {
  const keys = ['id', 'target', 'screenId', 'format', 'nodeId', 'order', 'direction', 'padding', 'alignment', 'distribution'];
  const source = plain(value, path, keys);
  const result = {} as LayoutContainer;
  layoutContextFields(source, path, result);
  result.id = id(source.id, `${path}.id`);
  result.nodeId = id(source.nodeId, `${path}.nodeId`);
  if (!Array.isArray(source.order)) fail(`${path}.order`, 'array required');
  result.order = source.order.map((entry, index) => id(entry, `${path}.order[${index}]`));
  if (new Set(result.order).size !== result.order.length) fail(`${path}.order`, 'duplicate nodeId');
  if (source.direction !== undefined) result.direction = oneOf(source.direction, LAYOUT_DIRECTIONS, `${path}.direction`);
  if (source.padding !== undefined) {
    if (typeof source.padding !== 'string' || !SIZE.test(source.padding) || Number.parseFloat(source.padding) > LAYOUT_SIZE_PX_LIMIT) {
      fail(`${path}.padding`, `size from 0px to ${LAYOUT_SIZE_PX_LIMIT}px with at most two decimals required`);
    }
    result.padding = source.padding;
  }
  if (source.alignment !== undefined) result.alignment = oneOf(source.alignment, LAYOUT_ALIGNMENTS, `${path}.alignment`);
  if (source.distribution !== undefined) result.distribution = oneOf(source.distribution, LAYOUT_DISTRIBUTIONS, `${path}.distribution`);
  return result;
}

function layoutPlacement(value: unknown, path: string): LayoutPlacement {
  const keys = ['id', 'target', 'screenId', 'format', 'nodeId', 'mode', 'x', 'y', 'anchor', 'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'margin', 'zIndex', 'hidden', 'locked', 'label'];
  const source = plain(value, path, keys);
  const result = {} as LayoutPlacement;
  layoutContextFields(source, path, result);
  result.id = id(source.id, `${path}.id`);
  result.nodeId = id(source.nodeId, `${path}.nodeId`);
  result.mode = oneOf(source.mode, LAYOUT_MODES, `${path}.mode`);
  result.x = layoutGeometry(source.x, `${path}.x`);
  result.y = layoutGeometry(source.y, `${path}.y`);
  result.anchor = oneOf(source.anchor, LAYOUT_ANCHORS, `${path}.anchor`);
  result.width = layoutSize(source.width, `${path}.width`);
  result.height = layoutSize(source.height, `${path}.height`);
  if (source.minWidth !== undefined) result.minWidth = layoutSize(source.minWidth, `${path}.minWidth`);
  if (source.maxWidth !== undefined) result.maxWidth = layoutSize(source.maxWidth, `${path}.maxWidth`);
  if (source.minHeight !== undefined) result.minHeight = layoutSize(source.minHeight, `${path}.minHeight`);
  if (source.maxHeight !== undefined) result.maxHeight = layoutSize(source.maxHeight, `${path}.maxHeight`);
  if (source.margin !== undefined) {
    if (!isLayoutMarginValue(source.margin)) {
      fail(`${path}.margin`, 'size from 0px to 512px with at most two decimals required');
    }
    result.margin = source.margin;
  }
  result.zIndex = layoutZIndex(source.zIndex, `${path}.zIndex`);
  if (typeof source.hidden !== 'boolean') fail(`${path}.hidden`, 'boolean required');
  if (typeof source.locked !== 'boolean') fail(`${path}.locked`, 'boolean required');
  result.hidden = source.hidden;
  result.locked = source.locked;
  result.label = layoutLabel(source.label, `${path}.label`);
  return result;
}

function layoutClone(value: unknown, path: string): LayoutClone {
  const keys = ['id', 'target', 'screenId', 'format', 'nodeId', 'parentId', 'label', 'sourceNodeId', 'html'];
  const source = plain(value, path, keys);
  const result = {} as LayoutClone;
  layoutContextFields(source, path, result);
  result.id = id(source.id, `${path}.id`);
  result.nodeId = id(source.nodeId, `${path}.nodeId`);
  result.parentId = id(source.parentId, `${path}.parentId`);
  if (source.sourceNodeId !== undefined) result.sourceNodeId = id(source.sourceNodeId, `${path}.sourceNodeId`);
  result.label = layoutLabel(source.label, `${path}.label`);
  if (typeof source.html !== 'string' || source.html.length > LAYOUT_CLONE_HTML_LIMIT || /<script[\s>/]/i.test(source.html)) {
    fail(`${path}.html`, `string without scripts of at most ${LAYOUT_CLONE_HTML_LIMIT} characters required`);
  }
  result.html = source.html;
  return result;
}

function layoutDocument(value: unknown, path: string): LayoutDocument {
  const source = plain(value, path, ['containers', 'placements', 'clones']);
  if (!Array.isArray(source.containers)) fail(`${path}.containers`, 'array required');
  if (!Array.isArray(source.placements)) fail(`${path}.placements`, 'array required');
  const containers = source.containers.map((entry, index) => layoutContainer(entry, `${path}.containers[${index}]`));
  const placements = source.placements.map((entry, index) => layoutPlacement(entry, `${path}.placements[${index}]`));
  if (new Set(containers.map((entry) => entry.id)).size !== containers.length) fail(`${path}.containers`, 'duplicate container id');
  if (new Set(placements.map((entry) => entry.id)).size !== placements.length) fail(`${path}.placements`, 'duplicate placement id');
  if (new Set(containers.map(layoutIdentity)).size !== containers.length) fail(`${path}.containers`, 'duplicate container identity');
  if (new Set(placements.map(layoutIdentity)).size !== placements.length) fail(`${path}.placements`, 'duplicate placement identity');
  const result: LayoutDocument = { containers, placements };
  if (source.clones !== undefined) {
    if (!Array.isArray(source.clones)) fail(`${path}.clones`, 'array required');
    const clones = source.clones.map((entry, index) => layoutClone(entry, `${path}.clones[${index}]`));
    if (new Set(clones.map((entry) => entry.id)).size !== clones.length) fail(`${path}.clones`, 'duplicate clone id');
    if (new Set(clones.map(layoutIdentity)).size !== clones.length) fail(`${path}.clones`, 'duplicate clone identity');
    result.clones = clones;
  }
  return result;
}

function stylePreset(value: unknown, path: string): StylePreset {
  const source = plain(value, path, ['id', 'name', 'tokens']);
  return {
    id: id(source.id, `${path}.id`),
    name: text(source.name, `${path}.name`),
    tokens: tokens(source.tokens, `${path}.tokens`),
  };
}

export function parseThemeDocument(value: unknown): ThemeDocument {
  const source = plain(value, 'theme', ['schemaVersion', 'id', 'name', 'baseCommit', 'tokens', 'overrides', 'releaseIntents', 'layout', 'stylePresets']);
  if (source.schemaVersion !== 1) fail('theme.schemaVersion', 'only schema version 1 is supported');
  if (!Array.isArray(source.overrides)) fail('theme.overrides', 'array required');
  if (!Array.isArray(source.releaseIntents)) fail('theme.releaseIntents', 'array required');
  const overrides = source.overrides.map((entry, index) => override(entry, `theme.overrides[${index}]`));
  const releaseIntents = source.releaseIntents.map((entry, index) => releaseIntent(entry, `theme.releaseIntents[${index}]`));
  if (new Set(overrides.map((entry) => entry.id)).size !== overrides.length) fail('theme.overrides', 'duplicate override id');
  if (new Set(releaseIntents.map((entry) => entry.target)).size !== releaseIntents.length) fail('theme.releaseIntents', 'duplicate release target');
  const result: ThemeDocument = {
    schemaVersion: 1,
    id: id(source.id, 'theme.id'),
    name: text(source.name, 'theme.name'),
    baseCommit: commit(source.baseCommit, 'theme.baseCommit'),
    tokens: tokens(source.tokens, 'theme.tokens', true),
    overrides,
    releaseIntents,
  };
  if (source.layout !== undefined) result.layout = layoutDocument(source.layout, 'theme.layout');
  if (source.stylePresets !== undefined) {
    if (!Array.isArray(source.stylePresets)) fail('theme.stylePresets', 'array required');
    const presets = source.stylePresets.map((entry, index) => stylePreset(entry, `theme.stylePresets[${index}]`));
    if (new Set(presets.map((entry) => entry.id)).size !== presets.length) fail('theme.stylePresets', 'duplicate preset id');
    result.stylePresets = presets;
  }
  return result;
}

function condition(value: unknown, path: string, depth = 0): InteractionCondition {
  if (depth > 8) fail(path, 'condition nesting is limited to 8');
  const source = plain(value, path, ['kind', 'path', 'value', 'conditions', 'condition']);
  const kind = text(source.kind, `${path}.kind`, 10);
  if (kind === 'eq') {
    const conditionPath = text(source.path, `${path}.path`, 40);
    if (!CONDITION_PATHS.has(conditionPath)) fail(`${path}.path`, 'unknown condition path');
    if (typeof source.value !== 'string' && typeof source.value !== 'boolean') fail(`${path}.value`, 'string or boolean required');
    return { kind, path: conditionPath as ConditionPath, value: source.value };
  }
  if (kind === 'all' || kind === 'any') {
    if (!Array.isArray(source.conditions) || !source.conditions.length) fail(`${path}.conditions`, 'non-empty array required');
    return { kind, conditions: source.conditions.map((entry, index) => condition(entry, `${path}.conditions[${index}]`, depth + 1)) };
  }
  if (kind === 'not') return { kind, condition: condition(source.condition, `${path}.condition`, depth + 1) };
  return fail(`${path}.kind`, 'unknown condition kind');
}

function action(value: unknown, path: string): InteractionAction {
  const source = plain(value, path, ['type', 'screenId', 'message']);
  const type = text(source.type, `${path}.type`, 20);
  if (type === 'navigate') return { type, screenId: id(source.screenId, `${path}.screenId`) };
  if (type === 'back') return { type };
  if (type === 'toast') return { type, message: text(source.message, `${path}.message`, 200) };
  return fail(`${path}.type`, 'unknown action type');
}

function rule(value: unknown, path: string): InteractionRule {
  const source = plain(value, path, ['id', 'screenId', 'elementId', 'event', 'condition', 'action']);
  const screenId = text(source.screenId, `${path}.screenId`, 64);
  if (screenId !== '*' && !ID.test(screenId)) fail(`${path}.screenId`, 'invalid screen id or wildcard');
  if (source.event !== 'click') fail(`${path}.event`, 'only click is supported');
  const result: InteractionRule = {
    id: id(source.id, `${path}.id`),
    screenId,
    elementId: id(source.elementId, `${path}.elementId`),
    event: 'click',
    action: action(source.action, `${path}.action`),
  };
  if (source.condition !== undefined) result.condition = condition(source.condition, `${path}.condition`);
  return result;
}

export function parseFlowDocument(value: unknown): FlowDocument {
  const source = plain(value, 'flow', ['schemaVersion', 'id', 'baseCommit', 'rules']);
  if (source.schemaVersion !== 1) fail('flow.schemaVersion', 'only schema version 1 is supported');
  if (!Array.isArray(source.rules)) fail('flow.rules', 'array required');
  const rules = source.rules.map((entry, index) => rule(entry, `flow.rules[${index}]`));
  if (new Set(rules.map((entry) => entry.id)).size !== rules.length) fail('flow.rules', 'duplicate rule id');
  return {
    schemaVersion: 1,
    id: id(source.id, 'flow.id'),
    baseCommit: commit(source.baseCommit, 'flow.baseCommit'),
    rules,
  };
}

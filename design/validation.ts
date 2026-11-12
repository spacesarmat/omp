import {
  DESIGN_FORMATS,
  DESIGN_STATES,
  DESIGN_TARGETS,
  FLOW_EDGE_BRANCHES,
  FLOW_EVENT_TYPES,
  FLOW_LINK_HOSTS,
  FLOW_NODE_KINDS,
  FLOW_TELEGRAM_TARGETS,
  FLOW_VARIABLE_TYPES,
  LAYOUT_ALIGNMENTS,
  LAYOUT_ANCHORS,
  LAYOUT_DIRECTIONS,
  LAYOUT_DISTRIBUTIONS,
  LAYOUT_MODES,
  type DesignFormat,
  type DesignState,
  type DesignTarget,
  type ConditionPath,
  type ConditionValue,
  type FlowDocument,
  type FlowGraph,
  type FlowNodeView,
  type FlowVariable,
  type FlowVariableValue,
  type InteractionAction,
  type InteractionCondition,
  type InteractionRule,
  type InteractionStep,
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
const CONDITION_PATHS = new Set(['server.connected', 'target', 'screen.current', 'network.online', 'account.signedIn', 'playback.state', 'download.state']);
const FLOW_COOLDOWN_LIMIT = 3600000;
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
  const keys = ['id', 'target', 'screenId', 'format', 'nodeId', 'mode', 'x', 'y', 'anchor', 'width', 'height', 'basisWidth', 'basisHeight', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'margin', 'zIndex', 'hidden', 'locked', 'label'];
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
  if (source.basisWidth !== undefined) result.basisWidth = layoutGeometry(source.basisWidth, `${path}.basisWidth`);
  if (source.basisHeight !== undefined) result.basisHeight = layoutGeometry(source.basisHeight, `${path}.basisHeight`);
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

function isScalar(value: unknown): value is ConditionValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function conditionPath(value: unknown, path: string, variables: ReadonlySet<string> | undefined): ConditionPath {
  const result = text(value, path, 80);
  if (CONDITION_PATHS.has(result)) return result as ConditionPath;
  if (result.startsWith('variable.')) {
    const variableId = result.slice('variable.'.length);
    if (!ID.test(variableId)) fail(path, 'invalid variable condition path');
    if (variables && !variables.has(variableId)) fail(path, 'unknown variable');
    return result as ConditionPath;
  }
  fail(path, 'unknown condition path');
}

function condition(value: unknown, path: string, variables?: ReadonlySet<string>, depth = 0): InteractionCondition {
  if (depth > 8) fail(path, 'condition nesting is limited to 8');
  const source = plain(value, path, ['kind', 'path', 'value', 'conditions', 'condition']);
  const kind = text(source.kind, `${path}.kind`, 10);
  if (kind === 'eq' || kind === 'neq') {
    if (!isScalar(source.value)) fail(`${path}.value`, 'string, number or boolean required');
    return { kind, path: conditionPath(source.path, `${path}.path`, variables), value: source.value };
  }
  if (kind === 'gt' || kind === 'gte' || kind === 'lt' || kind === 'lte') {
    if (typeof source.value !== 'number') fail(`${path}.value`, 'number required');
    return { kind, path: conditionPath(source.path, `${path}.path`, variables), value: source.value };
  }
  if (kind === 'contains') {
    if (typeof source.value !== 'string') fail(`${path}.value`, 'string required');
    return { kind, path: conditionPath(source.path, `${path}.path`, variables), value: source.value };
  }
  if (kind === 'exists') {
    if (source.value !== undefined) fail(`${path}.value`, 'value is not allowed');
    return { kind, path: conditionPath(source.path, `${path}.path`, variables) };
  }
  if (kind === 'all' || kind === 'any') {
    if (!Array.isArray(source.conditions) || !source.conditions.length) fail(`${path}.conditions`, 'non-empty array required');
    return { kind, conditions: source.conditions.map((entry, index) => condition(entry, `${path}.conditions[${index}]`, variables, depth + 1)) };
  }
  if (kind === 'not') return { kind, condition: condition(source.condition, `${path}.condition`, variables, depth + 1) };
  return fail(`${path}.kind`, 'unknown condition kind');
}

function variableValueMatches(variable: FlowVariable, value: FlowVariableValue): boolean {
  if (variable.type === 'boolean') return typeof value === 'boolean';
  if (variable.type === 'number') return typeof value === 'number';
  if (variable.type === 'string') return typeof value === 'string';
  return typeof value === 'string' && (variable.values ?? []).includes(value);
}

function action(value: unknown, path: string, variables?: ReadonlyMap<string, FlowVariable>): InteractionAction {
  const source = plain(value, path, ['type', 'screenId', 'message', 'title', 'variableId', 'value', 'url', 'target']);
  const type = text(source.type, `${path}.type`, 20);
  if (type === 'navigate') return { type, screenId: id(source.screenId, `${path}.screenId`) };
  if (type === 'back') return { type };
  if (type === 'toast') return { type, message: text(source.message, `${path}.message`, 200) };
  if (type === 'openScreen') return { type, screenId: id(source.screenId, `${path}.screenId`) };
  if (type === 'dialog') {
    return { type, title: text(source.title, `${path}.title`), message: text(source.message, `${path}.message`, 500) };
  }
  if (type === 'playback.playPause' || type === 'playback.stop' || type === 'playback.nextEpisode') return { type };
  if (type === 'queue.add' || type === 'queue.replace') return { type };
  if (type === 'server.connect' || type === 'server.reconnect' || type === 'server.retry') return { type };
  if (type === 'source.retry' || type === 'source.next') return { type };
  if (type === 'variable.set') {
    const variableId = id(source.variableId, `${path}.variableId`);
    if (!isScalar(source.value)) fail(`${path}.value`, 'string, number or boolean required');
    const variable = variables?.get(variableId);
    if (variables && !variable) fail(`${path}.variableId`, 'unknown variable');
    if (variable && !variableValueMatches(variable, source.value)) fail(`${path}.value`, `value does not match variable type ${variable.type}`);
    return { type, variableId, value: source.value };
  }
  if (type === 'link.open') {
    const url = text(source.url, `${path}.url`, 500);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      fail(`${path}.url`, 'valid URL required');
    }
    if (parsed.protocol !== 'https:') fail(`${path}.url`, 'https URL required');
    if (parsed.username || parsed.password) fail(`${path}.url`, 'credentials are not allowed');
    if (!(FLOW_LINK_HOSTS as readonly string[]).includes(parsed.host)) fail(`${path}.url`, 'link host is not allowed');
    return { type, url };
  }
  if (type === 'telegram.open') return { type, target: oneOf(source.target, [...FLOW_TELEGRAM_TARGETS], `${path}.target`) };
  return fail(`${path}.type`, 'unknown action type');
}

function flowVariable(value: unknown, path: string): FlowVariable {
  const source = plain(value, path, ['id', 'name', 'type', 'initial', 'values']);
  const type = oneOf(source.type, [...FLOW_VARIABLE_TYPES], `${path}.type`);
  if (!isScalar(source.initial)) fail(`${path}.initial`, 'string, number or boolean required');
  const result: FlowVariable = {
    id: id(source.id, `${path}.id`),
    name: text(source.name, `${path}.name`),
    type,
    initial: source.initial,
  };
  if (type === 'boolean' && typeof source.initial !== 'boolean') fail(`${path}.initial`, 'boolean required');
  if (type === 'number' && typeof source.initial !== 'number') fail(`${path}.initial`, 'number required');
  if (type === 'string' && typeof source.initial !== 'string') fail(`${path}.initial`, 'string required');
  if (type === 'enum') {
    if (!Array.isArray(source.values) || !source.values.length) fail(`${path}.values`, 'non-empty array required');
    const values = source.values.map((entry, index) => text(entry, `${path}.values[${index}]`, 64));
    if (new Set(values).size !== values.length) fail(`${path}.values`, 'duplicate value');
    if (typeof source.initial !== 'string' || !values.includes(source.initial)) fail(`${path}.initial`, 'initial value must be one of values');
    result.values = values;
  } else if (source.values !== undefined) {
    fail(`${path}.values`, 'values are only allowed for enum variables');
  }
  return result;
}

function step(value: unknown, path: string, variables: ReadonlyMap<string, FlowVariable>): InteractionStep {
  const source = plain(value, path, ['id', 'condition', 'action']);
  const result: InteractionStep = { id: id(source.id, `${path}.id`) };
  if (source.condition === undefined && source.action === undefined) fail(path, 'condition or action required');
  if (source.condition !== undefined) result.condition = condition(source.condition, `${path}.condition`, new Set(variables.keys()));
  if (source.action !== undefined) result.action = action(source.action, `${path}.action`, variables);
  return result;
}

function flowGraph(value: unknown, path: string, ruleId: string, steps: ReadonlyMap<string, InteractionStep>): FlowGraph {
  const source = plain(value, path, ['nodes', 'edges']);
  if (!Array.isArray(source.nodes)) fail(`${path}.nodes`, 'array required');
  if (!Array.isArray(source.edges)) fail(`${path}.edges`, 'array required');
  const nodes: FlowNodeView[] = [];
  for (const [index, entry] of source.nodes.entries()) {
    const nodePath = `${path}.nodes[${index}]`;
    const nodeSource = plain(entry, nodePath, ['id', 'kind', 'ruleId', 'stepId', 'x', 'y', 'label']);
    const node: FlowNodeView = {
      id: id(nodeSource.id, `${nodePath}.id`),
      kind: oneOf(nodeSource.kind, [...FLOW_NODE_KINDS], `${nodePath}.kind`),
      x: layoutGeometry(nodeSource.x, `${nodePath}.x`),
      y: layoutGeometry(nodeSource.y, `${nodePath}.y`),
    };
    if (nodeSource.ruleId !== undefined) {
      const nodeRuleId = id(nodeSource.ruleId, `${nodePath}.ruleId`);
      if (nodeRuleId !== ruleId) fail(`${nodePath}.ruleId`, 'node belongs to a different rule');
      node.ruleId = nodeRuleId;
    }
    if (nodeSource.label !== undefined) node.label = layoutLabel(nodeSource.label, `${nodePath}.label`);
    const stepId = nodeSource.stepId === undefined ? undefined : id(nodeSource.stepId, `${nodePath}.stepId`);
    if (stepId !== undefined) {
      const linked = steps.get(stepId);
      if (!linked) fail(`${nodePath}.stepId`, 'unknown step');
      if (node.kind === 'condition' && !linked.condition) fail(`${nodePath}.stepId`, 'condition node requires a step with a condition');
      if ((node.kind === 'action' || node.kind === 'result') && !linked.action) fail(`${nodePath}.stepId`, `${node.kind} node requires a step with an action`);
      node.stepId = stepId;
    }
    nodes.push(node);
  }
  if (new Set(nodes.map((entry) => entry.id)).size !== nodes.length) fail(`${path}.nodes`, 'duplicate node id');
  const nodeIds = new Set(nodes.map((entry) => entry.id));
  const edges: FlowGraph['edges'] = [];
  for (const [index, entry] of source.edges.entries()) {
    const edgePath = `${path}.edges[${index}]`;
    const edgeSource = plain(entry, edgePath, ['id', 'from', 'to', 'branch']);
    const from = id(edgeSource.from, `${edgePath}.from`);
    const to = id(edgeSource.to, `${edgePath}.to`);
    if (!nodeIds.has(from) || !nodeIds.has(to)) fail(edgePath, 'edge references an unknown node');
    if (from === to) fail(edgePath, 'self-loop edge');
    edges.push({
      id: id(edgeSource.id, `${edgePath}.id`),
      from,
      to,
      branch: oneOf(edgeSource.branch, [...FLOW_EDGE_BRANCHES], `${edgePath}.branch`),
    });
  }
  if (new Set(edges.map((entry) => entry.id)).size !== edges.length) fail(`${path}.edges`, 'duplicate edge id');
  return { nodes, edges };
}

function rule(value: unknown, path: string, variables: ReadonlyMap<string, FlowVariable>): InteractionRule {
  const source = plain(value, path, ['id', 'screenId', 'elementId', 'event', 'condition', 'action', 'steps', 'graph', 'cooldownMs']);
  const screenId = text(source.screenId, `${path}.screenId`, 64);
  if (screenId !== '*' && !ID.test(screenId)) fail(`${path}.screenId`, 'invalid screen id or wildcard');
  const result: InteractionRule = {
    id: id(source.id, `${path}.id`),
    screenId,
    elementId: id(source.elementId, `${path}.elementId`),
    event: oneOf(source.event, [...FLOW_EVENT_TYPES], `${path}.event`),
    action: action(source.action, `${path}.action`, variables),
  };
  const variableIds = new Set(variables.keys());
  if (source.condition !== undefined) result.condition = condition(source.condition, `${path}.condition`, variableIds);
  if (source.steps !== undefined) {
    if (!Array.isArray(source.steps)) fail(`${path}.steps`, 'array required');
    const steps = source.steps.map((entry, index) => step(entry, `${path}.steps[${index}]`, variables));
    if (new Set(steps.map((entry) => entry.id)).size !== steps.length) fail(`${path}.steps`, 'duplicate step id');
    result.steps = steps;
  }
  if (source.graph !== undefined) {
    const steps = new Map((result.steps ?? []).map((entry) => [entry.id, entry]));
    result.graph = flowGraph(source.graph, `${path}.graph`, result.id, steps);
  }
  if (source.cooldownMs !== undefined) {
    if (typeof source.cooldownMs !== 'number' || !Number.isInteger(source.cooldownMs) || source.cooldownMs < 0 || source.cooldownMs > FLOW_COOLDOWN_LIMIT) {
      fail(`${path}.cooldownMs`, `integer from 0 to ${FLOW_COOLDOWN_LIMIT} required`);
    }
    result.cooldownMs = source.cooldownMs;
  }
  return result;
}

export function parseFlowDocument(value: unknown): FlowDocument {
  const source = plain(value, 'flow', ['schemaVersion', 'id', 'baseCommit', 'rules', 'variables']);
  if (source.schemaVersion !== 1) fail('flow.schemaVersion', 'only schema version 1 is supported');
  if (!Array.isArray(source.rules)) fail('flow.rules', 'array required');
  const variables = new Map<string, FlowVariable>();
  if (source.variables !== undefined) {
    if (!Array.isArray(source.variables)) fail('flow.variables', 'array required');
    for (const [index, entry] of source.variables.entries()) {
      const variable = flowVariable(entry, `flow.variables[${index}]`);
      if (variables.has(variable.id)) fail('flow.variables', 'duplicate variable id');
      variables.set(variable.id, variable);
    }
  }
  const rules = source.rules.map((entry, index) => rule(entry, `flow.rules[${index}]`, variables));
  if (new Set(rules.map((entry) => entry.id)).size !== rules.length) fail('flow.rules', 'duplicate rule id');
  const result: FlowDocument = {
    schemaVersion: 1,
    id: id(source.id, 'flow.id'),
    baseCommit: commit(source.baseCommit, 'flow.baseCommit'),
    rules,
  };
  if (source.variables !== undefined) result.variables = [...variables.values()];
  return result;
}

import { createDefaultFlow, createDefaultTheme } from '../../design/defaults.ts';
import { DESIGN_TARGETS, DESIGN_FORMATS, type DesignTarget, type DesignFormat, type FlowDocument, type ThemeDocument } from '../../design/schema.ts';
import { parseFlowDocument, parseThemeDocument } from '../../design/validation.ts';
import { isEditorRoute } from './routes.ts';
import type { DesktopRouteId } from '../../desktop/src/shell/routes.ts';

export interface DraftSnapshot {
  id: string;
  name: string;
  createdAt: string;
  theme: ThemeDocument;
  flow: FlowDocument;
}

export interface EditorDraft {
  schemaVersion: 1;
  id: string;
  baseCommit: string;
  target: DesignTarget;
  screenId: DesktopRouteId;
  format: DesignFormat;
  language: 'ru' | 'en';
  theme: ThemeDocument;
  flow: FlowDocument;
  snapshots: DraftSnapshot[];
  revision?: number;
  lastError?: string | null;
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const COMMIT = /^[0-9a-f]{40}$/;

function fail(path: string): never {
  throw new Error(`Invalid editor draft at ${path}`);
}

function object(value: unknown, path: string, keys: string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && Object.getPrototypeOf(prototype) !== null) fail(path);
  if (Object.prototype.hasOwnProperty.call(value, '__proto__')) fail(path);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path}.${key}`);
  return value as Record<string, unknown>;
}

function id(value: unknown, path: string): string {
  if (typeof value !== 'string' || !ID.test(value)) fail(path);
  return value;
}

function snapshot(value: unknown, path: string, baseCommit: string): DraftSnapshot {
  const source = object(value, path, ['id', 'name', 'createdAt', 'theme', 'flow']);
  if (typeof source.name !== 'string' || !source.name.length || source.name.length > 120) fail(`${path}.name`);
  if (typeof source.createdAt !== 'string' || Number.isNaN(Date.parse(source.createdAt))) fail(`${path}.createdAt`);
  const theme = parseThemeDocument(source.theme);
  const flow = parseFlowDocument(source.flow);
  if (theme.baseCommit !== baseCommit || flow.baseCommit !== baseCommit) fail(`${path}.baseCommit`);
  return { id: id(source.id, `${path}.id`), name: source.name, createdAt: source.createdAt, theme, flow };
}

export function createDefaultDraft(idValue: string, baseCommit: string): EditorDraft {
  return {
    schemaVersion: 1,
    id: idValue,
    baseCommit,
    target: 'desktop-windows',
    screenId: 'settings',
    format: 'landscape',
    language: 'ru',
    theme: createDefaultTheme(baseCommit),
    flow: createDefaultFlow(baseCommit),
    snapshots: [],
  };
}

export function parseEditorDraft(value: unknown): EditorDraft {
  const source = object(value, 'draft', ['schemaVersion', 'id', 'baseCommit', 'target', 'screenId', 'format', 'language', 'theme', 'flow', 'snapshots', 'revision', 'lastError']);
  if (source.schemaVersion !== 1) fail('draft.schemaVersion');
  if (typeof source.baseCommit !== 'string' || !COMMIT.test(source.baseCommit)) fail('draft.baseCommit');
  if (typeof source.target !== 'string' || !DESIGN_TARGETS.includes(source.target as DesignTarget)) fail('draft.target');
  if (typeof source.screenId !== 'string' || !isEditorRoute(source.target as DesignTarget, source.screenId)) fail('draft.screenId');
  if (!DESIGN_FORMATS.includes(source.format as DesignFormat)) fail('draft.format');
  if (source.language !== 'ru' && source.language !== 'en') fail('draft.language');
  if (!Array.isArray(source.snapshots) || source.snapshots.length > 10) fail('draft.snapshots');
  const theme = parseThemeDocument(source.theme);
  const flow = parseFlowDocument(source.flow);
  if (theme.baseCommit !== source.baseCommit || flow.baseCommit !== source.baseCommit) fail('draft.baseCommit');
  const baseCommit = source.baseCommit;
  if (source.revision !== undefined && (typeof source.revision !== 'number' || !Number.isInteger(source.revision) || source.revision < 0)) fail('draft.revision');
  if (source.lastError !== undefined && source.lastError !== null && typeof source.lastError !== 'string') fail('draft.lastError');
  return {
    schemaVersion: 1,
    id: id(source.id, 'draft.id'),
    baseCommit,
    target: source.target as DesignTarget,
    screenId: source.screenId,
    format: source.format as DesignFormat,
    language: source.language,
    theme,
    flow,
    snapshots: source.snapshots.map((entry, index) => snapshot(entry, `draft.snapshots[${index}]`, baseCommit)),
    ...(source.revision !== undefined ? { revision: source.revision } : {}),
    ...(source.lastError !== undefined ? { lastError: source.lastError } : {}),
  };
}

import { buildOverride, overrideId, type OverrideIdentity } from '../../../design/catalog.ts';
import type {
  DesignFormat,
  DesignState,
  DesignTarget,
  OverrideScope,
  StylePreset,
  ThemeDocument,
  TokenMap,
} from '../../../design/schema.ts';
import type { DraftController } from '../drafts.ts';

// Style clipboard lives apart from the node clipboard: it carries design tokens only, never
// nodeId or an interaction action, so styles can travel between elements and screens safely.
export const STYLE_CLIPBOARD_KEY = 'omp.editor.styleClipboard';

const HEX = /^#[0-9a-fA-F]{6}$/;
const SIZE = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?px$/;
// Mirrors the token allow-list in design/validation.ts; presets and clipboards must stay inside it.
const KNOWN_TOKENS = new Set([
  '--omp-color-background',
  '--omp-color-panel',
  '--omp-color-text',
  '--omp-color-accent',
  '--omp-color-muted',
  '--omp-color-danger',
  '--omp-size-space',
  '--omp-size-font',
  '--omp-size-sidebar',
  '--omp-size-radius',
]);

export interface StyleClipboard {
  schemaVersion: 1;
  tokens: TokenMap;
}

export interface StyleClipboardParseResult {
  clipboard: StyleClipboard | null;
  errors: string[];
}

export interface StyleApplyResult {
  applied: string[];
  incompatible: string[];
  changed: boolean;
}

export interface TokenUsage {
  kind: 'override' | 'preset';
  id: string;
  name?: string;
  scope?: OverrideScope;
  target?: DesignTarget;
  screenId?: string;
  elementId?: string;
  format?: DesignFormat;
  state?: DesignState;
  value: string;
}

export function copyStyle(tokens: TokenMap, allowedTokens: readonly string[]): StyleClipboard {
  const allowed = new Set(allowedTokens);
  const picked: TokenMap = {};
  for (const [token, value] of Object.entries(tokens)) {
    if (allowed.has(token)) picked[token] = value;
  }
  return { schemaVersion: 1, tokens: picked };
}

function isValidTokenValue(token: string, value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (token.startsWith('--omp-color-')) return HEX.test(value);
  return SIZE.test(value);
}

// Validation errors are collected, not thrown, so the panel can list every incompatibility
// before anything reaches the draft.
export function parseStyleClipboard(raw: unknown): StyleClipboardParseResult {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { clipboard: null, errors: ['Clipboard должен быть объектом'] };
  const candidate = raw as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) errors.push('Неподдерживаемая версия clipboard');
  if ('nodeId' in candidate) errors.push('Clipboard не должен содержать nodeId');
  if ('action' in candidate) errors.push('Clipboard не должен содержать action');
  if (typeof candidate.tokens !== 'object' || candidate.tokens === null || Array.isArray(candidate.tokens)) {
    errors.push('tokens должен быть объектом');
  } else {
    const tokens = candidate.tokens as Record<string, unknown>;
    const entries = Object.entries(tokens);
    if (!entries.length) errors.push('В clipboard нет tokens');
    for (const [token, value] of entries) {
      if (!KNOWN_TOKENS.has(token)) {
        errors.push(`Неизвестный token: ${token}`);
        continue;
      }
      if (!isValidTokenValue(token, value)) errors.push(`Некорректное значение: ${token}`);
    }
  }
  return errors.length ? { clipboard: null, errors } : { clipboard: candidate as unknown as StyleClipboard, errors };
}

function splitTokens(tokens: TokenMap, allowedTokens: readonly string[]): { applied: TokenMap; incompatible: string[] } {
  const allowed = new Set(allowedTokens);
  const applied: TokenMap = {};
  const incompatible: string[] = [];
  for (const [token, value] of Object.entries(tokens)) {
    if (allowed.has(token)) applied[token] = value;
    else incompatible.push(token);
  }
  return { applied, incompatible };
}

// One controller update per operation, so a paste or a preset apply is always exactly one undo
// step. The override records tokens only: there is no preset id inside it and no back-reference.
function upsertStyleTokens(controller: DraftController, identity: OverrideIdentity, tokens: TokenMap): void {
  controller.update((draft) => {
    const id = overrideId(identity);
    const existing = draft.theme.overrides.find((entry) => entry.id === id);
    draft.theme.overrides = existing
      ? draft.theme.overrides.map((entry) => (entry.id === id ? { ...entry, tokens: { ...entry.tokens, ...tokens } } : entry))
      : [...draft.theme.overrides, buildOverride(identity, tokens)];
    return draft;
  });
}

export function pasteStyle(controller: DraftController, identity: OverrideIdentity, clipboard: StyleClipboard, allowedTokens: readonly string[]): StyleApplyResult {
  const { applied, incompatible } = splitTokens(clipboard.tokens, allowedTokens);
  if (Object.keys(applied).length) upsertStyleTokens(controller, identity, applied);
  return { applied: Object.keys(applied), incompatible, changed: Object.keys(applied).length > 0 };
}

export function applyStylePreset(controller: DraftController, identity: OverrideIdentity, preset: StylePreset, allowedTokens: readonly string[]): StyleApplyResult {
  const { applied, incompatible } = splitTokens(preset.tokens, allowedTokens);
  if (Object.keys(applied).length) upsertStyleTokens(controller, identity, applied);
  return { applied: Object.keys(applied), incompatible, changed: Object.keys(applied).length > 0 };
}

export function resetStyleProperty(controller: DraftController, identity: OverrideIdentity, token: string): boolean {
  const id = overrideId(identity);
  const existing = controller.draft.theme.overrides.find((entry) => entry.id === id);
  if (!existing || !(token in existing.tokens)) return false;
  controller.update((draft) => {
    const remaining = { ...existing.tokens };
    delete remaining[token];
    draft.theme.overrides = Object.keys(remaining).length
      ? draft.theme.overrides.map((entry) => (entry.id === id ? { ...entry, tokens: remaining } : entry))
      : draft.theme.overrides.filter((entry) => entry.id !== id);
    return draft;
  });
  return true;
}

export function saveStylePreset(controller: DraftController, preset: StylePreset): void {
  const unknown = Object.keys(preset.tokens).filter((token) => !KNOWN_TOKENS.has(token));
  if (unknown.length) throw new Error(`Неизвестные tokens: ${unknown.join(', ')}`);
  const name = preset.name.trim();
  if (!name) throw new Error('Имя preset обязательно');
  controller.update((draft) => {
    const current = draft.theme.stylePresets ?? [];
    const index = current.findIndex((entry) => entry.id === preset.id);
    const next: StylePreset = { id: preset.id, name, tokens: { ...preset.tokens } };
    draft.theme.stylePresets = index >= 0
      ? current.map((entry, entryIndex) => (entryIndex === index ? next : entry))
      : [...current, next];
    return draft;
  });
}

export function deleteStylePreset(controller: DraftController, id: string): boolean {
  const presets = controller.draft.theme.stylePresets ?? [];
  if (!presets.some((entry) => entry.id === id)) return false;
  controller.update((draft) => {
    draft.theme.stylePresets = presets.filter((entry) => entry.id !== id);
    return draft;
  });
  return true;
}

// Overrides never record which preset produced them, so an explicit "update usages" rewrites
// every override that currently holds any of the preset tokens, in a single undo step.
export function applyPresetToUsages(controller: DraftController, preset: StylePreset): number {
  const keys = Object.keys(preset.tokens);
  if (!keys.length) return 0;
  let updated = 0;
  controller.update((draft) => {
    draft.theme.overrides = draft.theme.overrides.map((entry) => {
      const patch = keys.filter((token) => token in entry.tokens);
      if (!patch.length) return entry;
      updated += 1;
      const tokens = { ...entry.tokens };
      for (const token of patch) tokens[token] = preset.tokens[token];
      return { ...entry, tokens };
    });
    return draft;
  });
  return updated;
}

export function findTokenUsages(theme: ThemeDocument, token: string): TokenUsage[] {
  const usages: TokenUsage[] = [];
  for (const override of theme.overrides) {
    if (!(token in override.tokens)) continue;
    usages.push({
      kind: 'override',
      id: override.id,
      scope: override.scope,
      target: override.target,
      screenId: override.screenId,
      elementId: override.elementId,
      format: override.format,
      state: override.state,
      value: override.tokens[token],
    });
  }
  for (const preset of theme.stylePresets ?? []) {
    if (!(token in preset.tokens)) continue;
    usages.push({ kind: 'preset', id: preset.id, name: preset.name, value: preset.tokens[token] });
  }
  return usages;
}

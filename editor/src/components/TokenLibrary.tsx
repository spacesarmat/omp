import { useState } from 'preact/hooks';
import { overrideId, type DesignPropertyDef, type OverrideIdentity } from '../../../design/catalog';
import type { StylePreset, TokenMap } from '../../../design/schema';
import type { DraftController } from '../drafts';
import { useDraftController } from '../useDraftController';
import {
  STYLE_CLIPBOARD_KEY,
  applyPresetToUsages,
  applyStylePreset,
  copyStyle,
  deleteStylePreset,
  findTokenUsages,
  parseStyleClipboard,
  pasteStyle,
  resetStyleProperty,
  saveStylePreset,
  type TokenUsage,
} from '../layout/styleOperations';

export interface TokenLibraryProps {
  controller: DraftController;
  identity: OverrideIdentity;
  fields: DesignPropertyDef[];
  values: TokenMap;
}

function usageLabel(usage: ReturnType<typeof findTokenUsages>[number]): string {
  if (usage.kind === 'preset') return `preset ${usage.name}`;
  const parts = [usage.scope ?? 'override'];
  if (usage.elementId) parts.push(usage.elementId);
  if (usage.screenId) parts.push(`(${usage.screenId})`);
  if (usage.target) parts.push(usage.target);
  if (usage.state && usage.state !== 'default') parts.push(usage.state);
  return parts.join(' ');
}

export function TokenLibrary({ controller, identity, fields, values }: TokenLibraryProps) {
  useDraftController(controller);
  const [pasteNotes, setPasteNotes] = useState<string[]>([]);
  const [clipboardError, setClipboardError] = useState('');
  const [syncNote, setSyncNote] = useState('');
  const [presetName, setPresetName] = useState('');
  const [usageQuery, setUsageQuery] = useState('');
  const [syncPresetId, setSyncPresetId] = useState<string | null>(null);
  const [syncSelection, setSyncSelection] = useState<ReadonlySet<string>>(new Set());
  const allowedTokens = fields.map((field) => field.token);
  const currentOverride = controller.draft.theme.overrides.find((entry) => entry.id === overrideId(identity));
  const presets = controller.draft.theme.stylePresets ?? [];
  const trimmedQuery = usageQuery.trim();
  const usages = trimmedQuery ? findTokenUsages(controller.draft.theme, trimmedQuery) : [];
  // Preset usages are chosen explicitly: candidates are the overrides that hold any preset
  // token, nothing is preselected and the apply button stays disabled until the user picks
  // at least one, so an unrelated override holding the same token name is never rewritten.
  const syncPreset = presets.find((entry) => entry.id === syncPresetId) ?? null;
  const syncTokens = syncPreset ? Object.keys(syncPreset.tokens) : [];
  const syncCandidates: TokenUsage[] = syncPreset
    ? controller.draft.theme.overrides
        .filter((entry) => syncTokens.some((token) => token in entry.tokens))
        .map((entry) => ({
          kind: 'override',
          id: entry.id,
          scope: entry.scope,
          target: entry.target,
          screenId: entry.screenId,
          elementId: entry.elementId,
          format: entry.format,
          state: entry.state,
          value: entry.tokens[syncTokens.find((token) => token in entry.tokens) ?? ''] ?? '',
        }))
    : [];

  const handleCopy = () => {
    try {
      window.localStorage.setItem(STYLE_CLIPBOARD_KEY, JSON.stringify(copyStyle(values, allowedTokens)));
    } catch {
      return;
    }
    setClipboardError('');
    setPasteNotes([]);
  };

  const handlePaste = () => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(STYLE_CLIPBOARD_KEY);
    } catch {
      raw = null;
    }
    if (!raw) {
      setClipboardError('Стиль не скопирован');
      setPasteNotes([]);
      return;
    }
    let parsed: ReturnType<typeof parseStyleClipboard>;
    try {
      parsed = parseStyleClipboard(JSON.parse(raw));
    } catch {
      parsed = { clipboard: null, errors: ['Clipboard повреждён'] };
    }
    if (!parsed.clipboard) {
      setClipboardError(parsed.errors[0] ?? 'Clipboard недоступен');
      setPasteNotes([]);
      return;
    }
    const result = pasteStyle(controller, identity, parsed.clipboard, allowedTokens);
    setClipboardError('');
    setPasteNotes(result.incompatible.map((token) => `Не поддерживается: ${token}`));
  };

  const handleSavePreset = () => {
    const name = presetName.trim();
    const tokens = copyStyle(values, allowedTokens).tokens;
    if (!name || !Object.keys(tokens).length) return;
    saveStylePreset(controller, { id: `preset-${crypto.randomUUID()}`, name, tokens });
    setPresetName('');
  };

  const handleApplyPreset = (preset: StylePreset) => {
    const result = applyStylePreset(controller, identity, preset, allowedTokens);
    setPasteNotes(result.incompatible.map((token) => `Не поддерживается: ${token}`));
  };

  const handleSyncPreset = (preset: StylePreset) => {
    setSyncPresetId(preset.id);
    setSyncSelection(new Set());
    setSyncNote('');
  };

  const handleSyncToggle = (id: string, checked: boolean) => {
    const next = new Set(syncSelection);
    if (checked) next.add(id);
    else next.delete(id);
    setSyncSelection(next);
  };

  const handleSyncApply = () => {
    if (!syncPreset) return;
    const updated = applyPresetToUsages(controller, syncPreset, [...syncSelection]);
    setSyncNote(`Обновлено overrides: ${updated}`);
    setSyncPresetId(null);
    setSyncSelection(new Set());
  };

  const handleSyncCancel = () => {
    setSyncPresetId(null);
    setSyncSelection(new Set());
  };

  return (
    <section class="editor-token-library" data-testid="token-library">
      <h3>Библиотека стилей</h3>
      <div class="editor-token-actions">
        <button type="button" data-testid="style-copy" onClick={handleCopy}>Копировать стиль</button>
        <button type="button" data-testid="style-paste" onClick={handlePaste}>Вставить стиль</button>
      </div>
      {clipboardError && <p class="editor-notice" role="alert" data-testid="style-clipboard-error">{clipboardError}</p>}
      {pasteNotes.length > 0 && (
        <ul class="editor-incompatible" data-testid="style-incompatible">
          {pasteNotes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      )}
      <h4>Свойства</h4>
      <ul class="editor-token-list">
        {fields.map((field) => {
          const overridden = currentOverride ? field.token in currentOverride.tokens : false;
          const value = currentOverride?.tokens[field.token] ?? values[field.token] ?? '';
          return (
            <li key={field.token} data-testid={`token-row-${field.token}`} class={overridden ? 'is-overridden' : ''}>
              <span>{field.label}</span>
              <code>{value}</code>
              <button type="button" aria-label={`Сбросить ${field.label}`} disabled={!overridden} onClick={() => resetStyleProperty(controller, identity, field.token)}>Сброс</button>
            </li>
          );
        })}
      </ul>
      <h4>Presets</h4>
      <div class="editor-preset-save">
        <input data-testid="preset-name" placeholder="Имя preset" value={presetName} onChange={(event) => setPresetName(event.currentTarget.value)} />
        <button type="button" data-testid="preset-save" onClick={handleSavePreset}>Сохранить</button>
      </div>
      {syncNote && <p class="editor-muted" data-testid="preset-sync-note">{syncNote}</p>}
      {!presets.length && <p class="editor-muted">Нет presets</p>}
      <ul class="editor-preset-list">
        {presets.map((preset) => (
          <li key={preset.id} data-testid={`preset-row-${preset.id}`}>
            <span>{preset.name}</span>
            <button type="button" aria-label={`Применить ${preset.name}`} onClick={() => handleApplyPreset(preset)}>Применить</button>
            <button type="button" aria-label={`Обновить использования ${preset.name}`} onClick={() => handleSyncPreset(preset)}>Обновить использования</button>
            <button type="button" aria-label={`Удалить ${preset.name}`} onClick={() => deleteStylePreset(controller, preset.id)}>Удалить</button>
            {syncPresetId === preset.id && (
              <div class="editor-preset-sync" data-testid="preset-sync">
                {!syncCandidates.length && <p class="editor-muted">Использований нет</p>}
                {syncCandidates.map((candidate) => (
                  <label key={candidate.id} data-testid={`usage-candidate-${candidate.id}`}>
                    <input
                      type="checkbox"
                      checked={syncSelection.has(candidate.id)}
                      onChange={(event) => handleSyncToggle(candidate.id, event.currentTarget.checked)}
                    />
                    {usageLabel(candidate)}: {candidate.value}
                  </label>
                ))}
                <button type="button" data-testid="preset-sync-apply" disabled={!syncSelection.size} onClick={handleSyncApply}>Обновить выбранные</button>
                <button type="button" data-testid="preset-sync-cancel" onClick={handleSyncCancel}>Отмена</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <h4>Использование tokens</h4>
      <input data-testid="usage-search" placeholder="Например --omp-color-panel" value={usageQuery} onChange={(event) => setUsageQuery(event.currentTarget.value)} />
      {trimmedQuery && (
        <ul class="editor-usage-list" data-testid="usage-list">
          {!usages.length && <li>Использований нет</li>}
          {usages.map((usage) => <li key={`${usage.kind}-${usage.id}`} data-testid="usage-row">{usageLabel(usage)}: {usage.value}</li>)}
        </ul>
      )}
    </section>
  );
}

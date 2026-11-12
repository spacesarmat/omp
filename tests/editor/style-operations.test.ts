import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDraftController, type DraftController } from '../../editor/src/drafts';
import type { EditorClient } from '../../editor/src/client';
import { buildOverride, overrideId, type OverrideIdentity } from '../../design/catalog';
import type { StylePreset } from '../../design/schema';
import {
  applyPresetToUsages,
  applyStylePreset,
  copyStyle,
  deleteStylePreset,
  findTokenUsages,
  parseStyleClipboard,
  pasteStyle,
  resetStyleProperty,
  saveStylePreset,
} from '../../editor/src/layout/styleOperations';

const BASE = '0000000000000000000000000000000000000000';

function makeIdentity(patch: Partial<OverrideIdentity> = {}): OverrideIdentity {
  return {
    scope: 'element',
    target: 'desktop-windows',
    screenId: 'settings',
    elementId: 'sidebar',
    format: 'landscape',
    state: 'default',
    ...patch,
  };
}

const SIDEBAR_TOKENS = ['--omp-color-panel', '--omp-size-sidebar'];

let controller: DraftController;

function makeController(): DraftController {
  const client: EditorClient = {
    state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
    getDraft: async () => null,
    putDraft: async (draft) => draft,
    getDesign: async () => null,
    rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
    exportDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
  };
  return createDraftController({ draft: createDefaultDraft('draft-1', BASE), client, autosaveMs: 20 });
}

afterEach(() => {
  controller?.dispose();
  vi.restoreAllMocks();
});

describe('copyStyle', () => {
  it('keeps only allowed tokens and never carries nodeId or action', () => {
    const clipboard = copyStyle(
      {
        '--omp-color-panel': '#112233',
        '--omp-size-sidebar': '320px',
        '--omp-color-text': '#ffffff',
        'nodeId': 'sidebar',
        'action': 'navigate',
      },
      SIDEBAR_TOKENS,
    );
    expect(clipboard).toEqual({ schemaVersion: 1, tokens: { '--omp-color-panel': '#112233', '--omp-size-sidebar': '320px' } });
    const serialized = JSON.stringify(clipboard);
    expect(serialized).not.toContain('nodeId');
    expect(serialized).not.toContain('action');
  });

  it('returns an empty clipboard when nothing is allowed', () => {
    expect(copyStyle({ '--omp-color-panel': '#112233' }, [])).toEqual({ schemaVersion: 1, tokens: {} });
  });
});

describe('parseStyleClipboard', () => {
  it('accepts a valid clipboard', () => {
    const result = parseStyleClipboard({ schemaVersion: 1, tokens: { '--omp-color-panel': '#112233' } });
    expect(result.errors).toEqual([]);
    expect(result.clipboard).toEqual({ schemaVersion: 1, tokens: { '--omp-color-panel': '#112233' } });
  });

  it('collects version, nodeId, action, token and value errors', () => {
    const result = parseStyleClipboard({
      schemaVersion: 2,
      nodeId: 'sidebar',
      action: 'navigate',
      tokens: { '--unknown-token': '#112233', '--omp-color-panel': 'not-a-color' },
    });
    expect(result.clipboard).toBeNull();
    expect(result.errors).toContain('Неподдерживаемая версия clipboard');
    expect(result.errors).toContain('Clipboard не должен содержать nodeId');
    expect(result.errors).toContain('Clipboard не должен содержать action');
    expect(result.errors).toContain('Неизвестный token: --unknown-token');
    expect(result.errors).toContain('Некорректное значение: --omp-color-panel');
  });

  it('rejects non-object and empty clipboards', () => {
    expect(parseStyleClipboard(null).errors).toEqual(['Clipboard должен быть объектом']);
    expect(parseStyleClipboard({ schemaVersion: 1, tokens: {} }).errors).toEqual(['В clipboard нет tokens']);
    expect(parseStyleClipboard({ schemaVersion: 1 }).errors).toEqual(['tokens должен быть объектом']);
  });

  it('rejects size values above the document limit instead of throwing on paste', () => {
    // The schema caps sizes at 512px; a bigger value must be rejected here with the regular
    // clipboard error, not slip into the draft and throw during validation.
    const result = parseStyleClipboard({ schemaVersion: 1, tokens: { '--omp-size-space': '600px' } });
    expect(result.clipboard).toBeNull();
    expect(result.errors).toEqual(['Некорректное значение: --omp-size-space']);
    expect(parseStyleClipboard({ schemaVersion: 1, tokens: { '--omp-size-space': '512px' } }).errors).toEqual([]);
  });
});

describe('pasteStyle', () => {
  it('creates a documented override in a single undo step', () => {
    controller = makeController();
    const identity = makeIdentity();
    const result = pasteStyle(controller, identity, { schemaVersion: 1, tokens: { '--omp-color-panel': '#aabbcc' } }, SIDEBAR_TOKENS);
    expect(result.changed).toBe(true);
    expect(result.applied).toEqual(['--omp-color-panel']);
    expect(result.incompatible).toEqual([]);
    const override = controller.draft.theme.overrides.find((entry) => entry.id === overrideId(identity));
    expect(override).toEqual(expect.objectContaining({ scope: 'element', elementId: 'sidebar', tokens: { '--omp-color-panel': '#AABBCC' } }));
    expect(controller.undo()).toBe(true);
    expect(controller.draft.theme.overrides).toEqual([]);
  });

  it('merges into the existing override without touching other overrides', () => {
    controller = makeController();
    const identity = makeIdentity();
    controller.upsertOverride(buildOverride(identity, { '--omp-color-panel': '#111111' }));
    const other = makeIdentity({ elementId: 'content', state: 'default' });
    controller.upsertOverride(buildOverride(other, { '--omp-size-space': '12px' }));
    pasteStyle(controller, identity, { schemaVersion: 1, tokens: { '--omp-size-sidebar': '240px' } }, SIDEBAR_TOKENS);
    expect(controller.draft.theme.overrides).toHaveLength(2);
    const override = controller.draft.theme.overrides.find((entry) => entry.id === overrideId(identity));
    expect(override?.tokens).toEqual({ '--omp-color-panel': '#111111', '--omp-size-sidebar': '240px' });
    expect(controller.undo()).toBe(true);
    expect(controller.draft.theme.overrides.find((entry) => entry.id === overrideId(identity))?.tokens).toEqual({ '--omp-color-panel': '#111111' });
  });

  it('lists cross-platform incompatible tokens instead of dropping them silently', () => {
    controller = makeController();
    const identity = makeIdentity({ elementId: 'button', target: 'android-phone' });
    const buttonTokens = ['--omp-color-accent', '--omp-color-text', '--omp-size-radius', '--omp-size-space'];
    const result = pasteStyle(
      controller,
      identity,
      { schemaVersion: 1, tokens: { '--omp-size-sidebar': '320px', '--omp-color-panel': '#112233', '--omp-color-accent': '#aabbcc' } },
      buttonTokens,
    );
    expect(result.applied).toEqual(['--omp-color-accent']);
    expect(result.incompatible).toEqual(['--omp-size-sidebar', '--omp-color-panel']);
    const override = controller.draft.theme.overrides.find((entry) => entry.id === overrideId(identity));
    expect(override?.tokens).toEqual({ '--omp-color-accent': '#AABBCC' });
  });

  it('does not touch the draft when nothing is applicable', () => {
    controller = makeController();
    const identity = makeIdentity();
    const result = pasteStyle(controller, identity, { schemaVersion: 1, tokens: { '--omp-size-sidebar': '320px' } }, ['--omp-color-panel']);
    expect(result.changed).toBe(false);
    expect(result.incompatible).toEqual(['--omp-size-sidebar']);
    expect(controller.draft.theme.overrides).toEqual([]);
    expect(controller.canUndo).toBe(false);
  });
});

describe('resetStyleProperty', () => {
  it('resets a single property and keeps the rest of the override', () => {
    controller = makeController();
    const identity = makeIdentity();
    controller.upsertOverride(buildOverride(identity, { '--omp-color-panel': '#111111', '--omp-size-sidebar': '320px' }));
    expect(resetStyleProperty(controller, identity, '--omp-size-sidebar')).toBe(true);
    const override = controller.draft.theme.overrides.find((entry) => entry.id === overrideId(identity));
    expect(override?.tokens).toEqual({ '--omp-color-panel': '#111111' });
    expect(controller.undo()).toBe(true);
    expect(controller.draft.theme.overrides.find((entry) => entry.id === overrideId(identity))?.tokens).toEqual({ '--omp-color-panel': '#111111', '--omp-size-sidebar': '320px' });
  });

  it('removes the override when its last property is reset', () => {
    controller = makeController();
    const identity = makeIdentity();
    controller.upsertOverride(buildOverride(identity, { '--omp-color-panel': '#111111' }));
    expect(resetStyleProperty(controller, identity, '--omp-color-panel')).toBe(true);
    expect(controller.draft.theme.overrides).toEqual([]);
  });

  it('is a no-op for unknown properties and missing overrides', () => {
    controller = makeController();
    const identity = makeIdentity();
    expect(resetStyleProperty(controller, identity, '--omp-color-panel')).toBe(false);
    controller.upsertOverride(buildOverride(identity, { '--omp-color-panel': '#111111' }));
    expect(resetStyleProperty(controller, identity, '--omp-size-sidebar')).toBe(false);
    expect(controller.draft.theme.overrides).toHaveLength(1);
    expect(controller.canUndo).toBe(true);
  });
});

describe('style presets', () => {
  const preset = (patch: Partial<StylePreset> = {}): StylePreset => ({
    id: 'preset-1',
    name: 'Тёмный акцент',
    tokens: { '--omp-color-accent': '#111111', '--omp-size-radius': '8px' },
    ...patch,
  });

  it('applies a preset as one override and one undo step', () => {
    controller = makeController();
    const identity = makeIdentity({ elementId: 'button', target: 'android-phone' });
    const buttonTokens = ['--omp-color-accent', '--omp-color-text', '--omp-size-radius', '--omp-size-space'];
    const result = applyStylePreset(controller, identity, preset(), buttonTokens);
    expect(result.applied).toEqual(['--omp-color-accent', '--omp-size-radius']);
    expect(result.incompatible).toEqual([]);
    const override = controller.draft.theme.overrides.find((entry) => entry.id === overrideId(identity));
    expect(override?.tokens).toEqual({ '--omp-color-accent': '#111111', '--omp-size-radius': '8px' });
    expect(controller.undo()).toBe(true);
    expect(controller.draft.theme.overrides).toEqual([]);
  });

  it('does not keep an implicit preset reference inside the override', () => {
    controller = makeController();
    const identity = makeIdentity();
    applyStylePreset(controller, identity, preset(), [...SIDEBAR_TOKENS, '--omp-color-accent', '--omp-size-radius']);
    const override = controller.draft.theme.overrides.find((entry) => entry.id === overrideId(identity));
    expect(override && 'presetId' in override).toBe(false);
  });

  it('updates already applied usages only on an explicit command and in one undo step', () => {
    controller = makeController();
    const identity = makeIdentity({ elementId: 'button', target: 'android-phone' });
    const buttonTokens = ['--omp-color-accent', '--omp-color-text', '--omp-size-radius', '--omp-size-space'];
    saveStylePreset(controller, preset());
    applyStylePreset(controller, identity, preset(), buttonTokens);
    const updated = preset({ tokens: { '--omp-color-accent': '#222222', '--omp-size-radius': '12px' } });
    saveStylePreset(controller, updated);
    // Editing the preset must not rewrite applied overrides retroactively.
    expect(controller.draft.theme.overrides.find((entry) => entry.id === overrideId(identity))?.tokens).toEqual({ '--omp-color-accent': '#111111', '--omp-size-radius': '8px' });
    const count = applyPresetToUsages(controller, updated, [overrideId(identity)]);
    expect(count).toBe(1);
    expect(controller.draft.theme.overrides.find((entry) => entry.id === overrideId(identity))?.tokens).toEqual({ '--omp-color-accent': '#222222', '--omp-size-radius': '12px' });
    expect(controller.undo()).toBe(true);
    expect(controller.draft.theme.overrides.find((entry) => entry.id === overrideId(identity))?.tokens).toEqual({ '--omp-color-accent': '#111111', '--omp-size-radius': '8px' });
  });

  it('rewrites only explicitly selected usages and leaves unrelated accent overrides unchanged in one undo step', () => {
    controller = makeController();
    const chosen = makeIdentity({ elementId: 'button', target: 'android-phone' });
    const unrelated = makeIdentity({ elementId: 'content' });
    controller.upsertOverride(buildOverride(chosen, { '--omp-color-accent': '#111111' }));
    controller.upsertOverride(buildOverride(unrelated, { '--omp-color-accent': '#3A3F4A' }));
    const count = applyPresetToUsages(controller, preset({ tokens: { '--omp-color-accent': '#222222' } }), [overrideId(chosen)]);
    expect(count).toBe(1);
    expect(controller.draft.theme.overrides.find((entry) => entry.id === overrideId(chosen))?.tokens['--omp-color-accent']).toBe('#222222');
    expect(controller.draft.theme.overrides.find((entry) => entry.id === overrideId(unrelated))?.tokens['--omp-color-accent']).toBe('#3A3F4A');
    expect(controller.undo()).toBe(true);
    expect(controller.draft.theme.overrides.find((entry) => entry.id === overrideId(chosen))?.tokens['--omp-color-accent']).toBe('#111111');
    expect(controller.draft.theme.overrides.find((entry) => entry.id === overrideId(unrelated))?.tokens['--omp-color-accent']).toBe('#3A3F4A');
  });

  it('is a no-op until at least one usage is selected', () => {
    controller = makeController();
    const identity = makeIdentity();
    controller.upsertOverride(buildOverride(identity, { '--omp-color-accent': '#111111' }));
    expect(applyPresetToUsages(controller, preset(), [])).toBe(0);
    expect(controller.draft.theme.overrides.find((entry) => entry.id === overrideId(identity))?.tokens['--omp-color-accent']).toBe('#111111');
    // The empty selection adds no undo step: one undo still removes the setup override.
    expect(controller.undo()).toBe(true);
    expect(controller.draft.theme.overrides).toEqual([]);
  });

  it('saves and upserts presets in theme.stylePresets with one undo step', () => {
    controller = makeController();
    saveStylePreset(controller, preset());
    saveStylePreset(controller, preset({ name: 'Новое имя' }));
    expect(controller.draft.theme.stylePresets).toEqual([preset({ name: 'Новое имя' })]);
    expect(controller.undo()).toBe(true);
    expect(controller.draft.theme.stylePresets).toEqual([preset()]);
    expect(deleteStylePreset(controller, 'preset-1')).toBe(true);
    expect(controller.draft.theme.stylePresets).toEqual([]);
    expect(deleteStylePreset(controller, 'preset-1')).toBe(false);
  });

  it('rejects presets with unknown tokens before touching the draft', () => {
    controller = makeController();
    expect(() => saveStylePreset(controller, preset({ tokens: { '--unknown-token': '#112233' } }))).toThrow('Неизвестные tokens: --unknown-token');
    expect(controller.canUndo).toBe(false);
    expect(() => saveStylePreset(controller, preset({ name: '  ' }))).toThrow('Имя preset обязательно');
  });
});

describe('findTokenUsages', () => {
  it('finds overrides across platforms and screens plus presets', () => {
    controller = makeController();
    const theme = controller.draft.theme;
    theme.overrides = [
      buildOverride(makeIdentity(), { '--omp-color-panel': '#111111' }),
      buildOverride(makeIdentity({ target: 'android-tv', elementId: 'button', screenId: 'settings' }), { '--omp-color-panel': '#222222' }),
      buildOverride(makeIdentity({ elementId: 'content' }), { '--omp-size-space': '12px' }),
    ];
    theme.stylePresets = [{ id: 'preset-1', name: 'P', tokens: { '--omp-color-panel': '#333333' } }];
    const usages = findTokenUsages(theme, '--omp-color-panel');
    expect(usages).toHaveLength(3);
    expect(usages[0]).toEqual(expect.objectContaining({ kind: 'override', scope: 'element', target: 'desktop-windows', screenId: 'settings', elementId: 'sidebar', value: '#111111' }));
    expect(usages[1]).toEqual(expect.objectContaining({ kind: 'override', target: 'android-tv', elementId: 'button', value: '#222222' }));
    expect(usages[2]).toEqual(expect.objectContaining({ kind: 'preset', id: 'preset-1', name: 'P', value: '#333333' }));
    expect(findTokenUsages(theme, '--omp-size-radius')).toEqual([]);
  });
});

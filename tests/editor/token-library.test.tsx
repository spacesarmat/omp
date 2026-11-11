import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDraftController, type DraftController } from '../../editor/src/drafts';
import { ThemeInspector } from '../../editor/src/components/ThemeInspector';
import { buildOverride, type OverrideIdentity } from '../../design/catalog';
import { STYLE_CLIPBOARD_KEY } from '../../editor/src/layout/styleOperations';
import { LAYOUT_CLIPBOARD_KEY } from '../../editor/src/App';
import type { EditorClient } from '../../editor/src/client';

const BASE = '0000000000000000000000000000000000000000';
let host: HTMLDivElement;
let controller: DraftController;

function mount(element: h.JSX.Element): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(element, host));
}

function createController(): DraftController {
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

function change(selector: string, value: string): void {
  const input = host.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function click(selector: string): void {
  act(() => {
    host.querySelector<HTMLButtonElement>(selector)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function sidebarIdentity(): OverrideIdentity {
  return { scope: 'element', target: 'desktop-windows', screenId: 'settings', elementId: 'sidebar', format: 'landscape', state: 'default' };
}

afterEach(() => {
  if (host) {
    act(() => render(null, host));
    host.remove();
  }
  controller?.dispose();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('TokenLibrary', () => {
  it('renders inside ThemeInspector with style clipboard actions', () => {
    controller = createController();
    mount(h(ThemeInspector, { controller, target: 'desktop-windows', screenId: 'settings', elementId: 'sidebar', format: 'landscape' }));
    expect(host.querySelector('[data-testid="token-library"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="style-copy"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="style-paste"]')).not.toBeNull();
  });

  it('copies only allowed tokens into a separate style clipboard', () => {
    controller = createController();
    mount(h(ThemeInspector, { controller, target: 'desktop-windows', screenId: 'settings', elementId: 'sidebar', format: 'landscape' }));
    click('[data-testid="style-copy"]');
    const raw = window.localStorage.getItem(STYLE_CLIPBOARD_KEY);
    expect(raw).not.toBeNull();
    const clipboard = JSON.parse(raw!);
    expect(clipboard.schemaVersion).toBe(1);
    expect(Object.keys(clipboard.tokens).sort()).toEqual(['--omp-color-panel', '--omp-size-sidebar']);
    expect(raw!).not.toContain('nodeId');
    expect(raw!).not.toContain('action');
    expect(window.localStorage.getItem(LAYOUT_CLIPBOARD_KEY)).toBeNull();
  });

  it('pastes a copied style into another element and lists incompatible tokens', () => {
    controller = createController();
    window.localStorage.setItem(STYLE_CLIPBOARD_KEY, JSON.stringify({
      schemaVersion: 1,
      tokens: { '--omp-color-panel': '#112233', '--omp-size-sidebar': '320px', '--omp-color-accent': '#aabbcc' },
    }));
    mount(h(ThemeInspector, { controller, target: 'android-phone', screenId: 'settings', elementId: 'button', format: 'landscape' }));
    change('[data-testid="scope"]', 'element');
    click('[data-testid="style-paste"]');
    const override = controller.draft.theme.overrides.find((entry) => entry.elementId === 'button');
    expect(override?.tokens).toEqual({ '--omp-color-accent': '#AABBCC' });
    const incompatible = Array.from(host.querySelectorAll('[data-testid="style-incompatible"] li')).map((item) => item.textContent);
    expect(incompatible).toEqual(['Не поддерживается: --omp-color-panel', 'Не поддерживается: --omp-size-sidebar']);
  });

  it('shows a clipboard error without touching the draft', () => {
    controller = createController();
    window.localStorage.setItem(STYLE_CLIPBOARD_KEY, '{broken');
    mount(h(ThemeInspector, { controller, target: 'desktop-windows', screenId: 'settings', elementId: 'sidebar', format: 'landscape' }));
    click('[data-testid="style-paste"]');
    expect(host.querySelector('[data-testid="style-clipboard-error"]')!.textContent).toContain('Clipboard повреждён');
    expect(controller.draft.theme.overrides).toEqual([]);
    expect(controller.canUndo).toBe(false);
  });

  it('resets a single style property from the property list', () => {
    controller = createController();
    controller.upsertOverride(buildOverride(sidebarIdentity(), { '--omp-color-panel': '#111111', '--omp-size-sidebar': '320px' }));
    mount(h(ThemeInspector, { controller, target: 'desktop-windows', screenId: 'settings', elementId: 'sidebar', format: 'landscape' }));
    change('[data-testid="scope"]', 'element');
    const row = host.querySelector('[data-testid="token-row---omp-size-sidebar"]')!;
    const button = row.querySelector<HTMLButtonElement>('button')!;
    expect(button.disabled).toBe(false);
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const override = controller.draft.theme.overrides.find((entry) => entry.elementId === 'sidebar');
    expect(override?.tokens).toEqual({ '--omp-color-panel': '#111111' });
  });

  it('disables reset for properties that are not overridden', () => {
    controller = createController();
    mount(h(ThemeInspector, { controller, target: 'desktop-windows', screenId: 'settings', elementId: 'sidebar', format: 'landscape' }));
    change('[data-testid="scope"]', 'element');
    const row = host.querySelector('[data-testid="token-row---omp-size-sidebar"]')!;
    expect(row.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
  });

  it('saves the current style as a named preset with allowed tokens only', () => {
    controller = createController();
    mount(h(ThemeInspector, { controller, target: 'desktop-windows', screenId: 'settings', elementId: 'sidebar', format: 'landscape' }));
    change('[data-testid="preset-name"]', 'Мой preset');
    click('[data-testid="preset-save"]');
    const presets = controller.draft.theme.stylePresets ?? [];
    expect(presets).toHaveLength(1);
    expect(presets[0].name).toBe('Мой preset');
    expect(presets[0].id).toMatch(/^preset-/);
    expect(Object.keys(presets[0].tokens).sort()).toEqual(['--omp-color-panel', '--omp-size-sidebar']);
    expect(controller.undo()).toBe(true);
    expect(controller.draft.theme.stylePresets ?? []).toEqual([]);
  });

  it('applies a preset and updates usages only after an explicit command', () => {
    controller = createController();
    const identity: OverrideIdentity = { scope: 'element', target: 'android-phone', screenId: 'settings', elementId: 'button', format: 'landscape', state: 'default' };
    controller.upsertOverride(buildOverride(identity, { '--omp-color-accent': '#111111' }));
    controller.update((draft) => {
      draft.theme.stylePresets = [{ id: 'preset-1', name: 'Тёмный', tokens: { '--omp-color-accent': '#222222' } }];
      return draft;
    });
    mount(h(ThemeInspector, { controller, target: 'android-phone', screenId: 'settings', elementId: 'button', format: 'landscape' }));
    change('[data-testid="scope"]', 'element');
    const row = host.querySelector('[data-testid="preset-row-preset-1"]')!;
    act(() => {
      row.querySelector<HTMLButtonElement>('[aria-label="Применить Тёмный"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(controller.draft.theme.overrides.find((entry) => entry.elementId === 'button')?.tokens['--omp-color-accent']).toBe('#222222');
    // Preset edit does not rewrite applied overrides until the explicit update command.
    act(() => {
      controller.update((draft) => {
        draft.theme.stylePresets = [{ id: 'preset-1', name: 'Тёмный', tokens: { '--omp-color-accent': '#333333' } }];
        return draft;
      });
    });
    expect(controller.draft.theme.overrides.find((entry) => entry.elementId === 'button')?.tokens['--omp-color-accent']).toBe('#222222');
    act(() => {
      host.querySelector<HTMLButtonElement>('[aria-label="Обновить использования Тёмный"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(controller.draft.theme.overrides.find((entry) => entry.elementId === 'button')?.tokens['--omp-color-accent']).toBe('#333333');
    expect(controller.undo()).toBe(true);
    expect(controller.draft.theme.overrides.find((entry) => entry.elementId === 'button')?.tokens['--omp-color-accent']).toBe('#222222');
  });

  it('deletes a preset without touching overrides', () => {
    controller = createController();
    controller.update((draft) => {
      draft.theme.stylePresets = [{ id: 'preset-1', name: 'Тёмный', tokens: { '--omp-color-accent': '#222222' } }];
      return draft;
    });
    mount(h(ThemeInspector, { controller, target: 'desktop-windows', screenId: 'settings', elementId: 'sidebar', format: 'landscape' }));
    act(() => {
      host.querySelector<HTMLButtonElement>('[aria-label="Удалить Тёмный"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(controller.draft.theme.stylePresets ?? []).toEqual([]);
    expect(controller.draft.theme.overrides).toEqual([]);
  });

  it('finds token usages across platforms and presets', () => {
    controller = createController();
    controller.upsertOverride(buildOverride(sidebarIdentity(), { '--omp-color-panel': '#111111' }));
    controller.update((draft) => {
      draft.theme.stylePresets = [{ id: 'preset-1', name: 'Тёмный', tokens: { '--omp-color-panel': '#333333' } }];
      return draft;
    });
    mount(h(ThemeInspector, { controller, target: 'desktop-windows', screenId: 'settings', elementId: 'sidebar', format: 'landscape' }));
    change('[data-testid="usage-search"]', '--omp-color-panel');
    const rows = Array.from(host.querySelectorAll('[data-testid="usage-row"]')).map((item) => item.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('element sidebar (settings) desktop-windows');
    expect(rows[0]).toContain('#111111');
    expect(rows[1]).toContain('preset Тёмный');
    expect(rows[1]).toContain('#333333');
    change('[data-testid="usage-search"]', '--omp-size-radius');
    expect(host.querySelectorAll('[data-testid="usage-row"]')).toHaveLength(0);
    expect(host.textContent).toContain('Использований нет');
  });
});

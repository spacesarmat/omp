import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultDraft, type EditorDraft } from '../../editor/shared/draft';
import { createDraftController, type DraftController } from '../../editor/src/drafts';
import { ThemeInspector } from '../../editor/src/components/ThemeInspector';
import { App } from '../../editor/src/App';
import { generateThemeCss } from '../../design/theme';
import type { EditorClient } from '../../editor/src/client';

const BASE = '0000000000000000000000000000000000000000';
let host: HTMLDivElement;
let controller: DraftController;
let saved: EditorDraft[];

function mount(element: h.JSX.Element): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(element, host));
}

function createController(): DraftController {
  saved = [];
  const client: EditorClient = {
    state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
    getDraft: async () => null,
    putDraft: async (draft) => {
      saved.push(draft);
      return draft;
    },
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

afterEach(() => {
  if (host) {
    act(() => render(null, host));
    host.remove();
  }
  controller?.dispose();
  vi.restoreAllMocks();
});

describe('ThemeInspector', () => {
  it('edits only the selected platform and element scope', () => {
    controller = createController();
    mount(h(ThemeInspector, { controller, target: 'desktop-windows', screenId: 'settings', elementId: 'sidebar', format: 'landscape' }));
    change('[data-testid="scope"]', 'element');
    change('[data-token="--omp-color-panel"]', '#112233');
    expect(controller.draft.theme.overrides).toEqual([
      expect.objectContaining({ scope: 'element', target: 'desktop-windows', elementId: 'sidebar', tokens: { '--omp-color-panel': '#112233' } }),
    ]);
    expect(generateThemeCss(controller.draft.theme, 'desktop-macos')).not.toContain('#112233');
    expect(host.textContent).toContain('theme > platform > element');
  });

  it('rejects unknown elements and preview-only screens', () => {
    controller = createController();
    mount(h(ThemeInspector, { controller, target: 'desktop-windows', screenId: 'settings', elementId: 'unknown', format: 'landscape' }));
    expect(host.textContent).toContain('Unknown element');
    expect(controller.draft.theme.overrides).toEqual([]);
    act(() => render(h(ThemeInspector, { controller, target: 'desktop-windows', screenId: 'library', elementId: 'sidebar', format: 'landscape' }), host));
    expect(host.textContent).toContain('preview only');
    expect(host.querySelector('[data-testid="scope"]')).toBeNull();
  });

  it('rejects invalid values without saving them', () => {
    controller = createController();
    mount(h(ThemeInspector, { controller, target: 'desktop-windows', screenId: 'settings', elementId: 'sidebar', format: 'landscape' }));
    change('[data-token="--omp-color-panel"]', 'not-a-color');
    change('[data-token="--omp-size-sidebar"]', '513');
    expect(controller.draft.theme.overrides).toEqual([]);
    expect(host.textContent).toContain('INVALID_VALUE');
  });

  it('shows contrast and font issues while preserving the draft', () => {
    controller = createController();
    controller.upsertOverride({ id: 'bad-colors', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#000000', '--omp-size-font': '8px' } });
    mount(h(ThemeInspector, { controller, target: 'desktop-windows', screenId: 'settings', elementId: 'sidebar', format: 'landscape' }));
    expect(host.textContent).toContain('CONTRAST');
    expect(host.textContent).toContain('FONT_SIZE');
    expect(controller.draft.theme.overrides[0].id).toBe('bad-colors');
  });

  it('resets only the selected override and persists one undo step', async () => {
    controller = createController();
    mount(h(ThemeInspector, { controller, target: 'desktop-windows', screenId: 'settings', elementId: 'sidebar', format: 'landscape' }));
    change('[data-testid="scope"]', 'element');
    change('[data-token="--omp-color-panel"]', '#112233');
    await controller.flush();
    expect(saved).toHaveLength(1);
    click('[data-action="reset"]');
    expect(controller.draft.theme.overrides).toEqual([]);
    expect(controller.draft.theme.tokens['--omp-color-panel']).toBe('#181B22');
    expect(controller.undo()).toBe(true);
    expect(controller.draft.theme.overrides).toHaveLength(1);
  });

  it('resets the same element override after changing orientation', () => {
    controller = createController();
    mount(h(ThemeInspector, { controller, target: 'desktop-windows', screenId: 'settings', elementId: 'sidebar', format: 'landscape' }));
    change('[data-testid="scope"]', 'element');
    change('[data-token="--omp-color-panel"]', '#112233');
    act(() => render(h(ThemeInspector, { controller, target: 'desktop-windows', screenId: 'settings', elementId: 'sidebar', format: 'portrait' }), host));
    click('[data-action="reset"]');
    expect(controller.draft.theme.overrides).toEqual([]);
  });
  it('offers only states that exist on the selected control', () => {
    controller = createController();
    mount(h(ThemeInspector, { controller, target: 'desktop-windows', screenId: 'settings', elementId: 'settings-continue', format: 'landscape' }));
    change('[data-testid="scope"]', 'state');
    const states = Array.from(host.querySelectorAll<HTMLOptionElement>('[data-testid="state"] option')).map((option) => option.value);
    expect(states).toEqual(['default', 'hover', 'focus', 'active', 'error']);
    expect(host.querySelector('[data-token="--omp-color-background"]')).not.toBeNull();
    expect(host.querySelector('[data-token="--omp-color-text"]')).toBeNull();
    act(() => render(h(ThemeInspector, { controller, target: 'desktop-windows', screenId: 'settings', elementId: 'nav-library', format: 'landscape' }), host));
    expect(host.querySelector('[data-token="--omp-color-muted"]')).not.toBeNull();
    expect(host.querySelector('[data-token="--omp-color-background"]')).not.toBeNull();
    expect(host.querySelector('[data-token="--omp-color-text"]')).toBeNull();
  });
  it('omits focus for containers that cannot receive keyboard focus', () => {
    controller = createController();
    mount(h(ThemeInspector, { controller, target: 'desktop-windows', screenId: 'settings', elementId: 'sidebar', format: 'landscape' }));
    change('[data-testid="scope"]', 'state');
    let states = Array.from(host.querySelectorAll<HTMLOptionElement>('[data-testid="state"] option')).map((option) => option.value);
    expect(states).toEqual(['default', 'hover']);
    act(() => render(h(ThemeInspector, { controller, target: 'desktop-windows', screenId: 'settings', elementId: 'content', format: 'landscape' }), host));
    states = Array.from(host.querySelectorAll<HTMLOptionElement>('[data-testid="state"] option')).map((option) => option.value);
    expect(states).toEqual(['default', 'hover']);
  });
});

describe('editor before and after', () => {
  it('switches the preview without replacing the draft', () => {
    controller = createController();
    mount(h(App, { controller }));
    const before = controller.draft.theme;
    click('[data-testid="before-after"]');
    expect(host.querySelector('[data-testid="before-after"]')!.textContent).toContain('После');
    expect(controller.draft.theme).toBe(before);
    click('[data-testid="before-after"]');
    expect(host.querySelector('[data-testid="before-after"]')!.textContent).toContain('До');
    expect(controller.draft.theme).toBe(before);
  });
});

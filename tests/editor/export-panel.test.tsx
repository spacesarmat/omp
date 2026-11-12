import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDraftController, type DraftController } from '../../editor/src/drafts';
import { ExportPanel } from '../../editor/src/components/ExportPanel';
import { EditorApiError, type EditorClient } from '../../editor/src/client';
import type { ExportDiff } from '../../editor/export.mjs';
import type { LayoutIssue } from '../../design/layout-checks';

const BASE = '0000000000000000000000000000000000000000';
let host: HTMLDivElement;
let controller: DraftController;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  controller = createDraftController({
    draft: createDefaultDraft('draft-1', BASE),
    client: {
      state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
      getDraft: async () => null,
      putDraft: async (draft) => draft,
      getDesign: async () => null,
      rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
      exportDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
    },
  });
});

afterEach(() => {
  act(() => render(null, host));
  controller.dispose();
  host.remove();
  vi.restoreAllMocks();
});

describe('ExportPanel', () => {
  it('stores release intent and exports after flushing the draft', async () => {
    const exportDraft = vi.fn(async (draft: typeof controller.draft) => ({
      baseCommit: draft.baseCommit,
      files: ['design/themes/default.json'],
      releaseIntents: draft.theme.releaseIntents,
      targets: ['desktop-windows' as const],
      scope: 'all' as const,
    }));
    const client: EditorClient = {
      state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
      getDraft: async () => null,
      putDraft: async (draft) => draft,
      getDesign: async () => null,
      rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
      exportDraft,
    };
    act(() => render(h(ExportPanel, { controller, client }), host));
    const version = host.querySelector<HTMLInputElement>('[data-testid="release-version"]')!;
    act(() => {
      version.value = '0.20.12-beta.3';
      version.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => host.querySelector<HTMLButtonElement>('[data-action="save-release"]')!.click());
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-action="export"]')!.click();
    });
    await vi.waitFor(() => expect(exportDraft).toHaveBeenCalledOnce(), { timeout: 1000 });
    expect(controller.draft.theme.releaseIntents).toEqual([{ target: 'desktop-windows', version: '0.20.12-beta.3', channel: 'beta' }]);
    expect(host.textContent).toContain('design/themes/default.json');
    expect(host.textContent).toContain('git diff -- design');
  });

  it('shows the API code and detailed design issues after a failed export', async () => {
    const client: EditorClient = {
      state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
      getDraft: async () => null,
      putDraft: async (draft) => draft,
      getDesign: async () => null,
      rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
      exportDraft: async () => {
        throw new EditorApiError('DESIGN_ISSUES', 422, [{
          code: 'CONTRAST',
          target: 'desktop-windows',
          screenId: 'settings',
          elementId: 'nav-library',
          token: '--omp-color-muted',
          message: '--omp-color-muted on --omp-color-panel has contrast 2.10:1',
        }]);
      },
    };
    act(() => render(h(ExportPanel, { controller, client }), host));
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-action="export"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const alert = host.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('DESIGN_ISSUES');
    expect(alert.textContent).toContain('CONTRAST');
    expect(alert.textContent).toContain('desktop-windows');
    expect(alert.textContent).toContain('nav-library');
    expect(alert.textContent).toContain('--omp-color-muted');
    expect(alert.textContent).toContain('contrast 2.10:1');
    expect(document.activeElement).toBe(alert);
  });

  it('shows package status for macOS and Linux', () => {
    controller.setView({ target: 'desktop-macos', screenId: 'settings', format: 'landscape', language: 'ru' });
    act(() => render(h(ExportPanel, { controller }), host));
    expect(host.textContent).toContain('package unavailable');
  });

  it('blocks export until geometry warnings are explicitly confirmed', async () => {
    const exportDraft = vi.fn(async (draft: typeof controller.draft) => ({
      baseCommit: draft.baseCommit,
      files: ['design/themes/default.json'],
      releaseIntents: draft.theme.releaseIntents,
      targets: ['desktop-windows' as const],
      scope: 'all' as const,
    }));
    const client: EditorClient = {
      state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
      getDraft: async () => null,
      putDraft: async (draft) => draft,
      getDesign: async () => null,
      rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
      exportDraft,
    };
    const issues: LayoutIssue[] = [{ code: 'SAFE_AREA', nodeId: 'edge', severity: 'warning', message: 'outside the TV safe area' }];
    const onGeometryConfirm = vi.fn();
    act(() => render(h(ExportPanel, { controller, client, issues, geometryConfirmed: false, onGeometryConfirm }), host));
    const exportButton = () => host.querySelector<HTMLButtonElement>('[data-action="export"]')!;
    expect(exportButton().disabled).toBe(true);
    const checkbox = host.querySelector<HTMLInputElement>('[data-testid="confirm-geometry-warnings"]')!;
    act(() => {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onGeometryConfirm).toHaveBeenCalledWith(true);
    act(() => render(h(ExportPanel, { controller, client, issues, geometryConfirmed: true, onGeometryConfirm }), host));
    expect(exportButton().disabled).toBe(false);
    await act(async () => {
      exportButton().click();
    });
    await vi.waitFor(() => expect(exportDraft).toHaveBeenCalledOnce(), { timeout: 1000 });
  });

  it('blocks export while the preview does not show the live draft, even with clean shown geometry', async () => {
    const exportDraft = vi.fn(async (draft: typeof controller.draft) => ({
      baseCommit: draft.baseCommit,
      files: ['design/themes/default.json'],
      releaseIntents: draft.theme.releaseIntents,
      targets: ['desktop-windows' as const],
      scope: 'all' as const,
    }));
    const client: EditorClient = {
      state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
      getDraft: async () => null,
      putDraft: async (draft) => draft,
      getDesign: async () => null,
      rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
      exportDraft,
    };
    act(() => render(h(ExportPanel, { controller, client, issues: [], geometryConfirmed: false, onGeometryConfirm: vi.fn(), draftChecked: false }), host));
    const exportButton = host.querySelector<HTMLButtonElement>('[data-action="export"]')!;
    expect(exportButton.disabled).toBe(true);
    expect(host.querySelector('[data-testid="draft-unchecked-notice"]')).not.toBeNull();
    await act(async () => {
      exportButton.click();
    });
    expect(exportDraft).not.toHaveBeenCalled();
  });

  it('keeps export enabled without geometry warnings and hides the confirmation', () => {
    act(() => render(h(ExportPanel, { controller, issues: [], geometryConfirmed: false, onGeometryConfirm: vi.fn() }), host));
    expect(host.querySelector<HTMLButtonElement>('[data-action="export"]')!.disabled).toBe(false);
    expect(host.querySelector('[data-testid="confirm-geometry-warnings"]')).toBeNull();
  });

  it('exports the selected page scope and shows the affected targets', async () => {
    const exportDraft = vi.fn(async (draft: typeof controller.draft) => ({
      baseCommit: draft.baseCommit,
      files: ['design/generated/layout.ts', 'design/themes/default.json'],
      releaseIntents: draft.theme.releaseIntents,
      targets: ['desktop-windows' as const, 'desktop-macos' as const],
      scope: 'page' as const,
    }));
    const client: EditorClient = {
      state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
      getDraft: async () => null,
      putDraft: async (draft) => draft,
      getDesign: async () => null,
      rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
      exportDraft,
    };
    act(() => render(h(ExportPanel, { controller, client }), host));
    const scope = host.querySelector<HTMLSelectElement>('[data-testid="export-scope"]')!;
    act(() => {
      scope.value = 'page';
      scope.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-action="export"]')!.click();
    });
    await vi.waitFor(() => expect(exportDraft).toHaveBeenCalledOnce(), { timeout: 1000 });
    const [exported, options] = exportDraft.mock.calls[0] as unknown as [typeof controller.draft, { scope: unknown }];
    expect(exported).toMatchObject({ id: 'draft-1', baseCommit: BASE, screenId: 'settings' });
    expect(options).toEqual({ scope: { kind: 'page', screenId: 'settings' } });
    expect(host.textContent).toContain('Windows');
    expect(host.textContent).toContain('macOS');
  });

  it('exports the selected component scope', async () => {
    const exportDraft = vi.fn(async (draft: typeof controller.draft) => ({
      baseCommit: draft.baseCommit,
      files: ['design/generated/layout.ts', 'design/themes/default.json'],
      releaseIntents: draft.theme.releaseIntents,
      targets: ['desktop-windows' as const],
      scope: 'component' as const,
    }));
    const client: EditorClient = {
      state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
      getDraft: async () => null,
      putDraft: async (draft) => draft,
      getDesign: async () => null,
      rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
      exportDraft,
    };
    act(() => render(h(ExportPanel, { controller, client }), host));
    const scope = host.querySelector<HTMLSelectElement>('[data-testid="export-scope"]')!;
    act(() => {
      scope.value = 'component';
      scope.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const component = host.querySelector<HTMLInputElement>('[data-testid="export-component"]')!;
    act(() => {
      component.value = 'card-a';
      component.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-action="export"]')!.click();
    });
    await vi.waitFor(() => expect(exportDraft).toHaveBeenCalledOnce(), { timeout: 1000 });
    const [, options] = exportDraft.mock.calls[0] as unknown as [unknown, { scope: unknown }];
    expect(options).toEqual({ scope: { kind: 'component', nodeId: 'card-a' } });
  });

  it('disables the component export until a node id is entered', () => {
    act(() => render(h(ExportPanel, { controller }), host));
    const scope = host.querySelector<HTMLSelectElement>('[data-testid="export-scope"]')!;
    act(() => {
      scope.value = 'component';
      scope.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const exportButton = host.querySelector<HTMLButtonElement>('[data-action="export"]')!;
    expect(exportButton.disabled).toBe(true);
    const component = host.querySelector<HTMLInputElement>('[data-testid="export-component"]')!;
    act(() => {
      component.value = 'card-a';
      component.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(exportButton.disabled).toBe(false);
  });

  it('shows the scoped diff before exporting', async () => {
    const diff: ExportDiff = {
      baseCommit: BASE,
      targets: ['desktop-windows'],
      files: [
        { path: 'design/generated/layout.ts', action: 'update', before: 'old', after: 'new' },
        { path: 'design/themes/default.json', action: 'unchanged', before: 'same', after: 'same' },
      ],
      foreignDirty: ['design/themes/foreign.json'],
    };
    const exportDiff = vi.fn(async () => diff);
    const client: EditorClient = {
      state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
      getDraft: async () => null,
      putDraft: async (draft) => draft,
      getDesign: async () => null,
      rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
      exportDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
      exportDiff,
    };
    act(() => render(h(ExportPanel, { controller, client }), host));
    expect(host.querySelector('[data-action="show-diff"]')).not.toBeNull();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-action="show-diff"]')!.click();
    });
    await vi.waitFor(() => expect(exportDiff).toHaveBeenCalledOnce(), { timeout: 1000 });
    const [diffed, options] = exportDiff.mock.calls[0] as unknown as [typeof controller.draft, { scope: unknown }];
    expect(diffed).toMatchObject({ id: 'draft-1', baseCommit: BASE });
    expect(options).toEqual({ scope: { kind: 'all' } });
    expect(host.textContent).toContain('design/generated/layout.ts');
    expect(host.textContent).toContain('update');
    expect(host.textContent).toContain('design/themes/foreign.json');
  });

  it('hides the diff button when the client cannot diff', () => {
    act(() => render(h(ExportPanel, { controller }), host));
    expect(host.querySelector('[data-action="show-diff"]')).toBeNull();
  });

  it.each([
    { code: 'CONTRAST', message: 'color #777777 on #ffffff has contrast 2.10:1' },
    { code: 'TV_FONT_SIZE', message: 'font size 18px is below the TV minimum 24px' },
    { code: 'OVERFLOW', message: 'rect extends beyond the 1920x1080 viewport' },
  ] as const)('blocks export while a $code error is present, even with confirmed warnings', async ({ code, message }) => {
    const exportDraft = vi.fn(async (draft: typeof controller.draft) => ({
      baseCommit: draft.baseCommit,
      files: ['design/themes/default.json'],
      releaseIntents: draft.theme.releaseIntents,
      targets: ['desktop-windows' as const],
      scope: 'all' as const,
    }));
    const client: EditorClient = {
      state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
      getDraft: async () => null,
      putDraft: async (draft) => draft,
      getDesign: async () => null,
      rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
      exportDraft,
    };
    const issues: LayoutIssue[] = [
      { code, nodeId: 'edge', severity: 'error', message },
      { code: 'SAFE_AREA', nodeId: 'edge', severity: 'warning', message: 'outside the TV safe area' },
    ];
    act(() => render(h(ExportPanel, { controller, client, issues, geometryConfirmed: true, onGeometryConfirm: vi.fn() }), host));

    const exportButton = host.querySelector<HTMLButtonElement>('[data-action="export"]')!;
    expect(exportButton.disabled).toBe(true);
    const notice = host.querySelector('[data-testid="accessibility-error-notice"]')!;
    expect(notice.textContent).toContain(code);
    await act(async () => {
      exportButton.click();
    });
    expect(exportDraft).not.toHaveBeenCalled();
  });

  it('keeps warnings confirmable without any error present', async () => {
    const exportDraft = vi.fn(async (draft: typeof controller.draft) => ({
      baseCommit: draft.baseCommit,
      files: ['design/themes/default.json'],
      releaseIntents: draft.theme.releaseIntents,
      targets: ['desktop-windows' as const],
      scope: 'all' as const,
    }));
    const client: EditorClient = {
      state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
      getDraft: async () => null,
      putDraft: async (draft) => draft,
      getDesign: async () => null,
      rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
      exportDraft,
    };
    const issues: LayoutIssue[] = [{ code: 'SAFE_AREA', nodeId: 'edge', severity: 'warning', message: 'outside the TV safe area' }];
    act(() => render(h(ExportPanel, { controller, client, issues, geometryConfirmed: false, onGeometryConfirm: vi.fn() }), host));

    expect(host.querySelector('[data-testid="accessibility-error-notice"]')).toBeNull();
    const exportButton = host.querySelector<HTMLButtonElement>('[data-action="export"]')!;
    expect(exportButton.disabled).toBe(true);
    act(() => render(h(ExportPanel, { controller, client, issues, geometryConfirmed: true, onGeometryConfirm: vi.fn() }), host));
    expect(host.querySelector<HTMLButtonElement>('[data-action="export"]')!.disabled).toBe(false);
    expect(host.querySelector('[data-testid="confirm-geometry-warnings"]')).not.toBeNull();
  });
});

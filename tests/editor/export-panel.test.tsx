import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDraftController, type DraftController } from '../../editor/src/drafts';
import { ExportPanel } from '../../editor/src/components/ExportPanel';
import type { EditorClient } from '../../editor/src/client';

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

  it('shows package status for macOS and Linux', () => {
    controller.setView({ target: 'desktop-macos', screenId: 'settings', format: 'landscape', language: 'ru' });
    act(() => render(h(ExportPanel, { controller }), host));
    expect(host.textContent).toContain('package unavailable');
  });
});

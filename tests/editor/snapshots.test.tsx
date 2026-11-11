import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SnapshotPanel } from '../../editor/src/components/SnapshotPanel';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDraftController, type DraftController } from '../../editor/src/drafts';
import type { EditorClient } from '../../editor/src/client';

const BASE = '0000000000000000000000000000000000000000';
let host: HTMLDivElement;
let controller: DraftController;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  const client: EditorClient = {
    state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
    getDraft: async () => null,
    putDraft: async (draft) => draft,
    getDesign: async () => null,
    rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
    exportDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
  };
  controller = createDraftController({ draft: createDefaultDraft('draft-1', BASE), client, autosaveMs: 100000 });
});

afterEach(() => {
  act(() => render(null, host));
  controller.dispose();
  host.remove();
});

describe('SnapshotPanel', () => {
  it('creates, lists and restores a snapshot', () => {
    act(() => render(h(SnapshotPanel, { controller }), host));
    act(() => {
      const input = host.querySelector<HTMLInputElement>('[data-testid="snapshot-name"]')!;
      input.value = 'Snapshot 1';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => host.querySelector<HTMLButtonElement>('[data-action="create-snapshot"]')!.click());
    expect(host.textContent).toContain('1/10');
    expect(host.textContent).toContain(controller.draft.snapshots[0].name);
    controller.upsertOverride({ id: 'changed', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#112233' } });

    act(() => host.querySelector<HTMLButtonElement>('[data-action="restore-snapshot"]')!.click());
    expect(controller.draft.theme.overrides).toEqual([]);
    expect(controller.canUndo).toBe(true);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows the 10/10 limit instead of throwing on another create', () => {
    for (let index = 0; index < 10; index += 1) controller.snapshot(`Snapshot ${index}`);
    act(() => render(h(SnapshotPanel, { controller }), host));
    const create = host.querySelector<HTMLButtonElement>('[data-action="create-snapshot"]')!;
    expect(create.disabled).toBe(true);
    expect(host.textContent).toContain('10/10');
    expect(host.querySelectorAll('[data-action="restore-snapshot"]')).toHaveLength(10);
    expect(() => create.click()).not.toThrow();
    expect(controller.draft.snapshots).toHaveLength(10);
  });
});

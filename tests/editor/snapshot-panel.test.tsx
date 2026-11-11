import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDraftController, type DraftController } from '../../editor/src/drafts';
import { SnapshotPanel } from '../../editor/src/components/SnapshotPanel';

const BASE = '0000000000000000000000000000000000000000';
let host: HTMLDivElement;
let controller: DraftController;

function mount(onCompare = vi.fn()) {
  act(() => render(h(SnapshotPanel, { controller, onCompare }), host));
  return onCompare;
}

function click(action: string): void {
  act(() => host.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click());
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  controller = createDraftController({
    draft: createDefaultDraft('draft-1', BASE),
    client: {
      state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
      getDraft: async () => null,
      putDraft: async (draft) => draft,
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

describe('SnapshotPanel', () => {
  it('creates, compares, restores and deletes a named snapshot', () => {
    const onCompare = mount();
    act(() => {
      const input = host.querySelector<HTMLInputElement>('[data-testid="snapshot-name"]')!;
      input.value = 'Blue theme';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click('create-snapshot');
    expect(host.textContent).toContain('Blue theme');

    click('compare-snapshot');
    expect(onCompare).toHaveBeenCalledWith(expect.objectContaining({ name: 'Blue theme' }));
    click('restore-snapshot');
    expect(controller.draft.snapshots).toHaveLength(1);
    click('delete-snapshot');
    expect(controller.draft.snapshots).toHaveLength(0);
    expect(host.textContent).not.toContain('Blue theme');
  });

  it('shows an empty-name error without creating a snapshot', () => {
    mount();
    click('create-snapshot');
    expect(host.textContent).toContain('SNAPSHOT_NAME_REQUIRED');
    expect(controller.draft.snapshots).toHaveLength(0);
  });

  it('shows the snapshot limit without deleting older entries', () => {
    for (let index = 0; index < 10; index += 1) controller.snapshot(`snapshot-${index}`);
    mount();
    click('create-snapshot');
    expect(host.textContent).toContain('SNAPSHOT_LIMIT');
    expect(controller.draft.snapshots).toHaveLength(10);
  });
});

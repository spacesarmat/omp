import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BaseReviewPanel } from '../../editor/src/components/BaseReviewPanel';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDraftController } from '../../editor/src/drafts';
import type { EditorClient } from '../../editor/src/client';

const BASE = '0000000000000000000000000000000000000000';
const NEXT = '1111111111111111111111111111111111111111';
let host: HTMLDivElement;

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.restoreAllMocks();
});

describe('BaseReviewPanel', () => {
  it('previews a rebase and applies it only after explicit confirmation', async () => {
    const incoming = createDefaultDraft('draft-1', NEXT);
    incoming.theme.name = 'From Git';
    const client: EditorClient = {
      state: async () => ({ baseCommit: NEXT, dirtyDesign: false }),
      getDraft: async () => null,
      putDraft: async (draft) => draft,
      getDesign: async () => ({ baseCommit: NEXT, theme: incoming.theme, flow: incoming.flow }),
      rebaseDraft: vi.fn(async () => ({ draft: incoming, changes: ['design/themes/default.json'] })),
      exportDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
    };
    const controller = createDraftController({ draft: createDefaultDraft('draft-1', BASE), client });
    host = document.createElement('div');
    document.body.appendChild(host);
    await act(async () => {
      render(h(BaseReviewPanel, { controller, client }), host);
      await Promise.resolve();
    });
    expect(host.textContent).toContain('Новая версия');

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-action="review-base"]')!.click();
      await Promise.resolve();
    });
    expect(client.rebaseDraft).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('design/themes/default.json');
    expect(controller.draft.baseCommit).toBe(BASE);

    act(() => host.querySelector<HTMLButtonElement>('[data-action="apply-base"]')!.click());
    expect(controller.draft.baseCommit).toBe(NEXT);
    expect(controller.draft.theme.name).toBe('From Git');
    expect(host.textContent).toContain('База актуальна');
    controller.dispose();
  });
});

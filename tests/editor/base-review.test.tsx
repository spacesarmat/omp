import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BaseReviewPanel } from '../../editor/src/components/BaseReviewPanel';
import { createDefaultDraft } from '../../editor/shared/draft';
import { createDraftController } from '../../editor/src/drafts';
import { EditorApiError, type EditorClient } from '../../editor/src/client';

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
    const merged = structuredClone(incoming);
    merged.theme.overrides.push({ id: 'local-only', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#112233' } });
    const client: EditorClient = {
      state: async () => ({ baseCommit: NEXT, dirtyDesign: false }),
      getDraft: async () => null,
      putDraft: async (draft) => ({ ...draft, revision: 1 }),
      getDesign: async () => ({ baseCommit: NEXT, theme: incoming.theme, flow: incoming.flow }),
      rebaseDraft: vi.fn(async () => ({ draft: merged, changes: ['design/themes/default.json'] })),
      exportDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
    };
    const controller = createDraftController({ draft: createDefaultDraft('draft-1', BASE), client });
    controller.upsertOverride({ id: 'local-only', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#112233' } });
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
    const review = host.querySelector<HTMLPreElement>('.editor-base-proposal pre')!.textContent;
    expect(review).toContain('From Git');
    expect(review).toContain('local-only');
    await act(async () => {
      await controller.flush();
    });

    act(() => host.querySelector<HTMLButtonElement>('[data-action="apply-base"]')!.click());
    expect(controller.draft.baseCommit).toBe(NEXT);
    expect(controller.draft.revision).toBe(1);
    expect(controller.draft.theme.name).toBe('From Git');
    expect(host.textContent).toContain('База актуальна');
    controller.dispose();
  });

  it('rejects a stale proposal instead of overwriting newer local edits', async () => {
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
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-action="review-base"]')!.click();
      await Promise.resolve();
    });
    act(() => controller.upsertOverride({ id: 'newer-local-edit', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#112233' } }));

    act(() => host.querySelector<HTMLButtonElement>('[data-action="apply-base"]')!.click());
    expect(controller.draft.baseCommit).toBe(BASE);
    expect(controller.draft.theme.overrides.map((entry) => entry.id)).toEqual(['newer-local-edit']);
    expect(controller.draft.theme.name).not.toBe('From Git');
    expect(client.rebaseDraft).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('DRAFT_CHANGED_REVIEW_REQUIRED');
    controller.dispose();
  });

  it('refetches the committed design when the window receives focus', async () => {
    const incoming = createDefaultDraft('draft-1', NEXT);
    let advanced = false;
    const getDesign = vi.fn(async () => advanced ? { baseCommit: NEXT, theme: incoming.theme, flow: incoming.flow } : null);
    const client: EditorClient = {
      state: async () => ({ baseCommit: advanced ? NEXT : BASE, dirtyDesign: false }),
      getDraft: async () => null,
      putDraft: async (draft) => draft,
      getDesign,
      rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
      exportDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
    };
    const controller = createDraftController({ draft: createDefaultDraft('draft-1', BASE), client });
    host = document.createElement('div');
    document.body.appendChild(host);
    await act(async () => {
      render(h(BaseReviewPanel, { controller, client }), host);
      await Promise.resolve();
    });
    expect(getDesign).toHaveBeenCalledOnce();

    advanced = true;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });
    expect(getDesign).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain(NEXT.slice(0, 8));
    controller.dispose();
  });

  it('shows the conflicting fields returned by the API', async () => {
    const incoming = createDefaultDraft('draft-1', NEXT);
    const client: EditorClient = {
      state: async () => ({ baseCommit: NEXT, dirtyDesign: false }),
      getDraft: async () => null,
      putDraft: async (draft) => draft,
      getDesign: async () => ({ baseCommit: NEXT, theme: incoming.theme, flow: incoming.flow }),
      rebaseDraft: async () => {
        throw new EditorApiError('REBASE_CONFLICT', 409, [{ path: 'theme.name', message: 'Local and Git names differ' }]);
      },
      exportDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
    };
    const controller = createDraftController({ draft: createDefaultDraft('draft-1', BASE), client });
    host = document.createElement('div');
    document.body.appendChild(host);
    await act(async () => {
      render(h(BaseReviewPanel, { controller, client }), host);
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-action="review-base"]')!.click();
      await Promise.resolve();
    });
    const alert = host.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('REBASE_CONFLICT');
    expect(alert.textContent).toContain('theme.name');
    expect(alert.textContent).toContain('Local and Git names differ');
    controller.dispose();
  });
});

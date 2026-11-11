import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../../editor/src/App';
import * as protocol from '../../editor/src/preview/protocol';
import { createDefaultDraft, type EditorDraft } from '../../editor/shared/draft';
import { createDraftController } from '../../editor/src/drafts';
import type { EditorClient } from '../../editor/src/client';

const BASE = '0000000000000000000000000000000000000000';
let host: HTMLDivElement;

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  sessionStorage.removeItem('omp.editor.activeDraftId');
  vi.restoreAllMocks();
});

it('creates a fresh draft from the committed design', async () => {
  const committed = createDefaultDraft('draft-1', BASE);
  committed.theme.name = 'From Git';
  committed.theme.tokens['--omp-color-accent'] = '#112233';
  const client: EditorClient = {
    state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
    getDraft: async () => null,
    putDraft: async (draft) => draft,
    getDesign: async () => ({ baseCommit: BASE, theme: committed.theme, flow: committed.flow }),
    rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
    exportDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
  };
  const send = vi.spyOn(protocol, 'sendPreviewCommand').mockImplementation(() => undefined);
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(h(App, { client }), host));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  act(() => {
    const iframe = host.querySelector<HTMLIFrameElement>('iframe')!;
    iframe.dispatchEvent(new Event('load'));
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      source: iframe.contentWindow,
      data: { type: 'ready', messageId: 'ready', sessionId: iframe.name },
    }));
  });
  expect(send).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ type: 'init', props: expect.objectContaining({ theme: expect.objectContaining({ name: 'From Git' }) }) }),
    expect.anything(),
  );
});

it('loads the recovered draft selected in this tab', async () => {
  sessionStorage.setItem('omp.editor.activeDraftId', 'draft-copy');
  const copy = createDefaultDraft('draft-copy', BASE);
  copy.theme.name = 'Recovered copy';
  const getDraft = vi.fn(async (id: string) => id === copy.id ? copy : null);
  const client: EditorClient = {
    state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
    getDraft,
    putDraft: async (draft) => draft,
    getDesign: async () => null,
    rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
    exportDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
  };
  const send = vi.spyOn(protocol, 'sendPreviewCommand').mockImplementation(() => undefined);
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(h(App, { client }), host));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(getDraft).toHaveBeenCalledWith('draft-copy');
  expect(getDraft).not.toHaveBeenCalledWith('default');
  act(() => {
    const iframe = host.querySelector<HTMLIFrameElement>('iframe')!;
    iframe.dispatchEvent(new Event('load'));
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      source: iframe.contentWindow,
      data: { type: 'ready', messageId: 'ready', sessionId: iframe.name },
    }));
  });
  expect(send).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ type: 'init', props: expect.objectContaining({ theme: expect.objectContaining({ name: 'Recovered copy' }) }) }),
    expect.anything(),
  );
});

it('remembers a recovered copy when the editor is reopened', async () => {
  sessionStorage.removeItem('omp.editor.activeDraftId');
  const drafts = new Map<string, EditorDraft>();
  const client: EditorClient = {
    state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
    getDraft: async (id) => drafts.get(id) || null,
    putDraft: async (draft) => {
      const saved = { ...draft, revision: (draft.revision ?? 0) + 1 };
      drafts.set(draft.id, saved);
      return saved;
    },
    getDesign: async () => null,
    rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
    exportDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
  };
  const controller = createDraftController({ draft: createDefaultDraft('default', BASE), client });
  host = document.createElement('div');
  document.body.appendChild(host);
  try {
    act(() => render(h(App, { controller, client }), host));
    await act(() => controller.saveAsNewDraft());
    const recoveredId = controller.draft.id;
    expect(sessionStorage.getItem('omp.editor.activeDraftId')).toBe(recoveredId);
    act(() => render(null, host));
    const getDraft = vi.spyOn(client, 'getDraft');
    act(() => render(h(App, { client }), host));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(getDraft).toHaveBeenCalledWith(recoveredId);
    expect(getDraft).not.toHaveBeenCalledWith('default');
  } finally {
    controller.dispose();
  }
});

import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultDraft, type EditorDraft } from '../../editor/shared/draft';
import { createDraftController, type DraftController } from '../../editor/src/drafts';
import { useDraftController } from '../../editor/src/useDraftController';
import type { EditorClient } from '../../editor/src/client';

const BASE = '0000000000000000000000000000000000000000';
const controllers: DraftController[] = [];

type PutOptions = { keepalive?: boolean };
type OnPut = (draft: EditorDraft, options?: PutOptions) => Promise<EditorDraft>;

function fakeClient(saved: EditorDraft[], onPut?: OnPut): EditorClient {
  return {
    state: async () => ({ baseCommit: BASE, dirtyDesign: false }),
    getDraft: async () => null,
    putDraft: vi.fn(async (draft: EditorDraft, options?: PutOptions) => {
      if (onPut) return onPut(draft, options);
      saved.push(draft);
      return draft;
    }),
    getDesign: async () => null,
    rebaseDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
    exportDraft: async () => { throw new Error('NOT_IMPLEMENTED'); },
  };
}

function create(saved: EditorDraft[] = [], options: { autosaveMs?: number; onPut?: OnPut } = {}): DraftController {
  const controller = createDraftController({
    draft: createDefaultDraft('draft-1', BASE),
    client: fakeClient(saved, options.onPut),
    autosaveMs: options.autosaveMs ?? 20,
  });
  controllers.push(controller);
  return controller;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('DraftController', () => {
  it('supports undo, redo and debounced persistence', async () => {
    const saved: EditorDraft[] = [];
    const controller = create(saved);
    controller.upsertOverride({ id: 'win', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#111111' } });
    expect(controller.undo()).toBe(true);
    expect(controller.draft.theme.overrides).toEqual([]);
    expect(controller.redo()).toBe(true);
    await controller.flush();
    expect(saved[saved.length - 1].theme.overrides[0].id).toBe('win');
  });

  it('limits undo to 50 steps and clears redo after a new edit', () => {
    const controller = create();
    for (let index = 0; index < 60; index += 1) {
      controller.upsertOverride({ id: `override-${index}`, scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#111111' } });
    }
    for (let index = 0; index < 50; index += 1) expect(controller.undo()).toBe(true);
    expect(controller.undo()).toBe(false);
    expect(controller.draft.theme.overrides).toHaveLength(10);
    expect(controller.redo()).toBe(true);
    controller.upsertOverride({ id: 'new', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#222222' } });
    expect(controller.redo()).toBe(false);
  });

  it('restores snapshots and rejects the eleventh without deleting the oldest', () => {
    const controller = create();
    const first = controller.snapshot('snapshot-0');
    controller.upsertOverride({ id: 'changed', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#111111' } });
    expect(controller.restore(first.id)).toBe(true);
    expect(controller.draft.theme.overrides).toEqual([]);
    expect(controller.undo()).toBe(true);
    for (let index = 1; index < 10; index += 1) controller.snapshot(`snapshot-${index}`);
    expect(() => controller.snapshot('snapshot-10')).toThrow('SNAPSHOT_LIMIT');
    expect(controller.draft.snapshots).toHaveLength(10);
    expect(controller.draft.snapshots[0].id).toBe(first.id);
  });

  it('keeps baseCommit immutable through generic updates', () => {
    const controller = create();
    expect(() => controller.update((draft) => ({ ...draft, baseCommit: '1111111111111111111111111111111111111111' }))).toThrow('BASE_COMMIT_IMMUTABLE');
    expect(controller.draft.baseCommit).toBe(BASE);
  });

  it('applies a reviewed rebase and clears history from the old base', () => {
    const controller = create();
    controller.upsertOverride({ id: 'local', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#111111' } });
    expect(controller.canUndo).toBe(true);
    const rebased = createDefaultDraft('draft-1', '1111111111111111111111111111111111111111');
    rebased.theme.name = 'Reviewed merge';
    controller.rebase(rebased);
    expect(controller.draft.baseCommit).toBe('1111111111111111111111111111111111111111');
    expect(controller.draft.theme.name).toBe('Reviewed merge');
    expect(controller.canUndo).toBe(false);
    expect(controller.canRedo).toBe(false);
    expect(() => controller.rebase(createDefaultDraft('other', '1111111111111111111111111111111111111111'))).toThrow('REBASE_DRAFT_MISMATCH');
  });

  it('cancels autosave after dispose', () => {
    const saved: EditorDraft[] = [];
    const controller = create(saved);
    controller.upsertOverride({ id: 'win', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#111111' } });
    controller.dispose();
    vi.advanceTimersByTime(1000);
    expect(saved).toEqual([]);
  });

  it('coalesces quick changes and waits for an in-flight write', async () => {
    const saved: EditorDraft[] = [];
    let resolveWrite: ((draft: EditorDraft) => void) | undefined;
    const controller = create(saved, {
      onPut: (draft) => new Promise<EditorDraft>((resolve) => {
        resolveWrite = resolve;
      }),
    });
    controller.upsertOverride({ id: 'one', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#111111' } });
    controller.upsertOverride({ id: 'two', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#222222' } });
    let settled = false;
    const pending = controller.flush().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveWrite?.(controller.draft);
    await pending;
    expect(settled).toBe(true);
    expect(saved).toEqual([]);
  });

  it('stores the saved revision and keeps it through undo', async () => {
    const controller = create([], {
      onPut: async (draft) => ({ ...draft, revision: (draft.revision ?? 0) + 1 }),
    });
    controller.upsertOverride({ id: 'local', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#111111' } });
    await controller.flush();
    expect(controller.draft.revision).toBe(1);
    expect(controller.undo()).toBe(true);
    await controller.flush();
    expect(controller.draft.revision).toBe(2);
  });

  it('keeps local changes and records write errors', async () => {
    const controller = create([], { onPut: async () => {
      throw new Error('offline');
    } });
    controller.upsertOverride({ id: 'local', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#111111' } });
    await expect(controller.flush()).rejects.toThrow('offline');
    expect(controller.lastError).toBe('offline');
    expect(controller.draft.lastError).toBe('offline');
    expect(controller.draft.theme.overrides[0].id).toBe('local');
  });

  it('clears a save error on retry and does not persist it', async () => {
    const saved: EditorDraft[] = [];
    let attempts = 0;
    const controller = create(saved, {
      onPut: async (draft) => {
        attempts += 1;
        if (attempts === 1) throw new Error('offline');
        saved.push(draft);
        return draft;
      },
    });
    controller.upsertOverride({ id: 'local', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#111111' } });
    await expect(controller.flush()).rejects.toThrow('offline');
    await controller.flush();
    expect(attempts).toBe(2);
    expect(controller.lastError).toBeNull();
    expect(controller.draft.lastError).toBeNull();
    expect(saved).toHaveLength(1);
    expect(saved[0].lastError).toBeUndefined();
    expect(saved[0].theme.overrides[0].id).toBe('local');
  });

  it('does not bring a cleared save error back with undo', async () => {
    let attempts = 0;
    const controller = create([], {
      onPut: async (draft) => {
        attempts += 1;
        if (attempts === 1) throw new Error('offline');
        return draft;
      },
    });
    controller.upsertOverride({ id: 'local', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#111111' } });
    await expect(controller.flush()).rejects.toThrow('offline');
    controller.upsertOverride({ id: 'next', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#222222' } });
    await controller.flush();
    expect(controller.undo()).toBe(true);
    expect(controller.draft.lastError ?? null).toBeNull();
    expect(controller.lastError).toBeNull();
    expect(controller.draft.theme.overrides.map((entry) => entry.id)).toEqual(['local']);
  });

  it('does not leave a failed autosave as an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const controller = create([], { onPut: async () => { throw new Error('offline'); } });
      controller.upsertOverride({ id: 'local', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#111111' } });
      await vi.advanceTimersByTimeAsync(50);
      expect(controller.lastError).toBe('offline');
      expect(controller.draft.lastError).toBe('offline');
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('changes view and language without replacing theme or flow', () => {
    const controller = create();
    const theme = controller.draft.theme;
    const flow = controller.draft.flow;
    controller.setView({ target: 'desktop-macos', screenId: 'library', format: 'portrait', language: 'en' });
    expect(controller.draft.language).toBe('en');
    expect(controller.draft.theme).toBe(theme);
    expect(controller.draft.flow).toBe(flow);
  });

  it('requests keepalive when flushing during page close', async () => {
    const options: Array<{ keepalive?: boolean } | undefined> = [];
    const controller = create([], {
      onPut: async (_draft, putOptions) => {
        options.push(putOptions);
        return _draft;
      },
    });
    controller.upsertOverride({ id: 'win', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#111111' } });
    await controller.flush({ keepalive: true });
    expect(options).toEqual([{ keepalive: true }]);
  });
});

describe('useDraftController', () => {
  it('subscribes to updates and cleans up on unmount', () => {
    const controller = create();
    const unsubscribe = vi.fn();
    const subscribe = vi.spyOn(controller, 'subscribe').mockImplementation(() => unsubscribe);
    function View() {
      const draft = useDraftController(controller);
      return h('span', null, draft.theme.overrides.length);
    }
    const host = document.createElement('div');
    act(() => render(h(View, {}), host));
    expect(host.textContent).toBe('0');
    act(() => render(null, host));
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('rerenders when the controller notifies a change', () => {
    const controller = create();
    function View() {
      const draft = useDraftController(controller);
      return h('span', null, draft.theme.overrides.length);
    }
    const host = document.createElement('div');
    act(() => render(h(View, {}), host));
    act(() => controller.upsertOverride({ id: 'win', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#111111' } }));
    expect(host.textContent).toBe('1');
  });
});

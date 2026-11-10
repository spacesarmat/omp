import type { FlowDocument, ThemeOverride } from '../../design/schema.ts';
import { parseEditorDraft, type DraftSnapshot, type EditorDraft } from '../shared/draft';
import type { EditorClient } from './client';

export interface DraftController {
  readonly draft: EditorDraft;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly lastError: string | null;
  subscribe(listener: () => void): () => void;
  update(recipe: (draft: EditorDraft) => EditorDraft | void): void;
  upsertOverride(override: ThemeOverride): void;
  removeOverride(id: string): void;
  replaceFlow(flow: FlowDocument): void;
  setView(view: Pick<EditorDraft, 'target' | 'screenId' | 'format' | 'language'>): void;
  snapshot(name: string): DraftSnapshot;
  restore(snapshotId: string): boolean;
  undo(): boolean;
  redo(): boolean;
  flush(options?: { keepalive?: boolean }): Promise<void>;
  dispose(): void;
}

export interface DraftControllerOptions {
  draft: EditorDraft;
  client: EditorClient;
  autosaveMs?: number;
}

let snapshotCounter = 0;

export function createDraftController(options: DraftControllerOptions): DraftController {
  let current = parseEditorDraft(options.draft);
  let past: string[] = [];
  let future: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let error: string | null = null;
  let writeChain = Promise.resolve();
  const listeners = new Set<() => void>();
  const autosaveMs = options.autosaveMs ?? 300;

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const schedule = () => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void flush();
    }, autosaveMs);
  };
  const update = (recipe: (draft: EditorDraft) => EditorDraft | void) => {
    if (disposed) return;
    const previous = current;
    const candidate = structuredClone(previous);
    const updated = recipe(candidate) || candidate;
    if (
      updated.baseCommit !== previous.baseCommit ||
      updated.theme.baseCommit !== previous.baseCommit ||
      updated.flow.baseCommit !== previous.baseCommit
    ) {
      throw new Error('BASE_COMMIT_IMMUTABLE');
    }
    const validated = parseEditorDraft(updated);
    if (JSON.stringify(validated.theme) === JSON.stringify(previous.theme)) validated.theme = previous.theme;
    if (JSON.stringify(validated.flow) === JSON.stringify(previous.flow)) validated.flow = previous.flow;
    past.push(JSON.stringify(previous));
    if (past.length > 50) past.shift();
    future = [];
    current = validated;
    error = null;
    notify();
    schedule();
  };
  const restoreSerialized = (serialized: string) => {
    current = parseEditorDraft(JSON.parse(serialized));
    error = null;
    notify();
    schedule();
  };
  const flush = (flushOptions: { keepalive?: boolean } = {}) => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (disposed) return writeChain;
    const snapshot = structuredClone(current);
    const write = async () => {
      try {
        await options.client.putDraft(snapshot, flushOptions);
        error = null;
      } catch (reason) {
        error = reason instanceof Error ? reason.message : String(reason);
      }
      notify();
    };
    writeChain = writeChain.then(write, write);
    return writeChain;
  };

  return {
    get draft() {
      return current;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    get lastError() {
      return error;
    },
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update,
    upsertOverride(override) {
      update((draft) => {
        const index = draft.theme.overrides.findIndex((entry) => entry.id === override.id);
        if (index >= 0) draft.theme.overrides[index] = override;
        else draft.theme.overrides.push(override);
        return draft;
      });
    },
    removeOverride(id) {
      update((draft) => {
        draft.theme.overrides = draft.theme.overrides.filter((entry) => entry.id !== id);
        return draft;
      });
    },
    replaceFlow(flow) {
      update((draft) => {
        draft.flow = flow;
        return draft;
      });
    },
    setView(view) {
      update((draft) => ({ ...draft, ...view }));
    },
    snapshot(name) {
      if (current.snapshots.length >= 10) throw new Error('SNAPSHOT_LIMIT');
      const trimmed = name.trim();
      if (!trimmed) throw new Error('SNAPSHOT_NAME_REQUIRED');
      snapshotCounter += 1;
      const snapshot: DraftSnapshot = {
        id: `snapshot-${Date.now().toString(36)}-${snapshotCounter}`,
        name: trimmed,
        createdAt: new Date().toISOString(),
        theme: structuredClone(current.theme),
        flow: structuredClone(current.flow),
      };
      update((draft) => {
        draft.snapshots.push(snapshot);
        return draft;
      });
      return snapshot;
    },
    restore(snapshotId) {
      const snapshot = current.snapshots.find((entry) => entry.id === snapshotId);
      if (!snapshot) return false;
      update((draft) => {
        draft.theme = snapshot.theme;
        draft.flow = snapshot.flow;
        return draft;
      });
      return true;
    },
    undo() {
      if (!past.length) return false;
      const previous = past.pop()!;
      future.push(JSON.stringify(current));
      restoreSerialized(previous);
      return true;
    },
    redo() {
      if (!future.length) return false;
      const next = future.pop()!;
      past.push(JSON.stringify(current));
      restoreSerialized(next);
      return true;
    },
    flush,
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      listeners.clear();
    },
  };
}

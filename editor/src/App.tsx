import { useEffect, useState } from 'preact/hooks';
import type { InteractionTrace } from '../../design/interaction.ts';
import type { DesktopDesignTarget, DesignFormat } from '../../design/schema.ts';
import { createDefaultTheme } from '../../design/defaults';
import { DESKTOP_SCREEN_SUPPORT, type DesktopRouteId } from '../../desktop/src/shell/routes';
import { createDefaultDraft, type EditorDraft } from '../shared/draft';
import { createDraftController, type DraftController } from './drafts';
import { useDraftController } from './useDraftController';
import { createEditorClient, type EditorClient } from './client';
import { createSessionId } from './preview/protocol';
import { TargetBar } from './components/TargetBar';
import { PreviewPane } from './components/PreviewPane';
import { ThemeInspector } from './components/ThemeInspector';
import { LogicEditor } from './components/LogicEditor';
import { FlowMap } from './components/FlowMap';
import { SimulationPanel } from './components/SimulationPanel';
import { ExportPanel } from './components/ExportPanel';
import { BaseReviewPanel } from './components/BaseReviewPanel';
import { SnapshotPanel } from './components/SnapshotPanel';

export interface AppProps {
  controller?: DraftController;
  draft?: EditorDraft;
  client?: EditorClient;
}

function offlineClient(initial: EditorDraft): EditorClient {
  let current = initial;
  return {
    state: async () => ({ baseCommit: initial.baseCommit, dirtyDesign: false }),
    getDraft: async () => current,
    putDraft: async (draft) => {
      current = draft;
      return current;
    },
    getDesign: async () => ({ baseCommit: current.baseCommit, theme: current.theme, flow: current.flow }),
    rebaseDraft: async () => { throw new Error('OFFLINE_REBASE_UNAVAILABLE'); },
    exportDraft: async () => {
      throw new Error('OFFLINE_EXPORT_UNAVAILABLE');
    },
  };
}

function EditorWorkspace({ controller, client }: { controller: DraftController; client?: EditorClient }) {
  const draft = useDraftController(controller);
  const workspaceClient = client || offlineClient(draft);
  const [sessionId] = useState(createSessionId);
  const [selected, setSelected] = useState('sidebar');
  const [mode, setMode] = useState<'design' | 'logic' | 'simulate'>('design');
  const [serverConnected, setServerConnected] = useState(false);
  const [previewMode, setPreviewMode] = useState<'before' | 'after'>('after');
  const [trace, setTrace] = useState<InteractionTrace[]>([]);
  const setView = (view: Partial<Pick<EditorDraft, 'target' | 'screenId' | 'format' | 'language'>>) => {
    if (view.screenId && DESKTOP_SCREEN_SUPPORT[view.screenId] === 'preview') setMode('design');
    controller.setView({
      target: view.target || draft.target,
      screenId: view.screenId || draft.screenId,
      format: view.format || draft.format,
      language: view.language || draft.language,
    });
  };
  const previewTheme = previewMode === 'before' ? createDefaultTheme(draft.baseCommit) : draft.theme;
  const canEditLogic = DESKTOP_SCREEN_SUPPORT[draft.screenId] === 'logic';

  return (
    <main class="editor-app">
      <header class="editor-header">
        <strong>OMP Design Editor</strong>
        <span>{selected}</span>
        <button type="button" data-testid="before-after" onClick={() => setPreviewMode((value) => value === 'after' ? 'before' : 'after')}>
          {previewMode === 'after' ? 'До' : 'После'}
        </button>
        <button type="button" data-action="undo" disabled={!controller.canUndo} onClick={() => controller.undo()}>Отменить</button>
        <button type="button" data-action="redo" disabled={!controller.canRedo} onClick={() => controller.redo()}>Повторить</button>
        {draft.lastError && (
          <span class="editor-save-error" role="alert">
            {draft.lastError}
            <button type="button" data-action="retry-save" onClick={() => { void controller.flush().catch(() => undefined); }}>Повторить</button>
          </span>
        )}
        <button type="button" data-testid="mode-design" disabled={mode === 'design'} onClick={() => setMode('design')}>Дизайн</button>
        <button type="button" data-testid="mode-logic" disabled={!canEditLogic || mode === 'logic'} onClick={() => setMode('logic')}>Логика</button>
        <button type="button" data-testid="mode-simulate" disabled={!canEditLogic || mode === 'simulate'} onClick={() => setMode('simulate')}>Симуляция</button>
      </header>
      <TargetBar
        target={draft.target}
        route={draft.screenId}
        format={draft.format}
        language={draft.language}
        onTarget={(target: DesktopDesignTarget) => setView({ target })}
        onRoute={(screenId: DesktopRouteId) => setView({ screenId })}
        onFormat={(format: DesignFormat) => setView({ format })}
        onLanguage={(language: 'ru' | 'en') => setView({ language })}
      />
      <section class="editor-workspace">
        <PreviewPane
          target={draft.target}
          route={draft.screenId}
          format={draft.format}
          language={draft.language}
          mode={mode}
          serverConnected={serverConnected}
          theme={previewTheme}
          flow={draft.flow}
          sessionId={sessionId}
          onSelect={setSelected}
          onNavigate={(screenId) => setView({ screenId })}
          onTrace={setTrace}
        />
        <aside class="editor-inspector">
          <BaseReviewPanel controller={controller} client={workspaceClient} />
          <SnapshotPanel controller={controller} />
          {mode === 'design' && <ThemeInspector controller={controller} target={draft.target} screenId={draft.screenId} elementId={selected} format={draft.format} />}
          {mode === 'logic' && <><LogicEditor controller={controller} screenId={draft.screenId} elementId="settings-continue" /><FlowMap flow={draft.flow} /></>}
          {mode === 'simulate' && <SimulationPanel target={draft.target} flow={draft.flow} serverConnected={serverConnected} onServerConnected={setServerConnected} />}
          <ExportPanel controller={controller} client={workspaceClient} />
          <span>{trace.length ? `Действий: ${trace.length}` : mode}</span>
        </aside>
      </section>
    </main>
  );
}

export function App(props: AppProps = {}) {
  const [createdController, setCreatedController] = useState<DraftController | null>(null);
  const controller = props.controller || createdController;
  const [apiClient, setApiClient] = useState<EditorClient | undefined>(props.client);
  const [error, setError] = useState('');
  const [ownsController] = useState(!props.controller);
  useEffect(() => {
    if (props.controller) return;
    let active = true;
    const client = props.client || (props.draft ? offlineClient(props.draft) : createEditorClient());
    setApiClient(client);
    const load = async () => {
      try {
        if (props.draft) {
          const draft = props.draft;
          if (active) setCreatedController(createDraftController({ draft, client }));
          return;
        }
        const state = await client.state();
        const saved = await client.getDraft('default');
        const committed = saved ? null : await client.getDesign();
        const draft = saved || createDefaultDraft('default', committed?.baseCommit || state.baseCommit);
        if (!saved && committed) {
          draft.theme = committed.theme;
          draft.flow = committed.flow;
        }
        if (active) setCreatedController(createDraftController({ draft, client }));
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => () => {
    if (ownsController) controller?.dispose();
  }, [controller, ownsController]);
  useEffect(() => {
    if (!controller) return;
    const flush = (event: BeforeUnloadEvent) => {
      if (controller.hasUnsavedChanges()) {
        event.preventDefault();
        event.returnValue = 'Changes are still being saved';
      }
      void controller.flush({ keepalive: true }).catch(() => undefined);
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [controller]);

  if (error) return <p role="alert">{error}</p>;
  if (!controller) return <p>Loading editor...</p>;
  return <EditorWorkspace controller={controller} client={apiClient} />;
}

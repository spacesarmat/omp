import { useEffect, useState } from 'preact/hooks';
import type { InteractionTrace } from '../../design/interaction.ts';
import type { DesignTarget, DesignFormat, DesignState } from '../../design/schema.ts';
import { createDefaultTheme } from '../../design/defaults';
import { isDesignElementAvailable } from '../../design/catalog';
import { DESKTOP_SCREEN_SUPPORT, type DesktopRouteId } from '../../desktop/src/shell/routes';
import { getDefaultElementId, getEditorPages, getEditorViewport, isDesktopTarget, isEditorRoute, isTvTarget } from '../shared/routes';
import { createDefaultDraft, type DraftSnapshot, type EditorDraft } from '../shared/draft';
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
import { EditorIcon } from './components/EditorIcon';
import { EditorToolbar } from './components/EditorToolbar';
import { LayersPanel } from './components/LayersPanel';
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
  useEffect(() => {
    try {
      sessionStorage.setItem('omp.editor.activeDraftId', draft.id);
    } catch {
      return;
    }
  }, [draft.id]);
  const workspaceClient = client || offlineClient(draft);
  const [sessionId] = useState(createSessionId);
  const [selected, setSelected] = useState('sidebar');
  const [mode, setMode] = useState<'design' | 'logic' | 'simulate'>('design');
  const [serverConnected, setServerConnected] = useState(false);
  const [previewMode, setPreviewMode] = useState<'before' | 'after'>('after');
  const [trace, setTrace] = useState<InteractionTrace[]>([]);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<'select' | 'hand'>('select');
  const [designState, setDesignState] = useState<DesignState>('default');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [comparison, setComparison] = useState<DraftSnapshot | null>(null);
  useEffect(() => {
    if (comparison && !draft.snapshots.some((snapshot) => snapshot.id === comparison.id)) setComparison(null);
  }, [draft.snapshots, comparison]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable)) return;
      if ((!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) {
        if (controller.canRedo) controller.redo();
      } else if (controller.canUndo) controller.undo();
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [controller]);
  useEffect(() => {
    if (!isDesignElementAvailable(selected, draft.screenId, draft.target)) setSelected(getDefaultElementId(draft.target));
  }, [draft.target, draft.screenId, selected]);
  const setView = (view: Partial<Pick<EditorDraft, 'target' | 'screenId' | 'format' | 'language'>>) => {
    const target = view.target || draft.target;
    const screenId = view.screenId && isEditorRoute(target, view.screenId)
      ? view.screenId
      : isEditorRoute(target, draft.screenId) ? draft.screenId : 'settings';
    if (!isDesktopTarget(target) || DESKTOP_SCREEN_SUPPORT[screenId] !== 'logic') setMode('design');
    if (target !== draft.target || screenId !== draft.screenId) {
      setSelected(getDefaultElementId(target));
      setDesignState('default');
    }
    controller.setView({
      target,
      screenId,
      format: isTvTarget(target) ? 'landscape' : view.format || draft.format,
      language: view.language || draft.language,
    });
  };
  const previewTheme = comparison?.theme || (previewMode === 'before' ? createDefaultTheme(draft.baseCommit) : draft.theme);
  const canEditLogic = isDesktopTarget(draft.target) && DESKTOP_SCREEN_SUPPORT[draft.screenId] === 'logic';
  const routeLabel = getEditorPages(draft.target).find((route) => route.id === draft.screenId)?.label || draft.screenId;
  const viewport = getEditorViewport(draft.target, draft.format);

  return (
    <main class="editor-app">
      <header class="editor-header">
        <div class="editor-brand">
          <span class="editor-brand-mark"><EditorIcon name="logo" size={20} /></span>
          <div><strong>OMP</strong><span>Design Editor</span></div>
        </div>
        <div class="editor-document-title">
          <span>{routeLabel}</span>
          <small>{draft.id} <span class="editor-save-dot" />Локальный черновик</small>
        </div>
        <EditorToolbar label="Режим редактора" class="editor-mode-toolbar">
          <button type="button" data-testid="mode-design" aria-pressed={mode === 'design'} onClick={() => setMode('design')}><EditorIcon name="design" />Дизайн</button>
          <button type="button" data-testid="mode-logic" aria-pressed={mode === 'logic'} aria-disabled={!canEditLogic} onClick={() => { if (canEditLogic) setMode('logic'); }}><EditorIcon name="logic" />Логика</button>
          <button type="button" data-testid="mode-simulate" aria-pressed={mode === 'simulate'} aria-disabled={!canEditLogic} onClick={() => { if (canEditLogic) setMode('simulate'); }}><EditorIcon name="play" />Симуляция</button>
        </EditorToolbar>
        <EditorToolbar label="Действия редактора" class="editor-header-actions">
          <button type="button" data-testid="before-after" class="editor-compare-button" onClick={() => comparison ? setComparison(null) : setPreviewMode((value) => value === 'after' ? 'before' : 'after')} title="Сравнить с исходной темой"><EditorIcon name="compare" /><span>{comparison ? 'Текущий' : previewMode === 'after' ? 'До' : 'После'}</span></button>
          <span class="editor-toolbar-separator" role="separator" aria-orientation="vertical" />
          <button type="button" data-action="undo" class="editor-icon-button" aria-label="Отменить" title="Отменить" aria-disabled={!controller.canUndo} onClick={() => { if (controller.canUndo) controller.undo(); }}><EditorIcon name="undo" /></button>
          <button type="button" data-action="redo" class="editor-icon-button" aria-label="Повторить" title="Повторить" aria-disabled={!controller.canRedo} onClick={() => { if (controller.canRedo) controller.redo(); }}><EditorIcon name="redo" /></button>
          <button type="button" data-action="snapshot" class="editor-icon-button" aria-label="История снимков" aria-expanded={historyOpen} title="История снимков" onClick={() => setHistoryOpen((value) => !value)}><EditorIcon name="snapshot" /></button>
          <span class="editor-user-badge" aria-label="Профиль Andy">A</span>
        </EditorToolbar>
      </header>
      {draft.lastError && (
        <div class="editor-save-error" role="alert">
          <span>Не удалось сохранить: {draft.lastError}</span>
          <button type="button" data-action="retry-save" onClick={() => { void controller.flush().catch(() => undefined); }}>Повторить</button>
          {draft.lastError === 'DRAFT_CONFLICT' && (
            <button type="button" data-action="save-copy" onClick={() => { void controller.saveAsNewDraft().catch(() => undefined); }}>Сохранить как новый черновик</button>
          )}
        </div>
      )}
      <div class="editor-context-bar">
        <div class="editor-breadcrumb"><span>OMP Desktop</span><EditorIcon name="chevron" size={12} /><strong>{routeLabel}</strong></div>
        <TargetBar
          target={draft.target}
          route={draft.screenId}
          format={draft.format}
          language={draft.language}
          state={designState}
          onStateChange={setDesignState}
          onTarget={(target: DesignTarget) => setView({ target })}
          onRoute={(screenId: DesktopRouteId) => setView({ screenId })}
          onFormat={(format: DesignFormat) => setView({ format })}
          onLanguage={(language: 'ru' | 'en') => setView({ language })}
        />
      </div>
      <section class="editor-workspace">
        <LayersPanel selected={selected} route={draft.screenId} target={draft.target} onSelect={setSelected} onNavigate={(screenId) => setView({ screenId })} />
        <section class="editor-canvas-area" aria-label="Холст">
          <div class="editor-canvas-caption"><span>{routeLabel}</span><small>{viewport.width} × {viewport.height}</small></div>
          <PreviewPane
            target={draft.target}
            route={draft.screenId}
            format={draft.format}
            language={draft.language}
            mode={mode}
            serverConnected={serverConnected}
            state={designState}
            theme={previewTheme}
            flow={draft.flow}
            sessionId={sessionId}
            zoom={zoom}
            tool={tool}
            onZoomChange={setZoom}
            onTool={setTool}
            onSelect={setSelected}
            onNavigate={(screenId) => setView({ screenId })}
            onTrace={setTrace}
          />
        </section>
        <aside class="editor-inspector" aria-label="Инспектор свойств">
          <div class="editor-inspector-heading"><div><strong>{mode === 'design' ? 'Дизайн' : mode === 'logic' ? 'Логика' : 'Проверка'}</strong><span>{selected}</span></div><EditorIcon name="design" /></div>
          <div class="editor-inspector-content">
            <BaseReviewPanel controller={controller} client={workspaceClient} />
            {mode === 'design' && <ThemeInspector controller={controller} target={draft.target} screenId={draft.screenId} elementId={selected} format={draft.format} state={designState} onStateChange={setDesignState} />}
            {mode === 'logic' && <><LogicEditor controller={controller} screenId={draft.screenId} elementId="settings-continue" /><FlowMap flow={draft.flow} /></>}
            {mode === 'simulate' && isDesktopTarget(draft.target) && <SimulationPanel target={draft.target} flow={draft.flow} serverConnected={serverConnected} onServerConnected={setServerConnected} />}
            {historyOpen && <SnapshotPanel controller={controller} comparison={comparison} onCompare={setComparison} />}
            <ExportPanel controller={controller} client={workspaceClient} />
          </div>
          <div class="editor-inspector-status"><span class="editor-status-dot" />{trace.length ? `Действий: ${trace.length}` : 'Все изменения сохраняются локально'}</div>
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
    if (props.controller) setCreatedController(props.controller);
  }, [props.controller]);
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
        let activeDraftId = 'default';
        try {
          const savedId = sessionStorage.getItem('omp.editor.activeDraftId');
          if (savedId && /^[a-z0-9][a-z0-9-]{0,63}$/.test(savedId)) activeDraftId = savedId;
        } catch {
          activeDraftId = 'default';
        }
        const selected = await client.getDraft(activeDraftId);
        const saved = selected || (activeDraftId === 'default' ? null : await client.getDraft('default'));
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
        void controller.flush({ keepalive: true }).catch(() => undefined);
      }
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [controller]);

  if (error) return <p role="alert">{error}</p>;
  if (!controller) return <p>Loading editor...</p>;
  return <EditorWorkspace controller={controller} client={apiClient} />;
}

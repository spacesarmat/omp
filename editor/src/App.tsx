import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { InteractionTrace } from '../../design/interaction.ts';
import type { DesignTarget, DesignFormat, DesignState, LayoutPlacement } from '../../design/schema.ts';
import { createDefaultTheme } from '../../design/defaults';
import { getLayoutPlacement } from '../../design/layout';
import type { LayoutNodeDescriptor } from '../../design/layoutDom.ts';
import { isDesignElementAvailable } from '../../design/catalog';
import { DESKTOP_SCREEN_SUPPORT, type DesktopRouteId } from '../../desktop/src/shell/routes';
import { getDefaultElementId, getEditorPages, getEditorViewport, isDesktopTarget, isEditorRoute, isTvTarget } from '../shared/routes';
import { createDefaultDraft, type DraftSnapshot, type EditorDraft } from '../shared/draft';
import { createDraftController, type DraftController } from './drafts';
import { useDraftController } from './useDraftController';
import { createEditorClient, type EditorClient } from './client';
import { createSessionId } from './preview/protocol';
import { moveNodeTransaction, placeNodeTransaction, updateContainerTransaction, updateNodeMarginTransaction, alignSelectionTransaction, updateNodesMarginTransaction, createPlacement, type LayoutRect } from './layout/transactions';
import { alignPlacements, distributePlacements, flowAlignmentFor, reduceSelection, type SelectionAlignment, type SelectionState } from './layout/selection';
import { copyNodes, duplicateNode, parseLayoutClipboard, pasteNodes, renameNode, setNodeHidden, setNodeLocked } from './layout/layerOperations';
import type { LayerRowModel } from './components/LayersPanel';
import { TargetBar } from './components/TargetBar';
import { PreviewPane } from './components/PreviewPane';
import { ThemeInspector } from './components/ThemeInspector';
import { LayoutInspector } from './components/LayoutInspector';
import { MultiSelectInspector } from './components/MultiSelectInspector';
import { LogicEditor } from './components/LogicEditor';
import { FlowMap } from './components/FlowMap';
import { SimulationPanel } from './components/SimulationPanel';
import { ExportPanel } from './components/ExportPanel';
import { EditorIcon } from './components/EditorIcon';
import { EditorToolbar } from './components/EditorToolbar';
import { LayersPanel } from './components/LayersPanel';
import { BaseReviewPanel } from './components/BaseReviewPanel';
import { SnapshotPanel } from './components/SnapshotPanel';
import { CompareWorkspace } from './components/CompareWorkspace';

export interface AppProps {
  controller?: DraftController;
  draft?: EditorDraft;
  client?: EditorClient;
}

export const LAYOUT_CLIPBOARD_KEY = 'omp.editor.layoutClipboard';

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
  const [selection, setSelection] = useState<SelectionState>({ ids: [], anchorId: null });
  const [layoutNodes, setLayoutNodes] = useState<LayoutNodeDescriptor[]>([]);
  const [layoutRects, setLayoutRects] = useState<Record<string, LayoutRect>>({});
  const [mode, setMode] = useState<'design' | 'logic' | 'simulate'>('design');
  const [serverConnected, setServerConnected] = useState(false);
  const [previewMode, setPreviewMode] = useState<'before' | 'after'>('after');
  const [trace, setTrace] = useState<InteractionTrace[]>([]);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<'select' | 'hand'>('select');
  const [designState, setDesignState] = useState<DesignState>('default');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [comparison, setComparison] = useState<DraftSnapshot | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  useEffect(() => {
    if (comparison && !draft.snapshots.some((snapshot) => snapshot.id === comparison.id)) setComparison(null);
  }, [draft.snapshots, comparison]);
  useEffect(() => {
    const liveIds = new Set(layoutNodes.map((node) => node.nodeId));
    for (const placement of draft.theme.layout?.placements ?? []) {
      if (placement.target === layoutContext.target && placement.screenId === layoutContext.screenId && placement.format === layoutContext.format) {
        liveIds.add(placement.nodeId);
      }
    }
    setSelection((prev) => reduceSelection(prev, { type: 'prune', liveIds: [...liveIds] }));
  }, [layoutNodes, draft.theme.layout]);
  const layoutContext = { target: draft.target, screenId: draft.screenId, format: draft.format };
  const handleNodesChange = (nodes: LayoutNodeDescriptor[], rects: Record<string, LayoutRect>) => {
    setLayoutNodes(nodes);
    setLayoutRects(rects);
  };
  const applySelection = (next: SelectionState) => {
    setSelection(next);
    const primary = next.anchorId ?? next.ids[next.ids.length - 1] ?? null;
    if (!primary) return;
    const node = layoutNodes.find((entry) => entry.nodeId === primary);
    if (node) setSelected(node.elementId);
  };
  // Canvas selection never lands on hidden nodes: they stay reachable through the layers panel.
  const handleSelectNode = (next: SelectionState) => {
    const ids = next.ids.filter((nodeId) => !getLayoutPlacement(draft.theme, layoutContext, nodeId)?.hidden);
    const anchorId = next.anchorId && ids.includes(next.anchorId) ? next.anchorId : (ids[ids.length - 1] ?? null);
    applySelection({ ids, anchorId });
  };
  const handlePanelSelectNode = (nodeId: string) => applySelection({ ids: [nodeId], anchorId: nodeId });
  const handleElementSelected = (elementId: string) => {
    setSelected(elementId);
    const node = layoutNodes.find((entry) => entry.nodeId === elementId)
      ?? layoutNodes.find((entry) => entry.elementId === elementId && entry.kind === 'element')
      ?? layoutNodes.find((entry) => entry.elementId === elementId);
    handleSelectNode(node ? { ids: [node.nodeId], anchorId: node.nodeId } : { ids: [], anchorId: null });
  };
  const handleMoveNode = (args: { nodeId: string; parentId: string; index: number; placement?: LayoutPlacement; siblings?: string[] }) => {
    const placement = getLayoutPlacement(draft.theme, layoutContext, args.nodeId);
    if (placement?.locked || placement?.hidden) return;
    const siblings = args.siblings ?? layoutNodes
      .filter((node) => node.parentId === args.parentId)
      .map((node) => node.nodeId);
    moveNodeTransaction(controller, { context: layoutContext, ...args, siblings });
  };
  const handlePlaceNode = (placement: LayoutPlacement) => {
    const existing = getLayoutPlacement(draft.theme, layoutContext, placement.nodeId);
    if (existing?.locked || existing?.hidden) return;
    placeNodeTransaction(controller, placement);
  };
  const handleContainerPatch = (patch: { padding?: string }) => {
    if (!selectedNode) return;
    const selectedPlacement = getLayoutPlacement(draft.theme, layoutContext, selectedNode.nodeId);
    if (selectedPlacement?.locked || selectedPlacement?.hidden) return;
    const seed = layoutNodes
      .filter((node) => node.parentId === selectedNode.nodeId)
      .map((node) => node.nodeId);
    updateContainerTransaction(controller, { context: layoutContext, nodeId: selectedNode.nodeId, seed, patch });
  };
  const handleNodeMargin = (margin: string | undefined) => {
    if (!selectedNode) return;
    const selectedPlacement = getLayoutPlacement(draft.theme, layoutContext, selectedNode.nodeId);
    if (selectedPlacement?.locked || selectedPlacement?.hidden) return;
    updateNodeMarginTransaction(controller, {
      context: layoutContext,
      nodeId: selectedNode.nodeId,
      label: selectedNode.label,
      base: getLayoutPlacement(draft.theme, layoutContext, selectedNode.nodeId),
      margin,
    });
  };
  // Locked nodes and nodes without a live preview element stay out of every group action; hidden
  // nodes join them so a hidden participant never moves through a group edit.
  const selectedItems = () => selection.ids
    .map((nodeId) => ({
      node: layoutNodes.find((entry) => entry.nodeId === nodeId),
      placement: getLayoutPlacement(draft.theme, layoutContext, nodeId),
    }))
    .filter((item) => item.node && item.node.parentId !== null && !item.placement?.locked && !item.placement?.hidden);
  // Flow children of one container are aligned through the container record, absolute nodes
  // through their coordinates; either way the whole group lands in a single draft transaction.
  const alignSelection = (alignment: SelectionAlignment, axis: 'x' | 'y' | null) => {
    const items = selectedItems();
    if (items.length < 2) return;
    const parentIds = new Set(items.map((item) => item.node!.parentId));
    const allFlow = items.every((item) => (item.placement?.mode ?? 'flow') === 'flow');
    if (allFlow && parentIds.size === 1) {
      const parentId = String([...parentIds][0]);
      const seed = layoutNodes.filter((node) => node.parentId === parentId).map((node) => node.nodeId);
      const patch = axis === null
        ? { alignment: flowAlignmentFor(alignment) }
        : { distribution: 'space-between' as const };
      alignSelectionTransaction(controller, { context: layoutContext, container: { nodeId: parentId, seed, patch } });
      return;
    }
    const bases = items
      .map((item) => item.placement)
      .filter((placement): placement is LayoutPlacement => Boolean(placement));
    if (bases.length < 2) return;
    const placements = axis === null ? alignPlacements(bases, alignment) : distributePlacements(bases, axis);
    alignSelectionTransaction(controller, { context: layoutContext, placements });
  };
  const handleAlignSelection = (alignment: SelectionAlignment) => alignSelection(alignment, null);
  const handleDistributeSelection = (axis: 'x' | 'y') => alignSelection('left', axis);
  const handleSelectionMargin = (margin: string | undefined) => {
    const items = selectedItems();
    if (!items.length) return;
    updateNodesMarginTransaction(controller, {
      context: layoutContext,
      items: items.map((item) => ({ nodeId: item.node!.nodeId, label: item.node!.label, base: item.placement, margin })),
    });
  };
  const layerPlacement = (nodeId: string) => getLayoutPlacement(draft.theme, layoutContext, nodeId);
  const layerLabel = (nodeId: string) => layerPlacement(nodeId)?.label ?? layoutNodes.find((node) => node.nodeId === nodeId)?.label ?? nodeId;
  const rootNodeId = () => layoutNodes.find((node) => node.parentId === null)?.nodeId ?? null;
  const layerParentId = (nodeId: string) => layoutNodes.find((node) => node.nodeId === nodeId)?.parentId ?? rootNodeId();
  const nodeSourceRef = useRef<(nodeId: string) => string | null>(() => null);
  const layerRows: LayerRowModel[] = [
    ...layoutNodes.map((node) => {
      const placement = layerPlacement(node.nodeId);
      return { nodeId: node.nodeId, label: placement?.label ?? node.label, hidden: placement?.hidden ?? false, locked: placement?.locked ?? false };
    }),
    ...(draft.theme.layout?.placements ?? [])
      .filter((placement) => placement.target === layoutContext.target
        && placement.screenId === layoutContext.screenId
        && placement.format === layoutContext.format
        && !layoutNodes.some((node) => node.nodeId === placement.nodeId))
      .map((placement) => ({ nodeId: placement.nodeId, label: placement.label, hidden: placement.hidden, locked: placement.locked })),
  ];
  const handleRenameNode = (nodeId: string, name: string) => {
    renameNode(controller, { context: layoutContext, nodeId, label: layerLabel(nodeId), base: layerPlacement(nodeId), name });
  };
  const handleToggleHidden = (nodeId: string, hidden: boolean) => {
    setNodeHidden(controller, { context: layoutContext, nodeId, label: layerLabel(nodeId), base: layerPlacement(nodeId) }, hidden);
  };
  const handleToggleLocked = (nodeId: string, locked: boolean) => {
    setNodeLocked(controller, { context: layoutContext, nodeId, label: layerLabel(nodeId), base: layerPlacement(nodeId) }, locked);
  };
  const handleDuplicateNode = (nodeId: string) => {
    const copyId = duplicateNode(controller, {
      context: layoutContext,
      nodeId,
      label: layerLabel(nodeId),
      base: layerPlacement(nodeId),
      parentId: layerParentId(nodeId),
      html: nodeSourceRef.current(nodeId),
    });
    handlePanelSelectNode(copyId);
  };
  const [clipboardError, setClipboardError] = useState<string | null>(null);
  const handleCopySelection = () => {
    const placements = selection.ids
      .map((nodeId) => layerPlacement(nodeId) ?? createPlacement(layoutContext, nodeId, layerLabel(nodeId)))
      .filter((placement): placement is LayoutPlacement => Boolean(placement));
    if (!placements.length) return;
    try {
      window.localStorage.setItem(LAYOUT_CLIPBOARD_KEY, JSON.stringify(copyNodes(placements, (nodeId) => nodeSourceRef.current(nodeId))));
    } catch {
      return;
    }
    setClipboardError(null);
  };
  const handlePaste = () => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(LAYOUT_CLIPBOARD_KEY);
    } catch {
      raw = null;
    }
    if (!raw) return;
    let parsed: ReturnType<typeof parseLayoutClipboard>;
    try {
      parsed = parseLayoutClipboard(JSON.parse(raw));
    } catch {
      parsed = { clipboard: null, errors: ['Clipboard повреждён'] };
    }
    if (!parsed.clipboard) {
      setClipboardError(parsed.errors[0] ?? 'Clipboard недоступен');
      return;
    }
    pasteNodes(controller, { context: layoutContext, clipboard: parsed.clipboard, parentId: rootNodeId() });
    setClipboardError(null);
  };
  const clipboardHandlersRef = useRef({ handleCopySelection, handlePaste });
  clipboardHandlersRef.current = { handleCopySelection, handlePaste };
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
    const clipboardListener = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable)) return;
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key === 'c') {
        clipboardHandlersRef.current.handleCopySelection();
      } else if (key === 'v') {
        event.preventDefault();
        clipboardHandlersRef.current.handlePaste();
      }
    };
    window.addEventListener('keydown', listener);
    window.addEventListener('keydown', clipboardListener);
    return () => {
      window.removeEventListener('keydown', listener);
      window.removeEventListener('keydown', clipboardListener);
    };
  }, [controller]);
  useEffect(() => {
    if (!isDesignElementAvailable(selected, draft.screenId, draft.target)) setSelected(getDefaultElementId(draft.target));
  }, [draft.target, draft.screenId, selected]);
  useEffect(() => {
    if (!isDesktopTarget(draft.target) || DESKTOP_SCREEN_SUPPORT[draft.screenId] !== 'logic') setMode('design');
  }, [draft.target, draft.screenId]);
  const setView = (view: Partial<Pick<EditorDraft, 'target' | 'screenId' | 'format' | 'language'>>) => {
    const target = view.target || draft.target;
    const screenId = view.screenId && isEditorRoute(target, view.screenId)
      ? view.screenId
      : isEditorRoute(target, draft.screenId) ? draft.screenId : 'settings';
    if (!isDesktopTarget(target) || DESKTOP_SCREEN_SUPPORT[screenId] !== 'logic') setMode('design');
    if (target !== draft.target || screenId !== draft.screenId) {
      setSelected(getDefaultElementId(target));
      setSelection({ ids: [], anchorId: null });
      setDesignState('default');
    }
    controller.setView({
      target,
      screenId,
      format: isTvTarget(target) ? 'landscape' : view.format || draft.format,
      language: view.language || draft.language,
    });
  };
  const previewTheme = useMemo(
    () => comparison?.theme || (previewMode === 'before' ? createDefaultTheme(draft.baseCommit) : draft.theme),
    [comparison, previewMode, draft.baseCommit, draft.theme],
  );
  const previewEditable = !comparison && previewMode === 'after';
  const canEditLogic = isDesktopTarget(draft.target) && DESKTOP_SCREEN_SUPPORT[draft.screenId] === 'logic';
  const routeLabel = getEditorPages(draft.target).find((route) => route.id === draft.screenId)?.label || draft.screenId;
  const viewport = getEditorViewport(draft.target, draft.format);
  const selectedNodeId = selection.ids.length ? (selection.anchorId ?? selection.ids[selection.ids.length - 1]) : null;
  const selectedNode = selectedNodeId ? layoutNodes.find((node) => node.nodeId === selectedNodeId) ?? null : null;
  const selectedOrder = selectedNode?.parentId
    ? draft.theme.layout?.containers.find(
      (container) => container.target === layoutContext.target
        && container.screenId === layoutContext.screenId
        && container.format === layoutContext.format
        && container.nodeId === selectedNode.parentId,
    )?.order ?? layoutNodes.filter((node) => node.parentId === selectedNode.parentId).map((node) => node.nodeId)
    : [];

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
          <button type="button" data-testid="compare-toggle" class="editor-compare-button" aria-pressed={compareOpen} onClick={() => setCompareOpen((value) => !value)} title="Сравнить платформы рядом"><EditorIcon name="frame" /><span>{compareOpen ? 'Скрыть платформы' : 'Платформы'}</span></button>
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
      {compareOpen && (
        <CompareWorkspace
          controller={controller}
          route={draft.screenId}
          state={designState}
          serverConnected={serverConnected}
          baseTheme={previewTheme}
          baseFlow={draft.flow}
          selectedNodeId={selectedNodeId}
          onSelectNode={(nodeId) => handleSelectNode({ ids: [nodeId], anchorId: nodeId })}
          onClose={() => setCompareOpen(false)}
        />
      )}
      <section class="editor-workspace">
        <LayersPanel
          selected={selected}
          route={draft.screenId}
          target={draft.target}
          layers={layerRows}
          selectedNodeId={selectedNodeId}
          clipboardError={clipboardError}
          onSelect={setSelected}
          onNavigate={(screenId) => setView({ screenId })}
          onSelectNode={handlePanelSelectNode}
          onRenameNode={handleRenameNode}
          onToggleHidden={handleToggleHidden}
          onToggleLocked={handleToggleLocked}
          onDuplicateNode={handleDuplicateNode}
          onCopySelection={handleCopySelection}
          onPaste={handlePaste}
        />
        <section class="editor-canvas-area" aria-label="Холст">
          <div class="editor-canvas-caption"><span>{routeLabel}</span><small>{viewport.width} × {viewport.height}</small>{!previewEditable && <small class="editor-canvas-readonly" data-testid="canvas-readonly">Базовая тема - редактирование выключено</small>}</div>
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
            selection={selection}
            editable={previewEditable}
            nodeSource={nodeSourceRef}
            onZoomChange={setZoom}
            onTool={setTool}
            onSelect={handleElementSelected}
            onNavigate={(screenId) => setView({ screenId })}
            onTrace={setTrace}
            onNodesChange={handleNodesChange}
            onSelectNode={handleSelectNode}
            onMoveNode={handleMoveNode}
            onPlaceNode={handlePlaceNode}
          />
        </section>
        <aside class="editor-inspector" aria-label="Инспектор свойств">
          <div class="editor-inspector-heading"><div><strong>{mode === 'design' ? 'Дизайн' : mode === 'logic' ? 'Логика' : 'Проверка'}</strong><span>{selected}</span></div><EditorIcon name="design" /></div>
          <div class="editor-inspector-content">
            <BaseReviewPanel controller={controller} client={workspaceClient} />
            {mode === 'design' && <ThemeInspector controller={controller} target={draft.target} screenId={draft.screenId} elementId={selected} format={draft.format} state={designState} onStateChange={setDesignState} />}
            {mode === 'design' && selection.ids.length > 1 && (() => {
              const margins = new Set(selectedItems().map((item) => item.placement?.margin ?? ''));
              const margin = margins.size === 0 ? undefined : margins.size === 1 ? String([...margins][0]) : 'mixed' as const;
              return (
                <MultiSelectInspector
                  context={layoutContext}
                  count={selection.ids.length}
                  margin={margin}
                  onAlign={handleAlignSelection}
                  onDistribute={handleDistributeSelection}
                  onMargin={handleSelectionMargin}
                />
              );
            })()}
            {mode === 'design' && selection.ids.length === 1 && selectedNode && (
              <LayoutInspector
                context={layoutContext}
                node={selectedNode}
                placement={getLayoutPlacement(draft.theme, layoutContext, selectedNode.nodeId)}
                rect={layoutRects[selectedNode.nodeId] ?? null}
                parentRect={selectedNode.parentId ? layoutRects[selectedNode.parentId] ?? null : null}
                order={selectedOrder}
                container={draft.theme.layout?.containers.find(
                  (container) => container.target === layoutContext.target
                    && container.screenId === layoutContext.screenId
                    && container.format === layoutContext.format
                    && container.nodeId === selectedNode.nodeId,
                )}
                onPlace={handlePlaceNode}
                onMove={handleMoveNode}
                onContainerPatch={handleContainerPatch}
                onMargin={handleNodeMargin}
              />
            )}
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

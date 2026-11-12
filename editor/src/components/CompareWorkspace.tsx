import { useEffect, useRef, useState } from 'preact/hooks';
import { DESIGN_FORMATS, DESIGN_TARGETS, type DesignFormat, type DesignState, type DesignTarget, type FlowDocument, type ThemeDocument } from '../../../design/schema.ts';
import type { DesktopRouteId } from '../../../desktop/src/shell/routes.ts';
import { EDITOR_TARGET_LABELS, getEditorViewport, isEditorRoute, isTvTarget } from '../../shared/routes.ts';
import { collectLayoutElements, type LayoutRect } from '../layout/transactions.ts';
import { layoutRootOf } from '../../../design/layoutDom.ts';
import { createSessionId, isTrustedPreviewEvent, newMessageId, parsePreviewMessage, sendPreviewCommand, type PreviewCommandInput } from '../preview/protocol.ts';
import type { DraftController } from '../drafts.ts';
import { useDraftController } from '../useDraftController.ts';

export interface CompareView {
  id: string;
  target: DesignTarget;
  format: DesignFormat;
  language: 'ru' | 'en';
}

export interface CompareSelection {
  nodeId: string | null;
  sourceViewId: string | null;
}

export interface CompareWorkspaceProps {
  controller: DraftController;
  route: DesktopRouteId;
  state: DesignState;
  serverConnected: boolean;
  baseTheme: ThemeDocument;
  baseFlow: FlowDocument;
  selectedNodeId: string | null;
  onSelectNode(nodeId: string): void;
  onClose(): void;
}

const DEFAULT_COMPARE_VIEWS: CompareView[] = [
  { id: 'desktop', target: 'desktop-windows', format: 'landscape', language: 'ru' },
  { id: 'phone', target: 'android-phone', format: 'landscape', language: 'ru' },
  { id: 'tv', target: 'android-tv', format: 'landscape', language: 'ru' },
];

// Compare frames share one column width; each platform viewport is scaled down to fit it.
const COMPARE_FRAME_WIDTH = 340;

interface CompareFrameProps {
  view: CompareView;
  route: DesktopRouteId;
  state: DesignState;
  serverConnected: boolean;
  theme: ThemeDocument;
  flow: FlowDocument;
  selectedNodeId: string | null;
  onChange(patch: Partial<Pick<CompareView, 'target' | 'format' | 'language'>>): void;
  onSelectNode(nodeId: string): void;
}

function CompareFrame(props: CompareFrameProps) {
  const { view } = props;
  const iframe = useRef<HTMLIFrameElement>(null);
  const observer = useRef<MutationObserver | null>(null);
  const loaded = useRef(false);
  const initSent = useRef(false);
  const [sessionId] = useState(createSessionId);
  const [highlight, setHighlight] = useState<LayoutRect | null>(null);
  const origin = window.location.origin;
  const route: DesktopRouteId = isEditorRoute(view.target, props.route) ? props.route : 'settings';
  const viewport = getEditorViewport(view.target, view.format);
  const fit = Math.min(1, COMPARE_FRAME_WIDTH / viewport.width);

  const send = (command: PreviewCommandInput) => {
    if (!iframe.current) return;
    sendPreviewCommand(iframe.current, { ...command, messageId: newMessageId(), sessionId }, origin);
  };
  const sendInit = () => {
    initSent.current = true;
    send({
      type: 'init',
      props: {
        target: view.target,
        route,
        format: view.format,
        language: view.language,
        mode: 'design',
        serverConnected: props.serverConnected,
        state: props.state,
        theme: props.theme,
        flow: props.flow,
      },
    });
  };
  const layoutNodeForElement = (elementId: string): string | null => {
    const doc = iframe.current?.contentDocument;
    const root = doc ? layoutRootOf(doc) : null;
    if (!root) return null;
    for (const [nodeId, element] of collectLayoutElements(root)) {
      if (element.dataset.designId === elementId) return nodeId;
    }
    return null;
  };
  const refreshHighlight = () => {
    const current = iframe.current;
    const doc = current?.contentDocument;
    const root = doc ? layoutRootOf(doc) : null;
    if (!current || !root || !props.selectedNodeId) {
      setHighlight(null);
      return;
    }
    const element = collectLayoutElements(root).get(props.selectedNodeId);
    if (!element) {
      setHighlight(null);
      return;
    }
    const box = element.getBoundingClientRect();
    const frameBox = current.getBoundingClientRect();
    setHighlight({
      x: box.left - frameBox.left,
      y: box.top - frameBox.top,
      width: box.width,
      height: box.height,
    });
  };
  const attachObserver = () => {
    observer.current?.disconnect();
    observer.current = null;
    const body = iframe.current?.contentDocument?.body;
    if (!body || typeof MutationObserver === 'undefined') return;
    observer.current = new MutationObserver(() => refreshHighlight());
    observer.current.observe(body, { childList: true, subtree: true });
  };

  useEffect(() => {
    if (loaded.current && initSent.current) sendInit();
  }, [view.target, view.format, view.language, route, props.state, props.serverConnected]);
  useEffect(() => {
    refreshHighlight();
  }, [props.selectedNodeId, view.target, view.format, view.language, route, props.state]);
  useEffect(() => () => {
    observer.current?.disconnect();
    observer.current = null;
  }, []);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (!isTrustedPreviewEvent(event, origin, iframe.current?.contentWindow || null, sessionId)) return;
      const message = parsePreviewMessage(event.data);
      if (message.type === 'ready' && !initSent.current) sendInit();
      if (message.type === 'element-selected') {
        const nodeId = layoutNodeForElement(message.elementId);
        if (nodeId) props.onSelectNode(nodeId);
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [origin, sessionId, route, props.state, props.serverConnected, view.target, props.onSelectNode]);

  return (
    <div class="editor-compare-view" data-testid={`compare-view-${view.id}`} data-view-id={view.id}>
      <div class="editor-compare-controls">
        <label>
          <span>Платформа</span>
          <select
            data-testid={`compare-target-${view.id}`}
            value={view.target}
            onChange={(event) => props.onChange({ target: event.currentTarget.value as DesignTarget })}
          >
            {DESIGN_TARGETS.map((target) => <option value={target}>{EDITOR_TARGET_LABELS[target]}</option>)}
          </select>
        </label>
        <label>
          <span>Формат</span>
          <select
            data-testid={`compare-format-${view.id}`}
            value={view.format}
            aria-disabled={isTvTarget(view.target)}
            onChange={(event) => props.onChange({ format: event.currentTarget.value as DesignFormat })}
          >
            {DESIGN_FORMATS.map((format) => <option value={format}>{format === 'portrait' ? 'Портрет' : 'Альбом'}</option>)}
          </select>
        </label>
        <label>
          <span>Язык</span>
          <select
            data-testid={`compare-language-${view.id}`}
            value={view.language}
            onChange={(event) => props.onChange({ language: event.currentTarget.value as 'ru' | 'en' })}
          >
            <option value="ru">RU</option>
            <option value="en">EN</option>
          </select>
        </label>
      </div>
      <div class="editor-compare-stage">
        <div class="editor-compare-size" style={{ width: `${viewport.width * fit}px`, height: `${viewport.height * fit}px` }}>
          <div class="editor-compare-viewport" style={{ width: `${viewport.width}px`, height: `${viewport.height}px`, transform: `scale(${fit})` }}>
            <iframe
              ref={iframe}
              src="/preview.html"
              name={sessionId}
              title={`OMP compare preview ${view.id}`}
              width={viewport.width}
              height={viewport.height}
              data-testid={`compare-frame-${view.id}`}
              data-target={view.target}
              data-format={view.format}
              data-language={view.language}
              sandbox="allow-scripts allow-same-origin"
              referrerPolicy="no-referrer"
              onLoad={() => {
                loaded.current = true;
                if (!initSent.current) sendInit();
                attachObserver();
                refreshHighlight();
              }}
            />
            {highlight && props.selectedNodeId && (
              <div
                class="editor-compare-selection"
                data-testid="compare-selection"
                data-layout-node={props.selectedNodeId}
                style={{ left: `${highlight.x}px`, top: `${highlight.y}px`, width: `${highlight.width}px`, height: `${highlight.height}px` }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CompareWorkspace(props: CompareWorkspaceProps) {
  const draft = useDraftController(props.controller);
  const [views, setViews] = useState<CompareView[]>(DEFAULT_COMPARE_VIEWS);
  // Freeze the base documents once: editing the shared draft while the workspace is open
  // must not move any compare frame.
  const [base] = useState(() => ({ theme: structuredClone(props.baseTheme), flow: structuredClone(props.baseFlow) }));
  const [selection, setSelection] = useState<CompareSelection>({ nodeId: null, sourceViewId: null });
  useEffect(() => {
    setSelection({ nodeId: props.selectedNodeId, sourceViewId: null });
  }, [props.selectedNodeId]);
  const patchView = (id: string, patch: Partial<Pick<CompareView, 'target' | 'format' | 'language'>>) => {
    setViews((current) => current.map((view) => {
      if (view.id !== id) return view;
      const target = patch.target ?? view.target;
      return { ...view, ...patch, target, format: isTvTarget(target) ? 'landscape' : (patch.format ?? view.format) };
    }));
  };
  const handleSelectNode = (viewId: string, nodeId: string) => {
    setSelection({ nodeId, sourceViewId: viewId });
    props.onSelectNode(nodeId);
  };

  return (
    <section class="editor-compare" data-testid="compare-workspace" aria-label="Сравнение платформ">
      <div class="editor-compare-heading">
        <strong>Сравнение платформ</strong>
        <small>Черновик {draft.id} - базовая тема, изменения не применяются</small>
        <button type="button" class="editor-compare-close" data-testid="compare-close" onClick={props.onClose}>Закрыть</button>
      </div>
      <div class="editor-compare-views">
        {views.map((view) => (
          <CompareFrame
            key={view.id}
            view={view}
            route={props.route}
            state={props.state}
            serverConnected={props.serverConnected}
            theme={base.theme}
            flow={base.flow}
            selectedNodeId={selection.nodeId}
            onChange={(patch) => patchView(view.id, patch)}
            onSelectNode={(nodeId) => handleSelectNode(view.id, nodeId)}
          />
        ))}
      </div>
    </section>
  );
}

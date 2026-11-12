import { useEffect, useRef, useState } from 'preact/hooks';
import type { InteractionTrace } from '../../../design/interaction.ts';
import type { LayoutContext, LayoutPlacement } from '../../../design/schema.ts';
import type { DesktopRouteId } from '../../../desktop/src/shell/routes';
import { collectLayoutNodes, layoutRootOf, snapshotCloneHtml, type LayoutNodeDescriptor } from '../../../design/layoutDom.ts';
import { collectGeometrySnapshot, focusProbeVersion, type GeometrySnapshot } from '../../../design/layout-checks.ts';
import { collectLayoutElements, type LayoutRect } from '../layout/transactions.ts';
import { createSessionId, isTrustedPreviewEvent, newMessageId, parsePreviewMessage, sendPreviewCommand, type PreviewConfiguration, type PreviewCommandInput } from '../preview/protocol';
import { CanvasControls, type CanvasTool } from './CanvasControls';
import { SelectionOverlay, type MoveNodeArgs } from './SelectionOverlay';
import { Rulers } from './Rulers';
import type { SelectionState } from '../layout/selection';
import { getEditorViewport } from '../../shared/routes';
import { DEFAULT_GUIDE_SETTINGS, type GuideSettings } from '../layout/guides';

export interface PreviewPaneProps extends PreviewConfiguration {
  sessionId: string;
  zoom: number;
  tool: CanvasTool;
  selection: SelectionState;
  editable?: boolean;
  guideSettings?: GuideSettings;
  nodeSource?: { current: ((nodeId: string) => string | null) | null };
  onZoomChange(zoom: number): void;
  onTool(tool: CanvasTool): void;
  onGuideSettingsChange?(patch: Partial<GuideSettings>): void;
  onSelect(elementId: string): void;
  onNavigate(route: DesktopRouteId): void;
  onTrace(trace: InteractionTrace[]): void;
  onNodesChange(nodes: LayoutNodeDescriptor[], rects: Record<string, LayoutRect>, directions: Record<string, 'row' | 'column'>): void;
  onGeometryChange?(snapshot: GeometrySnapshot | null): void;
  onSelectNode(state: SelectionState): void;
  onMoveNode(args: MoveNodeArgs): void;
  onPlaceNode(placement: LayoutPlacement): void;
  onPlaceNodes(placements: LayoutPlacement[]): void;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2.5;
const CANVAS_PADDING = 48;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function isEditable(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const element = target as Partial<HTMLElement>;
  return typeof element.tagName === 'string' && (['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName) || element.isContentEditable === true);
}

function forwardPreviewKey(event: KeyboardEvent): void {
  if (isEditable(event.target)) return;
  const forwarded = new KeyboardEvent('keydown', {
    key: event.key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    cancelable: true,
  });
  window.dispatchEvent(forwarded);
  if (forwarded.defaultPrevented) event.preventDefault();
}

export function PreviewPane(props: PreviewPaneProps) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const viewportElement = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  const initSent = useRef(false);
  const autoFit = useRef(true);
  const pan = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const keyTarget = useRef<Document | null>(null);
  const observer = useRef<MutationObserver | null>(null);
  const [collected, setCollected] = useState<{ nodes: LayoutNodeDescriptor[]; rects: Record<string, LayoutRect>; directions: Record<string, 'row' | 'column'> }>({ nodes: [], rects: {}, directions: {} });
  const origin = window.location.origin;
  const viewport = getEditorViewport(props.target, props.format);
  const layoutContext: LayoutContext = { target: props.target, screenId: props.route, format: props.format };
  const guideSettings = props.guideSettings ?? DEFAULT_GUIDE_SETTINGS;

  const collect = () => {
    const frame = iframe.current;
    const doc = frame?.contentDocument;
    const rootEl = doc ? layoutRootOf(doc) : null;
    if (!frame || !doc || !rootEl) return;
    const elements = collectLayoutElements(rootEl);
    const nodes = collectLayoutNodes(rootEl);
    // Rects live in iframe coordinates relative to the registered design root. The overlay
    // shares that space, so the canvas zoom and the frame position on the editor page never
    // shift or scale hit targets.
    const rootBox = rootEl.getBoundingClientRect();
    const rects: Record<string, LayoutRect> = {};
    for (const node of nodes) {
      const element = elements.get(node.nodeId);
      if (!element) continue;
      const box = element.getBoundingClientRect();
      rects[node.nodeId] = {
        x: box.left - rootBox.left,
        y: box.top - rootBox.top,
        width: box.width,
        height: box.height,
      };
    }
    // Flow axis decisions need the real rendered direction: the editor maps alignment and
    // distribution buttons to the flex main or cross axis through this computed value when the
    // container record does not pin a direction, and drag insertion picks the index axis and
    // guide orientation from it. Only true flex containers report a meaningful flex-direction;
    // anything else keeps the documented column default for insertion. Read through the
    // element's own window so a preview iframe from another realm reports its own layout.
    const directions: Record<string, 'row' | 'column'> = {};
    for (const [nodeId, element] of elements) {
      if (!element.children.length) continue;
      const view = element.ownerDocument.defaultView;
      if (!view) continue;
      try {
        const display = view.getComputedStyle(element).display;
        if (!display.includes('flex')) continue;
        const value = view.getComputedStyle(element).flexDirection;
        if (value === 'row' || value === 'column') directions[nodeId] = value;
      } catch {
        // A document without a view or layout keeps the documented fallback.
      }
    }
    setCollected({ nodes, rects, directions });
    props.onNodesChange(nodes, rects, directions);
    props.onGeometryChange?.(collectGeometrySnapshot(rootEl, {
      target: props.target,
      screenId: props.route,
      format: props.format,
      viewport,
    }));
  };
  // The observer created on iframe load outlives this render: route, format and viewport change
  // without a reload, so the callback must always reach the latest collect instead of closing
  // over the load-render props.
  const collectRef = useRef<() => void>(() => undefined);
  collectRef.current = collect;

  const send = (command: PreviewCommandInput) => {
    if (!iframe.current) return;
    sendPreviewCommand(iframe.current, { ...command, messageId: newMessageId(), sessionId: props.sessionId }, origin);
  };
  useEffect(() => {
    if (!props.nodeSource) return;
    props.nodeSource.current = (nodeId) => {
      const doc = iframe.current?.contentDocument;
      const rootEl = doc ? layoutRootOf(doc) : null;
      if (!rootEl) return null;
      const element = collectLayoutElements(rootEl).get(nodeId);
      return element ? snapshotCloneHtml(element) : null;
    };
    return () => {
      if (props.nodeSource) props.nodeSource.current = null;
    };
  }, [props.theme, props.route, props.nodeSource]);
  const sendInit = () => {
    initSent.current = true;
    send({
      type: 'init',
      props: {
        target: props.target,
        route: props.route,
        format: props.format,
        language: props.language,
        mode: props.mode,
        serverConnected: props.serverConnected,
        state: props.state,
        theme: props.theme,
        flow: props.flow,
      },
    });
  };
  const fit = () => {
    autoFit.current = true;
    const rect = viewportElement.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) {
      props.onZoomChange(1);
      return;
    }
    const next = Math.min((rect.width - CANVAS_PADDING * 2) / viewport.width, (rect.height - CANVAS_PADDING * 2) / viewport.height);
    props.onZoomChange(clampZoom(next));
  };
  const setZoom = (value: number) => {
    autoFit.current = false;
    props.onZoomChange(clampZoom(value));
  };
  const attachObserver = () => {
    observer.current?.disconnect();
    observer.current = null;
    const doc = iframe.current?.contentDocument;
    const body = doc?.body;
    if (!doc || !body || typeof MutationObserver === 'undefined') return;
    let observedProbeVersion = focusProbeVersion(doc);
    observer.current = new MutationObserver((mutations) => {
      const currentVersion = focusProbeVersion(doc);
      const probeRan = currentVersion !== observedProbeVersion;
      observedProbeVersion = currentVersion;
      // Identity stamps never change what a collection reports.
      if (mutations.every((mutation) => mutation.type === 'attributes' && mutation.attributeName === 'data-layout-node')) return;
      // A geometry collection bumped the probe version, and that very collection already
      // re-read the DOM after these mutations queued, so the batch carries nothing new. Genuine
      // changes keep collecting because no probe ran and the version stays unchanged.
      if (probeRan) return;
      collectRef.current();
    });
    observer.current.observe(body, { childList: true, subtree: true, attributes: true });
  };

  useEffect(() => {
    loaded.current = false;
    initSent.current = false;
  }, [props.target, props.language]);
  useEffect(() => () => {
    keyTarget.current?.removeEventListener('keydown', forwardPreviewKey);
    keyTarget.current = null;
  }, [props.target, props.language]);
  useEffect(() => {
    if (loaded.current) sendInit();
  }, [props.target, props.format, props.language, props.mode, props.serverConnected, props.state, props.theme, props.flow]);
  useEffect(() => {
    if (!loaded.current) return;
    collect();
  }, [props.target, props.route, props.format, props.language, props.theme, props.zoom]);
  useEffect(() => () => {
    observer.current?.disconnect();
    observer.current = null;
  }, []);
  useEffect(() => {
    if (loaded.current) send({ type: 'navigate', route: props.route });
  }, [props.route]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (!isTrustedPreviewEvent(event, origin, iframe.current?.contentWindow || null, props.sessionId)) return;
      const message = parsePreviewMessage(event.data);
      if (message.type === 'ready' && !initSent.current) sendInit();
      if (message.type === 'element-selected') props.onSelect(message.elementId);
      if (message.type === 'navigated') props.onNavigate(message.route);
      if (message.type === 'trace') props.onTrace(message.trace);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [origin, props.sessionId, props.onSelect, props.onNavigate, props.onTrace]);
  useEffect(() => {
    autoFit.current = true;
    const element = viewportElement.current;
    if (!element) return;
    if (typeof ResizeObserver === 'undefined') {
      fit();
      return;
    }
    const observer = new ResizeObserver(() => {
      if (autoFit.current) fit();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.target, props.format]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (isEditable(event.target)) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && ['+', '=', '-', '0'].includes(key)) {
        event.preventDefault();
        if (key === '0') fit();
        else setZoom(props.zoom * (key === '-' ? 0.8 : 1.25));
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (key === 'v' || key === 'h') props.onTool(key === 'v' ? 'select' : 'hand');
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [props.target, props.format, props.zoom, props.onTool]);

  return (
    <div class="editor-preview-shell">
      <CanvasControls
        zoom={props.zoom}
        tool={props.tool}
        rulers={guideSettings.showRulers}
        grid={guideSettings.showGrid}
        snap={guideSettings.snapToGuides}
        onZoomIn={() => setZoom(props.zoom * 1.25)}
        onZoomOut={() => setZoom(props.zoom / 1.25)}
        onFit={fit}
        onTool={props.onTool}
        onToggleRulers={() => props.onGuideSettingsChange?.({ showRulers: !guideSettings.showRulers })}
        onToggleGrid={() => props.onGuideSettingsChange?.({ showGrid: !guideSettings.showGrid })}
        onToggleSnap={() => props.onGuideSettingsChange?.({ snapToGuides: !guideSettings.snapToGuides })}
      />
      <div
        ref={viewportElement}
        class="editor-canvas-viewport"
        data-testid="canvas-viewport"
        data-tool={props.tool}
        tabIndex={0}
        onPointerDown={(event) => {
          if (props.tool !== 'hand' || event.button !== 0) return;
          event.preventDefault();
          pan.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!pan.current || pan.current.pointerId !== event.pointerId) return;
          event.currentTarget.scrollLeft = pan.current.left - (event.clientX - pan.current.x);
          event.currentTarget.scrollTop = pan.current.top - (event.clientY - pan.current.y);
        }}
        onPointerUp={(event) => {
          if (pan.current?.pointerId !== event.pointerId) return;
          pan.current = null;
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { pan.current = null; }}
      >
        <div class="editor-canvas-stage">
          <div class="editor-artboard-size" data-testid="artboard-size" style={{ width: `${viewport.width * props.zoom}px`, height: `${viewport.height * props.zoom}px` }}>
            {guideSettings.showRulers && <Rulers viewport={viewport} zoom={props.zoom} />}
            <div class="editor-artboard" style={{ width: `${viewport.width}px`, height: `${viewport.height}px`, transform: `scale(${props.zoom})` }}>
              <iframe
                key={`${props.target}-${props.language}`}
                ref={iframe}
                src="/preview.html"
                name={props.sessionId}
                title="OMP preview"
                width={viewport.width}
                height={viewport.height}
                data-target={props.target}
                data-route={props.route}
                data-format={props.format}
                data-language={props.language}
                data-state={props.state}
                data-viewport={`${viewport.width}x${viewport.height}`}
                sandbox="allow-scripts allow-same-origin"
                referrerPolicy="no-referrer"
                onLoad={() => {
                  loaded.current = true;
                  keyTarget.current?.removeEventListener('keydown', forwardPreviewKey);
                  keyTarget.current = iframe.current?.contentDocument || null;
                  keyTarget.current?.addEventListener('keydown', forwardPreviewKey);
                  attachObserver();
                  collect();
                }}
              />
              <SelectionOverlay
                active={props.editable !== false && props.mode === 'design' && props.tool === 'select'}
                viewport={viewport}
                zoom={props.zoom}
                context={layoutContext}
                nodes={collected.nodes}
                rects={collected.rects}
                directions={collected.directions}
                guideSettings={guideSettings}
                containers={(props.theme.layout?.containers ?? []).filter(
                  (container) => container.target === layoutContext.target
                    && container.screenId === layoutContext.screenId
                    && container.format === layoutContext.format,
                )}
                placements={(props.theme.layout?.placements ?? []).filter(
                  (placement) => placement.target === layoutContext.target
                    && placement.screenId === layoutContext.screenId
                    && placement.format === layoutContext.format,
                )}
                selectedIds={props.selection.ids}
                anchorId={props.selection.anchorId}
                getIframeRect={() => {
                  const box = iframe.current?.getBoundingClientRect();
                  return { x: box?.x ?? 0, y: box?.y ?? 0, width: box?.width ?? 0, height: box?.height ?? 0 };
                }}
                getPreviewDocument={() => iframe.current?.contentDocument ?? null}
                onSelect={props.onSelectNode}
                onMoveNode={props.onMoveNode}
                onPlaceNode={props.onPlaceNode}
                onPlaceNodes={props.onPlaceNodes}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

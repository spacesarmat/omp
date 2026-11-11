import { useEffect, useRef } from 'preact/hooks';
import type { InteractionTrace } from '../../../design/interaction.ts';
import type { DesktopRouteId } from '../../../desktop/src/shell/routes';
import { createSessionId, isTrustedPreviewEvent, newMessageId, parsePreviewMessage, sendPreviewCommand, type PreviewConfiguration, type PreviewCommandInput } from '../preview/protocol';
import { CanvasControls, type CanvasTool } from './CanvasControls';
import { getEditorViewport } from '../../shared/routes';

export interface PreviewPaneProps extends PreviewConfiguration {
  sessionId: string;
  zoom: number;
  tool: CanvasTool;
  onZoomChange(zoom: number): void;
  onTool(tool: CanvasTool): void;
  onSelect(elementId: string): void;
  onNavigate(route: DesktopRouteId): void;
  onTrace(trace: InteractionTrace[]): void;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2.5;
const CANVAS_PADDING = 48;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable);
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
  const origin = window.location.origin;
  const viewport = getEditorViewport(props.target, props.format);

  const send = (command: PreviewCommandInput) => {
    if (!iframe.current) return;
    sendPreviewCommand(iframe.current, { ...command, messageId: newMessageId(), sessionId: props.sessionId }, origin);
  };
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
  }, [props.format]);
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
  }, [props.zoom, props.onTool]);

  return (
    <div class="editor-preview-shell">
      <CanvasControls
        zoom={props.zoom}
        tool={props.tool}
        onZoomIn={() => setZoom(props.zoom * 1.25)}
        onZoomOut={() => setZoom(props.zoom / 1.25)}
        onFit={fit}
        onTool={props.onTool}
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
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { DesignTarget, DesignFormat, DesignState, FlowDocument, ThemeDocument } from '../../../design/schema.ts';
import { beginFlowSession, executeFlow, resetFlowSession, type FlowDispatcher } from '../../../design/flow-graph.ts';
import { createProductionDispatcher } from '../../../design/production-flow.ts';
import { toInteractionTraces, type InteractionTrace } from '../../../design/interaction.ts';
import { generateThemeCss } from '../../../design/theme.ts';
import { DesktopShell } from '../shell/DesktopShell';
import { isDesktopRouteId, type DesktopRouteId } from '../shell/routes';
import { installPreviewFixture } from './fixtures';
import { observeDesignElements } from './designElements';
import { PreviewRoute } from './previewRoutes';

export interface DesktopPreviewProps {
  target: DesignTarget;
  route: DesktopRouteId;
  format: DesignFormat;
  language: 'ru' | 'en';
  mode: 'design' | 'logic' | 'simulate';
  serverConnected: boolean;
  state: DesignState;
  theme: ThemeDocument;
  flow: FlowDocument;
  onSelect(elementId: string): void;
  onNavigate(route: DesktopRouteId): void;
  onTrace(trace: InteractionTrace[]): void;
}

export function DesktopPreview(props: DesktopPreviewProps) {
  const [toast, setToast] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const history = useRef<DesktopRouteId[]>([props.route]);
  useEffect(() => installPreviewFixture({ serverConnected: props.serverConnected, language: props.language }), [props.serverConnected, props.language]);
  const layoutContext = { target: props.target, screenId: props.route, format: props.format, state: props.state };
  useEffect(() => root.current ? observeDesignElements(root.current, props.theme, layoutContext) : undefined, [props.theme, props.route, props.target, props.format, props.state]);
  useEffect(() => {
    if (history.current[history.current.length - 1] !== props.route) history.current.push(props.route);
  }, [props.route]);

  const navigate = (route: DesktopRouteId) => {
    history.current.push(route);
    props.onNavigate(route);
  };
  const onClick = (event: MouseEvent) => {
    const origin = event.target instanceof Element ? event.target : null;
    const element = origin?.closest<HTMLElement>('[data-design-id]');
    if (!element || !(event.currentTarget as HTMLElement).contains(element)) return;
    const elementId = element.dataset.designId;
    if (!elementId) return;
    if (props.mode !== 'simulate') {
      event.preventDefault();
      event.stopPropagation();
      props.onSelect(elementId);
      return;
    }
    // The preview runs the shared interpreter, exactly like the debugger and production:
    // legacy rules keep their precedence and graph rules walk their nodes. One click is one
    // session (begin, execute, reset), so variables never leak between preview clicks, and
    // the dispatcher is a mock typed adapter: navigation, back and toast drive the preview
    // state while every unsupported action reports a synchronous outcome instead of calling
    // a real app API.
    const dispatcher: FlowDispatcher = createProductionDispatcher({
      navigate: (screenId) => {
        if (!isDesktopRouteId(screenId)) return { ok: false, error: `UNKNOWN_ROUTE: ${screenId}` };
        navigate(screenId);
        return { ok: true };
      },
      back: () => {
        if (history.current.length > 1) {
          history.current.pop();
          props.onNavigate(history.current[history.current.length - 1]);
        }
        return { ok: true };
      },
      toast: (message) => {
        setToast(message);
        return { ok: true };
      },
    });
    beginFlowSession({
      target: props.target,
      screenId: props.route,
      serverConnected: props.serverConnected,
      networkOnline: true,
      accountSignedIn: false,
      playbackState: 'idle',
      downloadState: 'idle',
    });
    let trace: InteractionTrace[];
    try {
      const result = executeFlow(props.flow, { type: 'click', screenId: props.route, elementId }, dispatcher);
      trace = toInteractionTraces(props.flow, result.trace);
    } finally {
      resetFlowSession();
    }
    props.onTrace(trace);
  };

  return (
    <div ref={root} data-design-root onClick={onClick}>
      <style>{generateThemeCss(props.theme, props.target, props.state)}</style>
      <DesktopShell key={props.language} {...props}>
        <PreviewRoute {...props} />
      </DesktopShell>
      {toast && <div class="desktop-toast" role="status">{toast}</div>}
    </div>
  );
}

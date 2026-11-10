import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { DesktopDesignTarget, DesignFormat, FlowDocument, ThemeDocument } from '../../../design/schema.ts';
import { dispatchInteraction, type InteractionTrace } from '../../../design/interaction.ts';
import { generateThemeCss } from '../../../design/theme.ts';
import { DesktopShell } from '../shell/DesktopShell';
import { isDesktopRouteId, type DesktopRouteId } from '../shell/routes';
import { installPreviewFixture } from './fixtures';
import { PreviewRoute } from './previewRoutes';

export interface DesktopPreviewProps {
  target: DesktopDesignTarget;
  route: DesktopRouteId;
  format: DesignFormat;
  language: 'ru' | 'en';
  mode: 'design' | 'logic' | 'simulate';
  serverConnected: boolean;
  theme: ThemeDocument;
  flow: FlowDocument;
  onSelect(elementId: string): void;
  onNavigate(route: DesktopRouteId): void;
  onTrace(trace: InteractionTrace[]): void;
}

export function DesktopPreview(props: DesktopPreviewProps) {
  const [toast, setToast] = useState('');
  const history = useRef<DesktopRouteId[]>([props.route]);
  useEffect(() => installPreviewFixture({ serverConnected: props.serverConnected, language: props.language }), [props.serverConnected, props.language]);
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
    const trace = dispatchInteraction(
      props.flow,
      { screenId: props.route, elementId, type: 'click' },
      { target: props.target, screenId: props.route, serverConnected: props.serverConnected },
      {
        navigate: (screenId) => {
          if (isDesktopRouteId(screenId)) navigate(screenId);
        },
        back: () => {
          if (history.current.length > 1) {
            history.current.pop();
            props.onNavigate(history.current[history.current.length - 1]);
          }
        },
        toast: setToast,
      },
    );
    props.onTrace(trace);
  };

  return (
    <div onClick={onClick}>
      <style>{generateThemeCss(props.theme, props.target)}</style>
      <DesktopShell key={props.language} {...props}>
        <PreviewRoute {...props} />
      </DesktopShell>
      {toast && <div class="desktop-toast" role="status">{toast}</div>}
    </div>
  );
}

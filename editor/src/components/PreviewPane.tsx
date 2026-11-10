import { useEffect, useRef } from 'preact/hooks';
import type { InteractionTrace } from '../../../design/interaction.ts';
import type { DesktopRouteId } from '../../../desktop/src/shell/routes';
import { createSessionId, isTrustedPreviewEvent, newMessageId, parsePreviewMessage, sendPreviewCommand, type PreviewConfiguration, type PreviewCommandInput } from '../preview/protocol';

export interface PreviewPaneProps extends PreviewConfiguration {
  sessionId: string;
  onSelect(elementId: string): void;
  onNavigate(route: DesktopRouteId): void;
  onTrace(trace: InteractionTrace[]): void;
}

export function PreviewPane(props: PreviewPaneProps) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const loaded = useRef(false);
  const origin = window.location.origin;
  const viewport = props.format === 'portrait' ? { width: 720, height: 960 } : { width: 1280, height: 720 };

  const send = (command: PreviewCommandInput) => {
    if (!iframe.current) return;
    sendPreviewCommand(iframe.current, { ...command, messageId: newMessageId(), sessionId: props.sessionId }, origin);
  };
  const sendInit = () => send({
    type: 'init',
    props: {
      target: props.target,
      route: props.route,
      format: props.format,
      language: props.language,
      mode: props.mode,
      serverConnected: props.serverConnected,
      theme: props.theme,
      flow: props.flow,
    },
  });

  useEffect(() => {
    loaded.current = false;
  }, [props.language]);
  useEffect(() => {
    if (loaded.current) sendInit();
  }, [props.target, props.format, props.language, props.mode, props.serverConnected, props.theme, props.flow]);
  useEffect(() => {
    if (loaded.current) send({ type: 'navigate', route: props.route });
  }, [props.route]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (!isTrustedPreviewEvent(event, origin, iframe.current?.contentWindow || null, props.sessionId)) return;
      const message = parsePreviewMessage(event.data);
      if (message.type === 'element-selected') props.onSelect(message.elementId);
      if (message.type === 'navigated') props.onNavigate(message.route);
      if (message.type === 'trace') props.onTrace(message.trace);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [origin, props.sessionId, props.onSelect, props.onNavigate, props.onTrace]);

  return (
    <div class="editor-preview-frame" data-format={props.format}>
      <iframe
        key={props.language}
        ref={iframe}
        src="/preview.html"
        title="OMP preview"
        width={viewport.width}
        height={viewport.height}
        data-target={props.target}
        data-route={props.route}
        data-format={props.format}
        data-language={props.language}
        data-viewport={`${viewport.width}x${viewport.height}`}
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        onLoad={() => {
          loaded.current = true;
          sendInit();
        }}
      />
    </div>
  );
}

import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import { DesktopPreview } from '../../../desktop/src/preview/DesktopPreview';
import { createDefaultFlow, createDefaultTheme } from '../../../design/defaults';
import { parseFlowDocument, parseThemeDocument } from '../../../design/validation';
import type { InteractionTrace } from '../../../design/interaction.ts';
import type { DesktopRouteId } from '../../../desktop/src/shell/routes';
import { isEditorRoute, isTvTarget } from '../../shared/routes';
import { newMessageId, type PreviewCommand, type PreviewConfiguration, type PreviewMessageInput } from './protocol';

const PhonePreview = lazy(() => import('../../../desktop/src/preview/PhonePreview').then((module) => ({ default: module.PhonePreview })));
const TvPreview = lazy(() => import('../../../desktop/src/preview/TvPreview').then((module) => ({ default: module.TvPreview })));
const BASE = '0000000000000000000000000000000000000000';

function PreviewRoot() {
  const [sessionId, setSessionId] = useState(() => window.name || 'pending');
  const [config, setConfig] = useState<PreviewConfiguration>({
    target: 'desktop-windows',
    route: 'settings',
    format: 'landscape',
    language: 'ru',
    mode: 'design',
    serverConnected: false,
    state: 'default',
    theme: createDefaultTheme(BASE),
    flow: createDefaultFlow(BASE),
  });

  const post = (message: PreviewMessageInput) => {
    window.parent.postMessage({ ...message, messageId: newMessageId(), sessionId }, window.location.origin);
  };
  const navigate = (route: DesktopRouteId) => {
    setConfig((current) => ({ ...current, route }));
    post({ type: 'navigated', route });
  };

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const command = event.data as PreviewCommand;
      if (!command || typeof command.sessionId !== 'string') return;
      setSessionId(command.sessionId);
      if (command.type === 'init') {
        setConfig({
          ...command.props,
          theme: parseThemeDocument(command.props.theme),
          flow: parseFlowDocument(command.props.flow),
        });
        window.parent.postMessage({ type: 'ready', messageId: newMessageId(), sessionId: command.sessionId }, window.location.origin);
      } else if (command.type === 'navigate' && isEditorRoute(config.target, command.route)) {
        navigate(command.route);
      } else if (command.type === 'simulate') {
        document.querySelector(`[data-design-id="${command.elementId}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [sessionId, config.target]);
  useEffect(() => {
    post({ type: 'ready' });
  }, []);

  const selected = (elementId: string) => post({ type: 'element-selected', elementId });
  const traced = (trace: InteractionTrace[]) => post({ type: 'trace', trace });
  const preview = config.target === 'android-phone'
    ? <PhonePreview {...config} onSelect={selected} onNavigate={navigate} onTrace={traced} />
    : isTvTarget(config.target)
      ? <TvPreview {...config} onSelect={selected} onNavigate={navigate} onTrace={traced} />
      : <DesktopPreview {...config} onSelect={selected} onNavigate={navigate} onTrace={traced} />;
  return <Suspense fallback={null}>{preview}</Suspense>;
}

render(h(PreviewRoot, {}), document.getElementById('app')!);

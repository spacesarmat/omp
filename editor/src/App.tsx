import { useState } from 'preact/hooks';
import type { InteractionTrace } from '../../design/interaction.ts';
import type { DesktopDesignTarget, DesignFormat } from '../../design/schema.ts';
import { createDefaultFlow, createDefaultTheme } from '../../design/defaults';
import type { DesktopRouteId } from '../../desktop/src/shell/routes';
import { createSessionId } from './preview/protocol';
import { TargetBar } from './components/TargetBar';
import { PreviewPane } from './components/PreviewPane';

const BASE = '0000000000000000000000000000000000000000';

export function App() {
  const [sessionId] = useState(createSessionId);
  const [target, setTarget] = useState<DesktopDesignTarget>('desktop-windows');
  const [route, setRoute] = useState<DesktopRouteId>('settings');
  const [format, setFormat] = useState<DesignFormat>('landscape');
  const [language, setLanguage] = useState<'ru' | 'en'>('ru');
  const [mode] = useState<'design' | 'logic' | 'simulate'>('design');
  const [serverConnected] = useState(false);
  const [theme] = useState(() => createDefaultTheme(BASE));
  const [flow] = useState(() => createDefaultFlow(BASE));
  const [selected, setSelected] = useState('');
  const [trace, setTrace] = useState<InteractionTrace[]>([]);

  return (
    <main class="editor-app">
      <header class="editor-header">
        <strong>OMP Design Editor</strong>
        <span>{selected || 'Выберите элемент'}</span>
      </header>
      <TargetBar target={target} route={route} format={format} language={language} onTarget={setTarget} onRoute={setRoute} onFormat={setFormat} onLanguage={setLanguage} />
      <section class="editor-workspace">
        <PreviewPane
          target={target}
          route={route}
          format={format}
          language={language}
          mode={mode}
          serverConnected={serverConnected}
          theme={theme}
          flow={flow}
          sessionId={sessionId}
          onSelect={setSelected}
          onNavigate={setRoute}
          onTrace={setTrace}
        />
        <aside class="editor-inspector">
          <h2>Свойства</h2>
          <p>{selected || 'Элемент не выбран'}</p>
          <span>{trace.length ? `Действий: ${trace.length}` : 'Дизайн'}</span>
        </aside>
      </section>
    </main>
  );
}

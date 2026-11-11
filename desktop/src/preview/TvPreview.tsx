import { useEffect, useRef } from 'preact/hooks';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { generateThemeCss } from '../../../design/theme.ts';
import type { DesktopPreviewProps } from './DesktopPreview';
import { installPreviewFixture } from './fixtures';
import { designOverrideAttrs } from '../shell/designScope';
import { observeDesignElements } from './designElements';
import { setPreviewPlatformKind } from '../../../src/platform/env';
import { activeServer } from '../../../src/store/servers';
import { setCatalogProvider } from '../../../src/catalog/activeCatalog';
import { tvCatalog } from '../../../src/catalog/tvCatalog';
import { LibraryScreen } from '../../../src/screens/Library';
import { AddScreen } from '../../../src/screens/Add';
import { SettingsScreen } from '../../../src/screens/Settings';
import { ConnectScreen } from '../../../src/screens/Connect';
import '../../../src/styles.css';

let spatialReady = false;
if (!spatialReady) {
  init({ debug: false, visualDebug: false });
  spatialReady = true;
}

export function TvPreview(props: DesktopPreviewProps) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => installPreviewFixture({ serverConnected: props.serverConnected, language: props.language }), [props.serverConnected, props.language]);
  useEffect(() => setPreviewPlatformKind(props.target === 'android-tv' ? 'androidtv' : 'webos'), [props.target]);
  useEffect(() => {
    setCatalogProvider((fresh) => tvCatalog(fresh));
    return () => setCatalogProvider(null);
  }, []);
  useEffect(() => {
    if (props.route === 'library' && !activeServer.value) props.onNavigate('connect');
  }, [props.route, props.serverConnected]);
  const context = { target: props.target, screenId: props.route, format: props.format, state: props.state };
  useEffect(() => root.current ? observeDesignElements(root.current, props.theme, context) : undefined, [props.theme, props.route, props.target, props.format, props.state]);
  const onClick = (event: MouseEvent) => {
    const origin = event.target instanceof Element ? event.target : null;
    const element = origin?.closest<HTMLElement>('[data-design-id]');
    if (!element || !(event.currentTarget as HTMLElement).contains(element)) return;
    const elementId = element.dataset.designId;
    if (!elementId) return;
    event.preventDefault();
    event.stopPropagation();
    props.onSelect(elementId);
  };
  return (
    <div
      ref={root}
      class="tv-preview app"
      data-design-root
      data-design-target={props.target}
      data-design-screen={props.route}
      data-design-format={props.format}
      data-design-state={props.state}
      data-design-id="legacy-page"
      data-design-component="legacy-page"
      {...designOverrideAttrs(props.theme, { ...context, componentId: 'legacy-page', elementId: 'legacy-page' })}
      onClick={onClick}
    >
      <style>{generateThemeCss(props.theme, props.target)}</style>
      <style>{`.tv-preview{--bg:var(--omp-color-background);--panel:var(--omp-color-panel);--panel2:color-mix(in srgb,var(--omp-color-panel) 92%,var(--omp-color-text));--accent:var(--omp-color-accent);--text:var(--omp-color-text);--muted:var(--omp-color-muted);--danger:var(--omp-color-danger);background:var(--omp-color-background);color:var(--omp-color-text)}.tv-preview .button{border-radius:var(--omp-size-radius);padding-left:var(--omp-size-space);padding-right:var(--omp-size-space)}.tv-preview .text-input{border-radius:var(--omp-size-radius);font-size:var(--omp-size-font)}.tv-preview .m-card{background:var(--omp-color-panel);border-radius:var(--omp-size-radius);padding:var(--omp-size-space)}.tv-preview .choice-row{background:var(--omp-color-panel);border-radius:var(--omp-size-radius);font-size:var(--omp-size-font)}.tv-preview .list-item{background:var(--omp-color-panel);border-radius:var(--omp-size-radius);padding:var(--omp-size-space)}`}</style>
      <div class="screen-host">
        {props.route === 'library' ? <LibraryScreen /> : props.route === 'search' ? <AddScreen /> : props.route === 'settings' ? <SettingsScreen /> : <ConnectScreen />}
      </div>
    </div>
  );
}

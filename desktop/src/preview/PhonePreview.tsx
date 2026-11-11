import { useEffect, useRef } from 'preact/hooks';
import { generateThemeCss } from '../../../design/theme.ts';
import type { DesktopPreviewProps } from './DesktopPreview';
import { installPreviewFixture } from './fixtures';
import { designOverrideAttrs } from '../shell/designScope';
import { observeDesignElements } from './designElements';
import { Library } from '../../../mobile/src/screens/Library';
import { News } from '../../../mobile/src/screens/News';
import { Add } from '../../../mobile/src/screens/Add';
import { Remote } from '../../../mobile/src/screens/Remote';
import { Settings } from '../../../mobile/src/screens/Settings';
import { Connect } from '../../../mobile/src/screens/Connect';
import '../../../mobile/src/catalog/phoneCatalog';
import '../../../mobile/src/mobile.css';

export function PhonePreview(props: DesktopPreviewProps) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => installPreviewFixture({ serverConnected: props.serverConnected, language: props.language }), [props.serverConnected, props.language]);
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
      class="phone-preview"
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
      <style>{`.phone-preview{--bg:var(--omp-color-background);--panel:var(--omp-color-panel);--panel-2:color-mix(in srgb,var(--omp-color-panel) 92%,var(--omp-color-text));--accent:var(--omp-color-accent);--text:var(--omp-color-text);--muted:var(--omp-color-muted);background:var(--omp-color-background);color:var(--omp-color-text);font-size:var(--omp-size-font);--m-btn-h:calc(var(--omp-size-space) * 3.25);min-height:100vh}.phone-preview button,.phone-preview .button{border-radius:var(--omp-size-radius);padding-left:var(--omp-size-space);padding-right:var(--omp-size-space)}.phone-preview input,.phone-preview .text-input{border-radius:var(--omp-size-radius);font-size:var(--omp-size-font)}.phone-preview .m-card{background:var(--omp-color-panel);border-radius:var(--omp-size-radius);padding:var(--omp-size-space)}.phone-preview .choice-row,.phone-preview .m-set-row{background:var(--omp-color-panel);border-radius:var(--omp-size-radius);font-size:var(--omp-size-font)}.phone-preview .list-item{background:var(--omp-color-panel);border-radius:var(--omp-size-radius);padding:var(--omp-size-space)}`}</style>
      {props.route === 'library' ? <Library /> : props.route === 'news' ? <News /> : props.route === 'search' ? <Add /> : props.route === 'remote' ? <Remote /> : props.route === 'settings' ? <Settings /> : <Connect />}
    </div>
  );
}

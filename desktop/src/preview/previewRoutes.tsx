import { h } from 'preact';
import type { ComponentChildren } from 'preact';
import type { DesignTarget, DesignFormat, DesignState, ThemeDocument } from '../../../design/schema.ts';
import { Library } from '../../../mobile/src/screens/Library';
import { News } from '../../../mobile/src/screens/News';
import { Add } from '../../../mobile/src/screens/Add';
import { Remote } from '../../../mobile/src/screens/Remote';
import { Connect } from '../../../mobile/src/screens/Connect';
import { DesktopSettingsScreen } from '../shell/DesktopSettingsScreen';
import { designOverrideAttrs } from '../shell/designScope';
import type { DesktopRouteId } from '../shell/routes';
import '../../../mobile/src/catalog/phoneCatalog';
import '../../../mobile/src/mobile.css';

export interface PreviewRouteProps {
  route: DesktopRouteId;
  target: DesignTarget;
  format: DesignFormat;
  state: DesignState;
  language: 'ru' | 'en';
  theme: ThemeDocument;
}

function LegacyPage(props: PreviewRouteProps & { children: ComponentChildren }) {
  const context = { target: props.target, screenId: props.route, format: props.format, state: props.state };
  return (
    <div
      class="desktop-legacy"
      data-design-id="legacy-page"
      data-design-component="legacy-page"
      {...designOverrideAttrs(props.theme, { ...context, componentId: 'legacy-page', elementId: 'legacy-page' })}
    >
      {props.children}
    </div>
  );
}

export function PreviewRoute(props: PreviewRouteProps) {
  if (props.route === 'settings') return <DesktopSettingsScreen {...props} />;
  if (props.route === 'library') return <LegacyPage {...props}><Library /></LegacyPage>;
  if (props.route === 'news') return <LegacyPage {...props}><News /></LegacyPage>;
  if (props.route === 'search') return <LegacyPage {...props}><Add /></LegacyPage>;
  if (props.route === 'remote') return <LegacyPage {...props}><Remote /></LegacyPage>;
  return <LegacyPage {...props}><Connect /></LegacyPage>;
}

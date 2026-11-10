import { h } from 'preact';
import type { DesktopDesignTarget, DesignFormat, ThemeDocument } from '../../../design/schema.ts';
import { Library } from '../../../mobile/src/screens/Library';
import { News } from '../../../mobile/src/screens/News';
import { Add } from '../../../mobile/src/screens/Add';
import { Remote } from '../../../mobile/src/screens/Remote';
import { Connect } from '../../../mobile/src/screens/Connect';
import { DesktopSettingsScreen } from '../shell/DesktopSettingsScreen';
import type { DesktopRouteId } from '../shell/routes';
import '../../../mobile/src/catalog/phoneCatalog';
import '../../../mobile/src/mobile.css';

export interface PreviewRouteProps {
  route: DesktopRouteId;
  target: DesktopDesignTarget;
  format: DesignFormat;
  language: 'ru' | 'en';
  theme: ThemeDocument;
}

export function PreviewRoute(props: PreviewRouteProps) {
  if (props.route === 'settings') return <DesktopSettingsScreen {...props} />;
  if (props.route === 'library') return <div class="desktop-legacy"><Library /></div>;
  if (props.route === 'news') return <div class="desktop-legacy"><News /></div>;
  if (props.route === 'search') return <div class="desktop-legacy"><Add /></div>;
  if (props.route === 'remote') return <div class="desktop-legacy"><Remote /></div>;
  return <div class="desktop-legacy"><Connect /></div>;
}

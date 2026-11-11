import type { DesignTarget, DesignFormat, DesignState, ThemeDocument } from '../../../design/schema.ts';
import { activeServer } from '../../../src/store/servers';
import { designOverrideAttrs } from './designScope';

export interface DesktopSettingsScreenProps {
  target: DesignTarget;
  format: DesignFormat;
  state: DesignState;
  language: 'ru' | 'en';
  theme: ThemeDocument;
}

export function DesktopSettingsScreen({ target, format, state, language, theme }: DesktopSettingsScreenProps) {
  const server = activeServer.value;
  const context = { target, screenId: 'settings', format, state };
  return (
    <section class="desktop-settings" data-route="settings">
      <h1>{language === 'ru' ? 'Настройки' : 'Settings'}</h1>
      <div
        class="desktop-server-card"
        data-design-id="server-card"
        data-design-component="card"
        {...designOverrideAttrs(theme, { ...context, componentId: 'card', elementId: 'server-card' })}
      >
        <strong>{language === 'ru' ? 'TorrServer' : 'TorrServer'}</strong>
        <span>{server ? server.name : language === 'ru' ? 'Сервер не подключён' : 'No server connected'}</span>
      </div>
      <button
        type="button"
        class="desktop-primary"
        data-design-id="settings-continue"
        data-design-component="button"
        {...designOverrideAttrs(theme, { ...context, componentId: 'button', elementId: 'settings-continue' })}
      >
        {language === 'ru' ? 'Продолжить' : 'Continue'}
      </button>
    </section>
  );
}

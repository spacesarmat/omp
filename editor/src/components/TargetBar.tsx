import type { DesktopDesignTarget, DesignFormat } from '../../../design/schema.ts';
import { DESKTOP_ROUTES, type DesktopRouteId } from '../../../desktop/src/shell/routes';

export interface TargetBarProps {
  target: DesktopDesignTarget;
  route: DesktopRouteId;
  format: DesignFormat;
  language: 'ru' | 'en';
  onTarget(value: DesktopDesignTarget): void;
  onRoute(value: DesktopRouteId): void;
  onFormat(value: DesignFormat): void;
  onLanguage(value: 'ru' | 'en'): void;
}

export function TargetBar(props: TargetBarProps) {
  return (
    <div class="editor-target-bar">
      <label>Платформа
        <select data-testid="target" value={props.target} onChange={(event) => props.onTarget(event.currentTarget.value as DesktopDesignTarget)}>
          <option value="desktop-windows">Windows</option>
          <option value="desktop-macos">macOS</option>
          <option value="desktop-linux">Linux</option>
        </select>
      </label>
      <label>Экран
        <select data-testid="route" value={props.route} onChange={(event) => props.onRoute(event.currentTarget.value as DesktopRouteId)}>
          {DESKTOP_ROUTES.filter((route) => route.menu).map((route) => <option value={route.id}>{route.label}</option>)}
        </select>
      </label>
      <label>Формат
        <select data-testid="format" value={props.format} onChange={(event) => props.onFormat(event.currentTarget.value as DesignFormat)}>
          <option value="landscape">Landscape</option>
          <option value="portrait">Portrait</option>
        </select>
      </label>
      <label>Язык
        <select data-testid="language" value={props.language} onChange={(event) => props.onLanguage(event.currentTarget.value as 'ru' | 'en')}>
          <option value="ru">RU</option>
          <option value="en">EN</option>
        </select>
      </label>
    </div>
  );
}

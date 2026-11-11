import type { DesignFormat, DesignState, DesignTarget } from '../../../design/schema.ts';
import type { DesktopRouteId } from '../../../desktop/src/shell/routes';
import { DESIGN_TARGETS, EDITOR_TARGET_LABELS, getEditorPages, isTvTarget } from '../../shared/routes';

export interface TargetBarProps {
  target: DesignTarget;
  route: DesktopRouteId;
  format: DesignFormat;
  language: 'ru' | 'en';
  state: DesignState;
  onTarget(value: DesignTarget): void;
  onRoute(value: DesktopRouteId): void;
  onFormat(value: DesignFormat): void;
  onLanguage(value: 'ru' | 'en'): void;
  onStateChange(value: DesignState): void;
}

export function TargetBar(props: TargetBarProps) {
  const pages = getEditorPages(props.target);
  return (
    <div class="editor-target-bar">
      <label>Платформа
        <select data-testid="target" value={props.target} onChange={(event) => props.onTarget(event.currentTarget.value as DesignTarget)}>
          {DESIGN_TARGETS.map((target) => <option key={target} value={target}>{EDITOR_TARGET_LABELS[target]}</option>)}
        </select>
      </label>
      <label>Экран
        <select data-testid="route" value={props.route} onChange={(event) => props.onRoute(event.currentTarget.value as DesktopRouteId)}>
          {pages.map((route) => <option key={route.id} value={route.id}>{props.language === 'ru' ? route.label : route.labelEn}</option>)}
        </select>
      </label>
      <label>Формат
        <select data-testid="format" value={props.format} disabled={isTvTarget(props.target)} onChange={(event) => props.onFormat(event.currentTarget.value as DesignFormat)}>
          <option value="landscape">Landscape</option>
          <option value="portrait">Portrait</option>
        </select>
      </label>
      <label>Состояние
        <select data-testid="design-state" value={props.state} onChange={(event) => props.onStateChange(event.currentTarget.value as DesignState)}>
          {(['default', 'hover', 'focus', 'active', 'disabled', 'error'] as DesignState[]).map((state) => <option key={state} value={state}>{state}</option>)}
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

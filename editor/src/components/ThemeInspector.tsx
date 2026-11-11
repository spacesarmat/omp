import { useState } from 'preact/hooks';
import type { DesignTarget, DesignFormat, DesignState } from '../../../design/schema.ts';
import { buildOverride, findDesignElement, overrideId, type EditorOverrideScope } from '../../../design/catalog';
import { resolveThemeTokens } from '../../../design/theme';
import { checkTheme } from '../../../design/theme-checks';
import { DESKTOP_SCREEN_SUPPORT, type DesktopRouteId } from '../../../desktop/src/shell/routes';
import { isDesktopTarget } from '../../shared/routes';
import type { DraftController } from '../drafts';
import { useDraftController } from '../useDraftController';
import { PropertyField } from './PropertyField';
import { TokenLibrary } from './TokenLibrary';

export interface ThemeInspectorProps {
  controller: DraftController;
  target: DesignTarget;
  screenId: DesktopRouteId;
  elementId: string;
  format: DesignFormat;
  state?: DesignState;
  readOnly?: boolean;
  onStateChange?(state: DesignState): void;
}

export function ThemeInspector({ controller, target, screenId, elementId, format, state = 'default', readOnly = false, onStateChange = () => undefined }: ThemeInspectorProps) {
  const draft = useDraftController(controller);
  const [scope, setScope] = useState<EditorOverrideScope>('platform');
  if (isDesktopTarget(target) && DESKTOP_SCREEN_SUPPORT[screenId] === 'preview') return <p class="editor-notice">preview only</p>;
  const definition = findDesignElement(elementId);
  if (!definition) return <p class="editor-notice">Unknown element: {elementId}</p>;
  const availableStates = definition.states || ['default', 'hover', 'focus', 'active'];
  const stateUnsupported = scope === 'state' && !availableStates.includes(state);
  const selectedState = availableStates.includes(state) ? state : 'default';
  const identity = { scope, target, screenId, elementId, format, state: selectedState };
  const currentId = overrideId(identity);
  const currentOverride = draft.theme.overrides.find((entry) => entry.id === currentId);
  const context = {
    target,
    screenId,
    componentId: definition.componentId,
    elementId,
    format,
    state: scope === 'state' ? selectedState : 'default' as DesignState,
  };
  const tokens = resolveThemeTokens(draft.theme, context);
  const issues = checkTheme(draft.theme, [context]);
  const change = (token: string, value: string) => {
    if (readOnly) return;
    controller.upsertOverride(buildOverride(identity, { ...currentOverride?.tokens, [token]: value }));
  };
  return (
    <div class="editor-theme-inspector">
      <h2>{definition.label}</h2>
      <p class="editor-chain">theme &gt; platform &gt; {scope}</p>
      <label>Область
        <select data-testid="scope" value={scope} disabled={readOnly} onChange={(event) => setScope(event.currentTarget.value as EditorOverrideScope)}>
          <option value="platform">platform</option>
          <option value="screen">screen</option>
          <option value="element">element</option>
          <option value="format">format</option>
          <option value="state">state</option>
        </select>
      </label>
      {scope === 'state' && (
        <label>Состояние
          <select data-testid="state" value={selectedState} disabled={readOnly} onChange={(event) => onStateChange(event.currentTarget.value as DesignState)}>
            {availableStates.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      )}
      {stateUnsupported && <p class="editor-notice" role="alert">Состояние {state} недоступно для этого элемента</p>}
      {readOnly && <p class="editor-notice" data-testid="inspector-readonly">Режим сравнения - редактирование выключено</p>}
      {!stateUnsupported && definition.fields.map((field) => <PropertyField key={`${scope}-${field.token}`} {...field} value={tokens[field.token]} disabled={readOnly} onChange={change} />)}
      <button type="button" data-action="reset" disabled={readOnly || stateUnsupported || !currentOverride} onClick={() => { if (!readOnly) controller.removeOverride(currentId); }}>Сбросить override</button>
      {!readOnly && !stateUnsupported && <TokenLibrary controller={controller} identity={identity} fields={definition.fields} values={tokens} />}
      {issues.length > 0 && (
        <div class="editor-issues" role="alert">
          {issues.map((issue) => <div key={`${issue.code}-${issue.token}`}>{issue.code}: {issue.token}</div>)}
        </div>
      )}
    </div>
  );
}

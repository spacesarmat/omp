import { useState } from 'preact/hooks';
import type {
  ConditionPath,
  FlowNodeKind,
  InteractionAction,
  InteractionCondition,
  InteractionRule,
} from '../../../design/schema.ts';
import { DESKTOP_ROUTES } from '../../../desktop/src/shell/routes';
import type { DraftController } from '../drafts';
import { useDraftController } from '../useDraftController';

export interface FlowNodeInspectorProps {
  controller: DraftController;
  ruleId: string;
  nodeId: string;
  readOnly?: boolean;
  onSelectNode?: (selection: { ruleId: string; nodeId: string }) => void;
  onOpenSimulation?: () => void;
}

const CONDITION_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'exists'] as const;

const CONDITION_PATHS = [
  'server.connected',
  'target',
  'screen.current',
  'network.online',
  'account.signedIn',
  'playback.state',
  'download.state',
] as const;

const BOOLEAN_PATHS = new Set(['server.connected', 'network.online', 'account.signedIn']);

const ACTION_TYPES = [
  'navigate',
  'back',
  'openScreen',
  'toast',
  'dialog',
  'playback.playPause',
  'playback.stop',
  'playback.nextEpisode',
  'queue.add',
  'queue.replace',
  'server.connect',
  'server.reconnect',
  'server.retry',
  'source.retry',
  'source.next',
] as const;

function defaultCondition(): InteractionCondition {
  return { kind: 'eq', path: 'server.connected', value: true };
}

function defaultAction(type: string, variables: { id: string; initial: string | number | boolean }[] = []): InteractionAction {
  if (type === 'variable.set') {
    const variable = variables[0];
    if (variable) return { type: 'variable.set', variableId: variable.id, value: variable.initial };
  }
  if (type === 'navigate' || type === 'openScreen') return { type: type as 'navigate', screenId: 'library' };
  if (type === 'toast') return { type: 'toast', message: 'Сообщение' };
  if (type === 'dialog') return { type: 'dialog', title: '', message: '' };
  return { type: type as 'back' };
}

function stepOf(rule: InteractionRule | undefined, node: { stepId?: string } | undefined) {
  if (!rule || !node?.stepId) return undefined;
  return rule.steps?.find((step) => step.id === node.stepId);
}

export function FlowNodeInspector({ controller, ruleId, nodeId, readOnly = false, onSelectNode, onOpenSimulation }: FlowNodeInspectorProps) {
  const draft = useDraftController(controller);
  const [error, setError] = useState('');
  const rule = draft.flow.rules.find((entry) => entry.id === ruleId);
  const node = rule?.graph?.nodes.find((entry) => entry.id === nodeId);
  const step = stepOf(rule, node);
  const variables = draft.flow.variables ?? [];
  const variablePaths = variables.map((variable) => `variable.${variable.id}`);
  if (!rule || !node) return <section class="editor-logic"><h3>Узел потока</h3><p class="editor-notice">Узел не найден</p></section>;

  const patchStep = (recipe: (current: NonNullable<typeof step>) => void) => {
    if (readOnly || !step) return;
    setError('');
    controller.update((current) => {
      const target = current.flow.rules.find((entry) => entry.id === ruleId);
      const targetStep = target?.steps?.find((entry) => entry.id === step.id);
      if (targetStep) recipe(targetStep);
    });
  };

  const setLabel = (label: string) => {
    if (readOnly) return;
    setError('');
    controller.update((current) => {
      const target = current.flow.rules.find((entry) => entry.id === ruleId);
      const targetNode = target?.graph?.nodes.find((entry) => entry.id === nodeId);
      if (targetNode) targetNode.label = label;
    });
  };

  const condition: InteractionCondition = step?.condition ?? defaultCondition();
  const flat = condition.kind === 'all' || condition.kind === 'any' || condition.kind === 'not' || condition.kind === 'exists' ? undefined : condition;
  const conditionPath = flat?.path ?? 'server.connected';
  const isBooleanPath = BOOLEAN_PATHS.has(conditionPath) || conditionPath.startsWith('variable.');
  const action: InteractionAction = step?.action ?? defaultAction('toast');

  const setCondition = (next: InteractionCondition) => {
    patchStep((current) => {
      current.condition = next;
    });
  };

  const setConditionPath = (path: ConditionPath) => {
    setCondition({ kind: 'eq', path, value: BOOLEAN_PATHS.has(path) ? true : '' });
  };

  const setConditionOp = (kind: (typeof CONDITION_OPS)[number]) => {
    if (kind === 'exists') {
      setCondition({ kind: 'exists', path: conditionPath });
      return;
    }
    const value = isBooleanPath ? flat?.value !== false : (flat?.value ?? '');
    setCondition({ kind, path: conditionPath, value: typeof value === 'boolean' ? value : value });
  };

  const setConditionValue = (raw: string) => {
    if (!flat) return;
    if (isBooleanPath) {
      setCondition({ ...flat, value: raw === 'true' });
      return;
    }
    if (flat.kind === 'gt' || flat.kind === 'gte' || flat.kind === 'lt' || flat.kind === 'lte') {
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        setError('NUMBER_REQUIRED');
        return;
      }
      setCondition({ ...flat, value });
      return;
    }
    setCondition({ ...flat, value: raw });
  };

  const setAction = (next: InteractionAction) => {
    patchStep((current) => {
      current.action = next;
    });
  };

  const setActionType = (type: string) => {
    setError('');
    setAction(defaultAction(type, variables));
  };

  const actionVariable = action.type === 'variable.set' ? variables.find((variable) => variable.id === action.variableId) : undefined;

  const setActionVariable = (variableId: string) => {
    const variable = variables.find((entry) => entry.id === variableId);
    if (!variable) {
      setError('UNKNOWN_VARIABLE');
      return;
    }
    setAction({ type: 'variable.set', variableId: variable.id, value: variable.initial });
  };

  const setActionVariableValue = (raw: string) => {
    if (action.type !== 'variable.set' || !actionVariable) return;
    if (actionVariable.type === 'boolean') {
      setAction({ ...action, value: raw === 'true' });
      return;
    }
    if (actionVariable.type === 'number') {
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        setError('NUMBER_REQUIRED');
        return;
      }
      setAction({ ...action, value });
      return;
    }
    if (actionVariable.type === 'enum') {
      if (!(actionVariable.values ?? []).includes(raw)) {
        setError('ENUM_VALUE_REQUIRED');
        return;
      }
      setAction({ ...action, value: raw });
      return;
    }
    setAction({ ...action, value: raw });
  };

  const setActionMessage = (raw: string) => {
    if (action.type === 'toast' && !raw.trim()) {
      setError('TOAST_REQUIRED');
      return;
    }
    if (action.type === 'dialog') {
      setAction({ ...action, message: raw } as InteractionAction);
      return;
    }
    setAction({ type: 'toast', message: raw });
  };

  const kindLabel: Record<FlowNodeKind, string> = { trigger: 'Триггер', condition: 'Условие', action: 'Действие', result: 'Результат' };
  const needsScreen = action.type === 'navigate' || action.type === 'openScreen';

  return (
    <section class="editor-logic flow-inspector">
      <h3>Узел: {kindLabel[node.kind]}</h3>
      {readOnly && <p class="editor-notice" data-testid="inspector-readonly">Режим сравнения - редактирование выключено</p>}
      <label>Метка
        <input data-testid="inspector-label" value={node.label ?? ''} disabled={readOnly} onInput={(event) => setLabel(event.currentTarget.value)} />
      </label>
      {node.kind === 'trigger' && (
        <p class="editor-notice">Событие {rule.event} на {rule.elementId === '*' ? rule.screenId : rule.elementId}</p>
      )}
      {node.kind === 'condition' && step && (
        <>
          <label>Путь
            <select data-testid="inspector-condition-path" value={conditionPath} disabled={readOnly} onChange={(event) => setConditionPath(event.currentTarget.value as ConditionPath)}>
              {CONDITION_PATHS.map((path) => <option value={path}>{path}</option>)}
              {variablePaths.map((path) => <option value={path}>{path}</option>)}
            </select>
          </label>
          <label>Оператор
            <select data-testid="inspector-condition-op" value={condition.kind} disabled={readOnly} onChange={(event) => setConditionOp(event.currentTarget.value as (typeof CONDITION_OPS)[number])}>
              {CONDITION_OPS.map((op) => <option value={op}>{op}</option>)}
            </select>
          </label>
          {flat && (
            isBooleanPath ? (
              <label>Значение
                <select data-testid="inspector-condition-value" value={String(flat.value)} disabled={readOnly} onChange={(event) => setConditionValue(event.currentTarget.value)}>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </label>
            ) : (
              <label>Значение
                <input
                  data-testid="inspector-condition-value"
                  value={String(flat.value ?? '')}
                  disabled={readOnly}
                  inputMode={flat.kind === 'gt' || flat.kind === 'gte' || flat.kind === 'lt' || flat.kind === 'lte' ? 'decimal' : 'text'}
                  onInput={(event) => setConditionValue(event.currentTarget.value)}
                />
              </label>
            )
          )}
        </>
      )}
      {(node.kind === 'action' || node.kind === 'result') && step && (
        <>
          <label>Действие
            <select data-testid="inspector-action-type" value={action.type} disabled={readOnly} onChange={(event) => setActionType(event.currentTarget.value)}>
              {ACTION_TYPES.map((type) => <option value={type}>{type}</option>)}
              {variables.length > 0 && <option value="variable.set">variable.set</option>}
            </select>
          </label>
          {needsScreen && (
            <label>Экран
              <select data-testid="inspector-action-screen" value={action.screenId} disabled={readOnly} onChange={(event) => setAction({ type: action.type, screenId: event.currentTarget.value } as InteractionAction)}>
                {DESKTOP_ROUTES.map((route) => <option value={route.id}>{route.id}</option>)}
              </select>
            </label>
          )}
          {(action.type === 'toast' || action.type === 'dialog') && (
            <label>Сообщение
              <input data-testid="inspector-action-message" value={action.message} disabled={readOnly} onInput={(event) => setActionMessage(event.currentTarget.value)} />
            </label>
          )}
          {action.type === 'dialog' && (
            <label>Заголовок
              <input data-testid="inspector-action-title" value={action.title} disabled={readOnly} onInput={(event) => setAction({ ...action, title: event.currentTarget.value } as InteractionAction)} />
            </label>
          )}
          {action.type === 'variable.set' && (
            <>
              <label>Переменная
                <select data-testid="inspector-action-variable" value={action.variableId} disabled={readOnly} onChange={(event) => setActionVariable(event.currentTarget.value)}>
                  {variables.map((variable) => <option value={variable.id}>{variable.name} ({variable.id})</option>)}
                </select>
              </label>
              {actionVariable?.type === 'boolean' && (
                <label>Значение
                  <select data-testid="inspector-action-variable-value" value={String(action.value)} disabled={readOnly} onChange={(event) => setActionVariableValue(event.currentTarget.value)}>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                </label>
              )}
              {actionVariable?.type === 'number' && (
                <label>Значение
                  <input data-testid="inspector-action-variable-value" value={String(action.value)} disabled={readOnly} inputMode="decimal" onInput={(event) => setActionVariableValue(event.currentTarget.value)} />
                </label>
              )}
              {actionVariable?.type === 'enum' && (
                <label>Значение
                  <select data-testid="inspector-action-variable-value" value={String(action.value)} disabled={readOnly} onChange={(event) => setActionVariableValue(event.currentTarget.value)}>
                    {(actionVariable.values ?? []).map((value) => <option value={value}>{value}</option>)}
                  </select>
                </label>
              )}
              {actionVariable?.type === 'string' && (
                <label>Значение
                  <input data-testid="inspector-action-variable-value" value={String(action.value)} disabled={readOnly} onInput={(event) => setActionVariableValue(event.currentTarget.value)} />
                </label>
              )}
            </>
          )}
        </>
      )}
      {node.kind === 'result' && !step && <p class="editor-notice">Терминальный узел собирает итог выполнения</p>}
      {error && <p class="editor-flow-error" role="alert" data-testid="inspector-error">{error}</p>}
      <div class="flow-inspector-actions">
        {onSelectNode && <button type="button" data-action="reveal-in-design" onClick={() => onSelectNode({ ruleId, nodeId })}>Показать в дизайне</button>}
        {onOpenSimulation && <button type="button" data-action="open-simulation" onClick={onOpenSimulation}>Симуляция</button>}
      </div>
    </section>
  );
}

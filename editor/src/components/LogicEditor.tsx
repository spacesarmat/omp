import { useEffect, useState } from 'preact/hooks';
import type { FlowDocument, InteractionAction, InteractionCondition, InteractionRule } from '../../../design/schema.ts';
import { validateFlow } from '../../../design/flow-validation';
import { DESKTOP_ROUTES, isDesktopRouteId, type DesktopRouteId } from '../../../desktop/src/shell/routes';
import type { DraftController } from '../drafts';
import { useDraftController } from '../useDraftController';

interface RuleForm {
  condition: 'none' | 'server-true' | 'server-false' | 'custom';
  action: 'navigate' | 'back' | 'toast';
  destination: string;
  message: string;
}

function formOf(rule: InteractionRule): RuleForm {
  const actionType = rule.action.type;
  return {
    condition: rule.condition?.kind === 'eq' && rule.condition.path === 'server.connected'
      ? rule.condition.value === true ? 'server-true' : 'server-false'
      : rule.condition ? 'custom' : 'none',
    action: actionType === 'navigate' || actionType === 'back' || actionType === 'toast' ? actionType : 'toast',
    destination: rule.action.type === 'navigate' ? rule.action.screenId : 'library',
    message: rule.action.type === 'toast' ? rule.action.message : '',
  };
}

function conditionOf(form: RuleForm, original?: InteractionCondition): InteractionCondition | undefined {
  if (form.condition === 'custom') return original;
  if (form.condition === 'none') return undefined;
  return { kind: 'eq', path: 'server.connected', value: form.condition === 'server-true' };
}

function actionOf(form: RuleForm): InteractionAction {
  if (form.action === 'navigate') return { type: 'navigate', screenId: form.destination };
  if (form.action === 'back') return { type: 'back' };
  return { type: 'toast', message: form.message.trim() };
}

function nextId(flow: FlowDocument, elementId: string): string {
  let index = flow.rules.length + 1;
  while (flow.rules.some((rule) => rule.id === `custom-${elementId}-${index}`)) index += 1;
  return `custom-${elementId}-${index}`;
}

export interface LogicEditorProps {
  controller: DraftController;
  screenId: DesktopRouteId;
  elementId: string;
  readOnly?: boolean;
}

export function LogicEditor({ controller, screenId, elementId, readOnly = false }: LogicEditorProps) {
  const draft = useDraftController(controller);
  const matching = draft.flow.rules.filter((rule) => rule.screenId === screenId && rule.elementId === elementId);
  const [selectedId, setSelectedId] = useState(matching[0]?.id || nextId(draft.flow, elementId));
  const [form, setForm] = useState<RuleForm>(() => formOf(matching[0] || {
    id: selectedId,
    screenId,
    elementId,
    event: 'click',
    action: { type: 'navigate', screenId: 'library' },
  }));
  const [isNew, setIsNew] = useState(!matching.length);
  const [error, setError] = useState('');
  const routeIds = DESKTOP_ROUTES.map((route) => route.id);
  const issues = validateFlow(draft.flow, routeIds);
  const selectedCondition = draft.flow.rules.find((entry) => entry.id === selectedId)?.condition;
  const hasCustomCondition = selectedCondition && (selectedCondition.kind !== 'eq' || selectedCondition.path !== 'server.connected');

  useEffect(() => {
    const rule = draft.flow.rules.find((entry) => entry.id === selectedId);
    if (rule) setForm(formOf(rule));
  }, [selectedId, draft.flow]);

  const save = () => {
    if (readOnly) return;
    if (form.action === 'navigate' && !isDesktopRouteId(form.destination)) {
      setError('UNKNOWN_ROUTE');
      return;
    }
    if (form.action === 'toast' && !form.message.trim()) {
      setError('TOAST_REQUIRED');
      return;
    }
    const next: InteractionRule = {
      id: selectedId,
      screenId,
      elementId,
      event: 'click',
      action: actionOf(form),
    };
    const condition = conditionOf(form, draft.flow.rules.find((rule) => rule.id === selectedId)?.condition);
    if (condition) next.condition = condition;
    controller.replaceFlow({
      ...draft.flow,
      rules: isNew ? draft.flow.rules.concat(next) : draft.flow.rules.map((rule) => rule.id === selectedId ? next : rule),
    });
    setIsNew(false);
    setError('');
  };

  const add = () => {
    const id = nextId(draft.flow, elementId);
    setSelectedId(id);
    setIsNew(true);
    setForm({ condition: 'none', action: 'navigate', destination: 'library', message: '' });
  };

  const move = (direction: -1 | 1) => {
    if (readOnly) return;
    const index = draft.flow.rules.findIndex((rule) => rule.id === selectedId);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= draft.flow.rules.length) return;
    const rules = [...draft.flow.rules];
    const [rule] = rules.splice(index, 1);
    rules.splice(destination, 0, rule);
    controller.replaceFlow({ ...draft.flow, rules });
  };

  return (
    <section class="editor-logic">
      <h3>Логика: {elementId}</h3>
      <label>Правило
        <select data-testid="rule" value={selectedId} disabled={readOnly} onChange={(event) => {
          setSelectedId(event.currentTarget.value);
          setIsNew(false);
        }}>
          {matching.map((rule) => <option value={rule.id}>{rule.id}</option>)}
          {isNew && <option value={selectedId}>{selectedId}</option>}
        </select>
      </label>
      {readOnly && <p class="editor-notice" data-testid="inspector-readonly">Режим сравнения - редактирование выключено</p>}
      <button type="button" data-action="add-rule" disabled={readOnly} onClick={add}>Добавить правило</button>
      <label>Событие
        <select data-testid="event" value="click" disabled><option value="click">click</option></select>
      </label>
      <label>Условие
        <select data-testid="condition" value={form.condition} disabled={readOnly} onChange={(event) => setForm({ ...form, condition: event.currentTarget.value as RuleForm['condition'] })}>
          <option value="none">Всегда</option>
          <option value="server-true">server.connected = true</option>
          <option value="server-false">server.connected = false</option>
          {hasCustomCondition && <option value="custom">Исходное условие</option>}
        </select>
      </label>
      <label>Действие
        <select data-testid="action" value={form.action} disabled={readOnly} onChange={(event) => setForm({ ...form, action: event.currentTarget.value as RuleForm['action'] })}>
          <option value="navigate">navigate</option>
          <option value="back">back</option>
          <option value="toast">toast</option>
        </select>
      </label>
      {form.action === 'navigate' && (
        <label>Экран назначения
          <select data-testid="destination" value={form.destination} disabled={readOnly} onChange={(event) => setForm({ ...form, destination: event.currentTarget.value })}>
            {DESKTOP_ROUTES.map((route) => <option value={route.id}>{route.id}</option>)}
          </select>
        </label>
      )}
      {form.action === 'toast' && (
        <label>Текст сообщения
          <input data-testid="toast-message" value={form.message} disabled={readOnly} onChange={(event) => setForm({ ...form, message: event.currentTarget.value })} />
        </label>
      )}
      <button type="button" data-action="save-rule" disabled={readOnly} onClick={save}>Сохранить правило</button>
      <button type="button" data-action="move-up" disabled={readOnly} onClick={() => move(-1)}>Вверх</button>
      <button type="button" data-action="move-down" disabled={readOnly} onClick={() => move(1)}>Вниз</button>
      {error && <p role="alert">{error}</p>}
      {issues.length > 0 && <div class="editor-issues" role="alert">{issues.map((issue) => <div key={`${issue.code}-${issue.ruleId}`}>{issue.code}: {issue.message}</div>)}</div>}
    </section>
  );
}

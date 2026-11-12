import type {
  FlowDocument,
  FlowEdge,
  FlowNodeView,
  FlowVariable,
  InteractionCondition,
  InteractionRule,
  InteractionStep,
} from './schema.ts';

export const FLOW_TEMPLATE_IDS = ['connect-server', 'offline-retry', 'episode-queue', 'playback-fallback', 'restore-position'] as const;
export type FlowTemplateId = (typeof FLOW_TEMPLATE_IDS)[number];

export interface FlowTemplateMeta {
  id: FlowTemplateId;
  title: string;
  description: string;
}

// Instantiation context: plain document identifiers and saved UI state only, never secrets.
// Every field is optional beyond id/baseCommit; templates fall back to their documented defaults.
export interface FlowTemplateContext {
  id: string;
  baseCommit: string;
  screenId?: string;
  elementId?: string;
  routeId?: string;
  savedRoute?: string;
  savedPosition?: number;
  savedElement?: string;
}

export type FlowTemplateErrorCode = 'UNKNOWN_TEMPLATE' | 'INVALID_CONTEXT';

export class FlowTemplateError extends Error {
  readonly code: FlowTemplateErrorCode;

  constructor(code: FlowTemplateErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

export const FLOW_TEMPLATES: ReadonlyArray<FlowTemplateMeta> = [
  {
    id: 'connect-server',
    title: 'Подключение сервера',
    description: 'Кнопка продолжения: при подключенном сервере сразу открывает каталог, иначе подключает сервер.',
  },
  {
    id: 'offline-retry',
    title: 'Повтор при пропадании сети',
    description: 'При событии network.offline показывает ошибку и повторяет подключение к серверу.',
  },
  {
    id: 'episode-queue',
    title: 'Очередь серий',
    description: 'Выбор серии добавляет её в очередь и запускает следующую серию.',
  },
  {
    id: 'playback-fallback',
    title: 'Запасной источник',
    description: 'Пробует другой источник воспроизведения, при неудаче показывает ошибку.',
  },
  {
    id: 'restore-position',
    title: 'Возврат с сохранением позиции',
    description: 'На уходе со экрана запоминает route, позицию и элемент, на входе возвращает к ним.',
  },
];

interface TemplateBody {
  rules: InteractionRule[];
  variables: FlowVariable[];
}

interface FlowTemplateDefinition extends FlowTemplateMeta {
  build: (context: FlowTemplateContext) => TemplateBody;
}

// The placeholder terminal action keeps the document schema-valid for graph rules; behavior
// comes from the graph and its steps, the same convention as the canvas node operations.
const PLACEHOLDER_ACTION: InteractionRule['action'] = { type: 'back' };

function node(id: string, kind: FlowNodeView['kind'], x: number, y: number, label: string, stepId?: string): FlowNodeView {
  const view: FlowNodeView = { id, kind, x, y, label };
  if (stepId) view.stepId = stepId;
  return view;
}

function edge(id: string, from: string, to: string, branch: FlowEdge['branch']): FlowEdge {
  return { id, from, to, branch };
}

function graphRule(
  id: string,
  screenId: string,
  elementId: string,
  event: InteractionRule['event'],
  nodes: FlowNodeView[],
  edges: FlowEdge[],
  steps: InteractionStep[],
): InteractionRule {
  return { id, screenId, elementId, event, action: PLACEHOLDER_ACTION, steps, graph: { nodes, edges } };
}

const DEFINITIONS: ReadonlyArray<FlowTemplateDefinition> = [
  {
    id: 'connect-server',
    title: FLOW_TEMPLATES[0].title,
    description: FLOW_TEMPLATES[0].description,
    build: (context) => ({
      variables: [],
      rules: [
        graphRule(
          'connect-server',
          context.screenId ?? 'connect',
          context.elementId ?? 'connect-continue',
          'click',
          [
            node('cs-trigger', 'trigger', 80, 120, 'Продолжить'),
            node('cs-check', 'condition', 320, 120, 'Сервер подключен?', 'cs-check-step'),
            node('cs-go-catalog', 'result', 560, 40, 'В каталог', 'cs-go-step'),
            node('cs-connect', 'result', 560, 200, 'Подключить сервер', 'cs-connect-step'),
          ],
          [
            edge('cs-edge-1', 'cs-trigger', 'cs-check', 'default'),
            edge('cs-edge-2', 'cs-check', 'cs-go-catalog', 'true'),
            edge('cs-edge-3', 'cs-check', 'cs-connect', 'false'),
          ],
          [
            { id: 'cs-check-step', condition: { kind: 'eq', path: 'server.connected', value: true } },
            { id: 'cs-go-step', action: { type: 'navigate', screenId: context.routeId ?? 'library' } },
            { id: 'cs-connect-step', action: { type: 'server.connect' } },
          ],
        ),
      ],
    }),
  },
  {
    id: 'offline-retry',
    title: FLOW_TEMPLATES[1].title,
    description: FLOW_TEMPLATES[1].description,
    build: (context) => ({
      variables: [],
      rules: [
        graphRule(
          'offline-retry',
          context.screenId ?? '*',
          context.elementId ?? 'network',
          'network.offline',
          [
            node('or-trigger', 'trigger', 80, 120, 'Сеть пропала'),
            node('or-toast', 'action', 320, 120, 'Ошибка: нет сети', 'or-toast-step'),
            node('or-retry', 'action', 560, 120, 'Повторить подключение', 'or-retry-step'),
          ],
          [
            edge('or-edge-1', 'or-trigger', 'or-toast', 'default'),
            edge('or-edge-2', 'or-toast', 'or-retry', 'default'),
          ],
          [
            { id: 'or-toast-step', action: { type: 'toast', message: 'Нет сети - подключение будет повторено' } },
            { id: 'or-retry-step', action: { type: 'server.retry' } },
          ],
        ),
      ],
    }),
  },
  {
    id: 'episode-queue',
    title: FLOW_TEMPLATES[2].title,
    description: FLOW_TEMPLATES[2].description,
    build: (context) => ({
      variables: [],
      rules: [
        graphRule(
          'episode-queue',
          context.screenId ?? 'library',
          context.elementId ?? 'episode-item',
          'click',
          [
            node('eq-trigger', 'trigger', 80, 120, 'Серия выбрана'),
            node('eq-add', 'action', 320, 120, 'В очередь', 'eq-add-step'),
            node('eq-next', 'action', 560, 120, 'Следующая серия', 'eq-next-step'),
          ],
          [
            edge('eq-edge-1', 'eq-trigger', 'eq-add', 'default'),
            edge('eq-edge-2', 'eq-add', 'eq-next', 'default'),
          ],
          [
            { id: 'eq-add-step', action: { type: 'queue.add' } },
            { id: 'eq-next-step', action: { type: 'playback.nextEpisode' } },
          ],
        ),
      ],
    }),
  },
  {
    id: 'playback-fallback',
    title: FLOW_TEMPLATES[3].title,
    description: FLOW_TEMPLATES[3].description,
    build: (context) => ({
      variables: [],
      rules: [
        graphRule(
          'playback-fallback',
          context.screenId ?? 'remote',
          context.elementId ?? 'source-fallback',
          'click',
          [
            node('pf-trigger', 'trigger', 80, 120, 'Источник не работает'),
            node('pf-next', 'action', 320, 120, 'Другой источник', 'pf-next-step'),
            node('pf-error', 'result', 560, 120, 'Ошибка источника', 'pf-error-step'),
          ],
          [
            edge('pf-edge-1', 'pf-trigger', 'pf-next', 'default'),
            edge('pf-edge-2', 'pf-next', 'pf-error', 'error'),
          ],
          [
            { id: 'pf-next-step', action: { type: 'source.next' } },
            { id: 'pf-error-step', action: { type: 'toast', message: 'Не удалось открыть другой источник' } },
          ],
        ),
      ],
    }),
  },
  {
    id: 'restore-position',
    title: FLOW_TEMPLATES[4].title,
    description: FLOW_TEMPLATES[4].description,
    build: (context) => {
      const savedRoute = context.savedRoute ?? '';
      const savedPosition = context.savedPosition ?? 0;
      const savedElement = context.savedElement ?? '';
      return {
        variables: [
          { id: 'return-route', name: 'Сохраненный route', type: 'string', initial: savedRoute },
          { id: 'return-position', name: 'Сохраненная позиция', type: 'number', initial: savedPosition },
          { id: 'return-element', name: 'Сохраненный элемент', type: 'string', initial: savedElement },
        ],
        rules: [
          graphRule(
            'restore-save',
            context.screenId ?? 'library',
            context.elementId ?? 'content',
            'screen.leave',
            [
              node('rs-trigger', 'trigger', 80, 140, 'Уход со экрана'),
              node('rs-element', 'action', 320, 40, 'Запомнить элемент', 'rs-element-step'),
              node('rs-position', 'action', 320, 140, 'Запомнить позицию', 'rs-position-step'),
              node('rs-route', 'action', 320, 240, 'Запомнить route', 'rs-route-step'),
              node('rs-done', 'result', 560, 140, 'Сохранено'),
            ],
            [
              edge('rs-edge-1', 'rs-trigger', 'rs-element', 'default'),
              edge('rs-edge-2', 'rs-element', 'rs-position', 'default'),
              edge('rs-edge-3', 'rs-position', 'rs-route', 'default'),
              edge('rs-edge-4', 'rs-route', 'rs-done', 'default'),
            ],
            [
              { id: 'rs-element-step', action: { type: 'variable.set', variableId: 'return-element', value: savedElement } },
              { id: 'rs-position-step', action: { type: 'variable.set', variableId: 'return-position', value: savedPosition } },
              { id: 'rs-route-step', action: { type: 'variable.set', variableId: 'return-route', value: savedRoute } },
            ],
          ),
          graphRule(
            'restore-enter',
            context.screenId ?? 'library',
            context.elementId ?? 'content',
            'screen.enter',
            [
              node('re-trigger', 'trigger', 80, 140, 'Вход на экран'),
              node('re-check', 'condition', 320, 140, 'Есть сохранение?', 're-check-step'),
              node('re-back', 'result', 560, 60, 'Вернуться к просмотру', 're-back-step'),
              node('re-empty', 'result', 560, 220, 'Нет сохранений'),
            ],
            [
              edge('re-edge-1', 're-trigger', 're-check', 'default'),
              edge('re-edge-2', 're-check', 're-back', 'true'),
              edge('re-edge-3', 're-check', 're-empty', 'false'),
            ],
            [
              { id: 're-check-step', condition: { kind: 'neq', path: 'variable.return-route', value: '' } },
              { id: 're-back-step', action: { type: 'navigate', screenId: context.savedRoute || context.routeId || 'library' } },
            ],
          ),
        ],
      };
    },
  },
];

const DEFINITION_BY_ID = new Map<FlowTemplateId, FlowTemplateDefinition>(DEFINITIONS.map((definition) => [definition.id, definition]));

function assertContext(context: FlowTemplateContext): void {
  if (!context || typeof context.id !== 'string' || context.id.trim() === '') {
    throw new FlowTemplateError('INVALID_CONTEXT', 'context.id must be a non-empty string');
  }
  if (typeof context.baseCommit !== 'string' || context.baseCommit.trim() === '') {
    throw new FlowTemplateError('INVALID_CONTEXT', 'context.baseCommit must be a non-empty string');
  }
  if (context.savedPosition !== undefined && typeof context.savedPosition !== 'number') {
    throw new FlowTemplateError('INVALID_CONTEXT', 'context.savedPosition must be a number');
  }
}

function rewriteCondition(condition: InteractionCondition, variableIdByOld: ReadonlyMap<string, string>): void {
  if (condition.kind === 'all' || condition.kind === 'any') {
    for (const entry of condition.conditions) rewriteCondition(entry, variableIdByOld);
    return;
  }
  if (condition.kind === 'not') {
    rewriteCondition(condition.condition, variableIdByOld);
    return;
  }
  if (condition.path.startsWith('variable.')) {
    const mapped = variableIdByOld.get(condition.path.slice('variable.'.length));
    if (mapped) condition.path = `variable.${mapped}`;
  }
}

// Every instance gets a fresh random token in all rule/node/step/edge/variable ids, so two
// instantiations of one template can coexist in a single document without collisions.
function rewriteIds(body: TemplateBody, token: string): void {
  const suffix = `-${token}`;
  const variableIdByOld = new Map(body.variables.map((variable) => [variable.id, `${variable.id}${suffix}`]));
  for (const variable of body.variables) variable.id = variableIdByOld.get(variable.id)!;
  for (const rule of body.rules) {
    rule.id = `${rule.id}${suffix}`;
    const nodeIdByOld = new Map((rule.graph?.nodes ?? []).map((entry) => [entry.id, `${entry.id}${suffix}`]));
    for (const entry of rule.graph?.nodes ?? []) {
      entry.id = nodeIdByOld.get(entry.id)!;
      entry.ruleId = rule.id;
      if (entry.stepId) entry.stepId = `${entry.stepId}${suffix}`;
    }
    for (const entry of rule.graph?.edges ?? []) {
      entry.id = `${entry.id}${suffix}`;
      entry.from = nodeIdByOld.get(entry.from) ?? entry.from;
      entry.to = nodeIdByOld.get(entry.to) ?? entry.to;
    }
    for (const step of rule.steps ?? []) step.id = `${step.id}${suffix}`;
    if (rule.condition) rewriteCondition(rule.condition, variableIdByOld);
    for (const step of rule.steps ?? []) {
      if (step.condition) rewriteCondition(step.condition, variableIdByOld);
      if (step.action?.type === 'variable.set') {
        step.action.variableId = variableIdByOld.get(step.action.variableId) ?? step.action.variableId;
      }
    }
  }
}

export function instantiateFlowTemplate(templateId: FlowTemplateId, context: FlowTemplateContext): FlowDocument {
  const definition = DEFINITION_BY_ID.get(templateId);
  if (!definition) throw new FlowTemplateError('UNKNOWN_TEMPLATE', `unknown flow template ${String(templateId)}`);
  assertContext(context);
  // The clone guards the definition even if a build output ever becomes shared: user edits of
  // the returned document can never leak back into the template source.
  const body = structuredClone(definition.build(context));
  rewriteIds(body, crypto.randomUUID().replace(/-/g, '').slice(0, 12));
  return {
    schemaVersion: 1,
    id: context.id,
    baseCommit: context.baseCommit,
    rules: body.rules,
    variables: body.variables.length ? body.variables : undefined,
  };
}

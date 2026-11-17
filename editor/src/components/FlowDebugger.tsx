import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import type { DesktopDesignTarget, FlowDocument, InteractionRule } from '../../../design/schema.ts';
import type { ExecutionTraceEntry } from '../../../design/flow-graph.ts';
import {
  addBreakpoint,
  compareTraces,
  createDebugSession,
  pauseDebug,
  removeBreakpoint,
  resetDebug,
  startDebug,
  stepInto,
  stepOver,
  stopDebug,
  type DebugBreakpoint,
  type DebugMocks,
  type DebugSession,
  type TraceDifference,
} from '../flow/debugger';

export interface FlowDebuggerProps {
  flow: FlowDocument;
  target: DesktopDesignTarget;
  route: string;
  orientation: string;
}

function createMocks(): DebugMocks {
  return { serverConnected: false, networkOnline: true, accountSignedIn: false, playbackState: 'idle', downloadState: 'idle' };
}

function debugEventOf(rule: InteractionRule, route: string) {
  return {
    type: rule.event,
    screenId: route,
    elementId: rule.elementId === '*' ? 'debug-element' : rule.elementId,
  };
}

function describeEntry(entry: ExecutionTraceEntry | null): string {
  if (!entry) return 'конец trace';
  const parts: string[] = [entry.kind ?? 'step'];
  if (entry.nodeId) parts.push(entry.nodeId);
  if (entry.action) parts.push(entry.action);
  if (entry.target) parts.push(`-> ${entry.target}`);
  if (entry.condition !== undefined) parts.push(`condition: ${entry.condition}`);
  if (entry.message) parts.push(entry.message);
  if (entry.error) parts.push(`ошибка: ${entry.error}`);
  return parts.join(' ');
}

export function FlowDebugger({ flow, target, route, orientation }: FlowDebuggerProps) {
  const candidates = flow.rules.filter((rule) =>
    (rule.graph || (rule.steps?.length ?? 0) > 0) && (rule.screenId === '*' || rule.screenId === route));
  const [ruleId, setRuleId] = useState(candidates[0]?.id ?? null);
  const rule = candidates.find((entry) => entry.id === ruleId) ?? candidates[0] ?? null;
  const mocksRef = useRef<DebugMocks | null>(null);
  if (!mocksRef.current) mocksRef.current = createMocks();
  const [session, setSession] = useState<DebugSession | null>(null);
  const [baseline, setBaseline] = useState<ExecutionTraceEntry[] | null>(null);
  const [difference, setDifference] = useState<TraceDifference | null>(null);
  const [, bump] = useReducer((tick: number) => tick + 1, 0);
  const force = () => bump(0);

  const makeSession = (selected: InteractionRule | null): DebugSession | null => {
    if (!selected) return null;
    return createDebugSession({
      rule: selected,
      event: debugEventOf(selected, route),
      target,
      mocks: mocksRef.current!,
      variables: flow.variables ?? [],
    });
  };

  // A route or orientation switch belongs to a different document view: the session,
  // its trace and its breakpoints must not leak from the previous screen.
  useEffect(() => {
    setSession(makeSession(rule));
    setBaseline(null);
    setDifference(null);
  }, [route, orientation]);

  if (!rule || !session) {
    return (
      <section class="editor-debugger" data-testid="debug-empty">
        <h3>Debugger</h3>
        <p>Нет graph-правил для отладки на этом экране.</p>
      </section>
    );
  }

  const run = (action: (active: DebugSession) => void) => {
    action(session);
    force();
  };

  const changeMocks = (patch: Partial<DebugMocks>) => {
    Object.assign(mocksRef.current!, patch);
    // While idle the context snapshot is rebuilt so the next run reads the new mocks.
    if (session.status === 'idle') run(resetDebug);
    else force();
  };

  const changeRule = (event: Event) => {
    const nextId = (event.currentTarget as HTMLSelectElement).value;
    const next = candidates.find((entry) => entry.id === nextId) ?? null;
    setRuleId(nextId);
    setSession(makeSession(next));
    setBaseline(null);
    setDifference(null);
  };

  const rerunAndCompare = () => {
    const previous = session.trace.length > 0 ? [...session.trace] : baseline;
    resetDebug(session);
    startDebug(session);
    if (previous && previous.length > 0) {
      setBaseline(session.trace.length > 0 ? [...session.trace] : null);
      setDifference(compareTraces(previous, session.trace));
    } else {
      setBaseline(session.trace.length > 0 ? [...session.trace] : null);
      setDifference(null);
    }
    force();
  };

  const active = session.status === 'idle' || session.status === 'paused';
  const nodeLabel = (nodeId: string) =>
    rule.graph?.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
  const hasBreakpoint = (breakpoint: DebugBreakpoint) =>
    session.breakpoints.some((entry) => entry.kind === breakpoint.kind && entry.ruleId === breakpoint.ruleId
      && (breakpoint.kind === 'rule' || (entry.kind === 'node' && entry.nodeId === (breakpoint as { nodeId: string }).nodeId)));
  const toggleBreakpoint = (breakpoint: DebugBreakpoint, checked: boolean) => {
    if (checked) addBreakpoint(session, breakpoint);
    else removeBreakpoint(session, breakpoint);
    force();
  };

  return (
    <section class="editor-debugger" data-testid="flow-debugger">
      <h3>Debugger</h3>
      <label class="editor-debugger-rule">
        Правило
        <select data-testid="debug-rule" value={rule.id} onChange={changeRule}>
          {candidates.map((entry) => <option key={entry.id} value={entry.id}>{entry.id}</option>)}
        </select>
      </label>
      <div class="editor-debugger-mocks">
        <strong>Моки</strong>
        <label>
          <input type="checkbox" data-testid="mock-server" checked={mocksRef.current.serverConnected}
            onChange={(event) => changeMocks({ serverConnected: event.currentTarget.checked })} />
          Сервер подключён
        </label>
        <label>
          <input type="checkbox" data-testid="mock-network" checked={mocksRef.current.networkOnline}
            onChange={(event) => changeMocks({ networkOnline: event.currentTarget.checked })} />
          Сеть онлайн
        </label>
        <label>
          <input type="checkbox" data-testid="mock-account" checked={mocksRef.current.accountSignedIn}
            onChange={(event) => changeMocks({ accountSignedIn: event.currentTarget.checked })} />
          Аккаунт вошёл
        </label>
        <label>
          Плеер
          <select data-testid="mock-playback" value={mocksRef.current.playbackState}
            onChange={(event) => changeMocks({ playbackState: event.currentTarget.value as DebugMocks['playbackState'] })}>
            <option value="idle">idle</option>
            <option value="playing">playing</option>
            <option value="paused">paused</option>
            <option value="stopped">stopped</option>
          </select>
        </label>
        <label>
          Загрузка
          <select data-testid="mock-download" value={mocksRef.current.downloadState}
            onChange={(event) => changeMocks({ downloadState: event.currentTarget.value as DebugMocks['downloadState'] })}>
            <option value="idle">idle</option>
            <option value="active">active</option>
            <option value="completed">completed</option>
            <option value="failed">failed</option>
          </select>
        </label>
      </div>
      <div class="editor-debugger-controls" role="toolbar" aria-label="Отладка потока">
        <button type="button" data-action="debug-start" disabled={!active} onClick={() => run(startDebug)}>Старт</button>
        <button type="button" data-action="debug-pause" disabled={!active} onClick={() => run(pauseDebug)}>Пауза</button>
        <button type="button" data-action="debug-step-over" disabled={!active} onClick={() => run(stepOver)}>Шаг over</button>
        <button type="button" data-action="debug-step-into" disabled={!active} onClick={() => run(stepInto)}>Шаг into</button>
        <button type="button" data-action="debug-stop" disabled={session.status !== 'paused'} onClick={() => run(stopDebug)}>Стоп</button>
        <button type="button" data-action="debug-reset" onClick={() => run(resetDebug)}>Сброс</button>
        <button type="button" data-action="debug-compare" disabled={session.trace.length === 0} onClick={rerunAndCompare}>Повтор и сравнение</button>
      </div>
      <p data-testid="debug-status">Статус: {session.status}</p>
      {session.currentNodeId && (
        <p data-testid="debug-current-node">Текущий узел: {nodeLabel(session.currentNodeId)} ({session.currentNodeId})</p>
      )}
      {(session.status === 'error' || session.context.error) && (
        <p role="alert" data-testid="debug-error">{session.context.error ?? 'ошибка выполнения'}</p>
      )}
      <div class="editor-debugger-breakpoints">
        <strong>Точки остановки</strong>
        <label>
          <input type="checkbox" data-testid="debug-bp-rule" checked={hasBreakpoint({ kind: 'rule', ruleId: rule.id })}
            onChange={(event) => toggleBreakpoint({ kind: 'rule', ruleId: rule.id }, event.currentTarget.checked)} />
          Правило {rule.id}
        </label>
        {(rule.graph?.nodes ?? []).map((node) => (
          <label key={node.id}>
            <input type="checkbox" data-testid={`debug-bp-${node.id}`} checked={hasBreakpoint({ kind: 'node', ruleId: rule.id, nodeId: node.id })}
              onChange={(event) => toggleBreakpoint({ kind: 'node', ruleId: rule.id, nodeId: node.id }, event.currentTarget.checked)} />
            {node.label ?? node.id} ({node.kind})
          </label>
        ))}
      </div>
      <div class="editor-debugger-variables">
        <strong>Переменные</strong>
        <ul>
          {Object.entries(session.context.variables).map(([id, value]) => (
            <li data-testid="debug-variable" key={id}>
              {(flow.variables ?? []).find((variable) => variable.id === id)?.name ?? id}: {String(value)}
            </li>
          ))}
        </ul>
      </div>
      <div class="editor-debugger-trace">
        <strong>Trace</strong>
        <ol>
          {session.trace.map((entry, index) => (
            <li data-testid="debug-trace-entry" key={index} class={entry.error ? 'editor-debugger-trace-error' : ''}>
              {describeEntry(entry)}
            </li>
          ))}
        </ol>
      </div>
      {difference && (
        <p data-testid="debug-trace-diff">
          Первое различие: шаг {difference.index + 1}: {describeEntry(difference.first)} -&gt; {describeEntry(difference.second)}
        </p>
      )}
    </section>
  );
}

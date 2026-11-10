import type { FlowDocument, InteractionCondition } from '../../../design/schema.ts';

function conditionLabel(condition: InteractionCondition | undefined): string {
  if (!condition) return 'always';
  if (condition.kind === 'eq') return `${condition.path} = ${String(condition.value)}`;
  if (condition.kind === 'not') return `not ${conditionLabel(condition.condition)}`;
  return `${condition.kind}(${condition.conditions.map(conditionLabel).join(', ')})`;
}

export function FlowMap({ flow }: { flow: FlowDocument }) {
  const nodes = [...new Set(flow.rules.flatMap((rule) => [
    rule.screenId,
    rule.action.type === 'navigate' ? rule.action.screenId : rule.screenId,
  ]))].sort();
  return (
    <section class="editor-flow-map">
      <h3>Карта переходов</h3>
      <div class="editor-flow-nodes">{nodes.map((node) => <span key={node}>{node}</span>)}</div>
      <ul>
        {flow.rules.map((rule) => (
          <li key={rule.id}>
            <strong>{rule.screenId}</strong> {'->'} <span>{rule.action.type === 'navigate' ? rule.action.screenId : rule.action.type}</span>
            <small> [{conditionLabel(rule.condition)}]</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

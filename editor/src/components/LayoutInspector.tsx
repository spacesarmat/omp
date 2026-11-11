import type { LayoutContext, LayoutPlacement } from '../../../design/schema.ts';
import type { LayoutNodeDescriptor } from '../../../design/layoutDom.ts';
import { absolutePlacementFromRect, createPlacement, type LayoutRect } from '../layout/transactions.ts';
import type { MoveNodeArgs } from './SelectionOverlay.tsx';

export interface LayoutInspectorProps {
  context: LayoutContext;
  node: LayoutNodeDescriptor;
  placement: LayoutPlacement | undefined;
  rect: LayoutRect | null;
  parentRect: LayoutRect | null;
  order: string[];
  onPlace(placement: LayoutPlacement): void;
  onMove(args: MoveNodeArgs): void;
}

export function LayoutInspector(props: LayoutInspectorProps) {
  const { node, placement, rect, parentRect } = props;
  const mode = placement?.mode ?? 'flow';
  const currentIndex = props.order.indexOf(node.nodeId);
  const position = currentIndex >= 0 ? currentIndex : props.order.length;
  const label = placement?.label || node.label;

  const switchMode = (next: 'flow' | 'absolute') => {
    if (next === mode) return;
    if (next === 'absolute') {
      if (!rect) return;
      const base = placement ?? createPlacement(props.context, node.nodeId, label);
      props.onPlace(absolutePlacementFromRect(rect, parentRect ?? { x: 0, y: 0, width: 0, height: 0 }, props.context, node.nodeId, label, base));
      return;
    }
    if (!node.parentId) return;
    const base = placement?.mode === 'absolute' ? createPlacement(props.context, node.nodeId, label, { ...placement, mode: 'flow', x: 0, y: 0 }) : undefined;
    props.onMove({ nodeId: node.nodeId, parentId: node.parentId, index: position, placement: base });
  };

  const moveTo = (index: number) => {
    if (!node.parentId) return;
    const base = placement?.mode === 'absolute' ? createPlacement(props.context, node.nodeId, label, { ...placement, mode: 'flow', x: 0, y: 0 }) : placement;
    props.onMove({ nodeId: node.nodeId, parentId: node.parentId, index, placement: base });
  };

  return (
    <div class="editor-layout-inspector" data-testid="layout-inspector">
      <h3>{label}</h3>
      <p class="editor-chain">layout &gt; {props.context.screenId} &gt; {node.nodeId}</p>
      <label>Режим
        <select
          data-testid="layout-mode"
          value={mode}
          onChange={(event) => switchMode(event.currentTarget.value as 'flow' | 'absolute')}
        >
          <option value="flow" disabled={!node.parentId}>flow</option>
          <option value="absolute" disabled={!rect}>absolute</option>
        </select>
      </label>
      {mode === 'flow' && node.parentId && (
        <label>Позиция
          <select data-testid="layout-index" value={position} onChange={(event) => moveTo(Number(event.currentTarget.value))}>
            {Array.from({ length: props.order.length + 1 }, (_, index) => (
              <option key={index} value={index}>{index + 1}</option>
            ))}
          </select>
        </label>
      )}
      {mode === 'absolute' && rect && (
        <dl class="editor-layout-geometry">
          <div><dt>X</dt><dd>{Math.round(rect.x)}</dd></div>
          <div><dt>Y</dt><dd>{Math.round(rect.y)}</dd></div>
          <div><dt>Ширина</dt><dd>{Math.round(rect.width)}</dd></div>
          <div><dt>Высота</dt><dd>{Math.round(rect.height)}</dd></div>
        </dl>
      )}
      {!rect && <p class="editor-notice">Геометрия элемента недоступна в превью</p>}
    </div>
  );
}

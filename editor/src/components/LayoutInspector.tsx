import type { LayoutContainer, LayoutContext, LayoutPlacement } from '../../../design/schema.ts';
import { LAYOUT_SIZE_PX_LIMIT } from '../../../design/validation.ts';
import type { LayoutNodeDescriptor } from '../../../design/layoutDom.ts';
import {
  absolutePlacementFromRect,
  createPlacement,
  marginOffsetPx,
  placementSizeConversion,
  placementToRect,
  type LayoutRect,
} from '../layout/transactions.ts';
import type { MoveNodeArgs } from './SelectionOverlay.tsx';

export type EditorFieldValue = number | 'mixed';

export function formatSizeField(value: EditorFieldValue | undefined): string {
  if (value === undefined) return '';
  if (value === 'mixed') return 'разные';
  return String(value);
}

// Spacing fields store CSS px sizes: plain numbers become "Npx", an empty input clears
// the value and the mixed sentinel keeps multi-select edits representable for Task 5. Values
// above the document size limit are rejected here: a bigger number can never reach the draft,
// where validation would throw without naming the field that produced it.
export function parseSpacingField(text: string): string | 'mixed' | null {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (trimmed === 'mixed' || trimmed === 'разные') return 'mixed';
  const parsed = trimmed.replace(/px$/, '');
  if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(parsed)) return null;
  if (Number.parseFloat(parsed) > LAYOUT_SIZE_PX_LIMIT) return null;
  return `${parsed}px`;
}

export interface LayoutInspectorProps {
  context: LayoutContext;
  node: LayoutNodeDescriptor;
  placement: LayoutPlacement | undefined;
  rect: LayoutRect | null;
  parentRect: LayoutRect | null;
  order: string[];
  container?: LayoutContainer;
  readOnly?: boolean;
  onPlace(placement: LayoutPlacement): void;
  onMove(args: MoveNodeArgs): void;
  onContainerPatch(patch: { padding?: string }): void;
  onMargin(margin: string | undefined): void;
}

interface NumberFieldProps {
  testId: string;
  label: string;
  value: number;
  disabled?: boolean;
  onCommit(value: number): void;
}

function NumberField(props: NumberFieldProps) {
  return (
    <label>{props.label}
      <input
        type="number"
        data-testid={props.testId}
        value={String(props.value)}
        disabled={props.disabled ?? false}
        onChange={(event) => {
          if (props.disabled) return;
          const next = Number(event.currentTarget.value);
          if (Number.isFinite(next) && next !== props.value) props.onCommit(Math.round(next));
        }}
      />
    </label>
  );
}

interface SpacingFieldProps {
  testId: string;
  label: string;
  value: string | undefined;
  placeholder?: string;
  disabled?: boolean;
  onCommit(value: string | undefined): void;
}

function SpacingField(props: SpacingFieldProps) {
  return (
    <label>{props.label}
      <input
        type="text"
        data-testid={props.testId}
        value={props.value ?? ''}
        placeholder={props.placeholder}
        disabled={props.disabled ?? false}
        onChange={(event) => {
          if (props.disabled) return;
          const parsed = parseSpacingField(event.currentTarget.value);
          if (parsed === null || parsed === 'mixed') return;
          props.onCommit(parsed === '' ? undefined : parsed);
        }}
      />
    </label>
  );
}

export function LayoutInspector(props: LayoutInspectorProps) {
  const { node, placement, rect, parentRect } = props;
  const readOnly = props.readOnly ?? false;
  const mode = placement?.mode ?? 'flow';
  const currentIndex = props.order.indexOf(node.nodeId);
  const position = currentIndex >= 0 ? currentIndex : props.order.length;
  const label = placement?.label || node.label;
  const geometryRect = mode === 'absolute' && placement && parentRect
    ? placementToRect(placement, parentRect, rect)
    : null;

  const switchMode = (next: 'flow' | 'absolute') => {
    if (readOnly || next === mode) return;
    if (next === 'absolute') {
      if (!rect) return;
      const base = placement ?? createPlacement(props.context, node.nodeId, label);
      // The measured border box already includes the margin offset and the preserved margin
      // re-adds it at render, so convert the margin-free coordinates.
      const margin = marginOffsetPx(base.margin);
      const contentRect = margin ? { ...rect, x: rect.x - margin, y: rect.y - margin } : rect;
      props.onPlace(absolutePlacementFromRect(contentRect, parentRect ?? { x: 0, y: 0, width: 0, height: 0 }, props.context, node.nodeId, label, base));
      return;
    }
    if (!node.parentId) return;
    const base = placement?.mode === 'absolute' ? createPlacement(props.context, node.nodeId, label, { ...placement, mode: 'flow', x: 0, y: 0 }) : undefined;
    props.onMove({ nodeId: node.nodeId, parentId: node.parentId, index: position, placement: base });
  };

  const moveTo = (index: number) => {
    if (readOnly || !node.parentId) return;
    const base = placement?.mode === 'absolute' ? createPlacement(props.context, node.nodeId, label, { ...placement, mode: 'flow', x: 0, y: 0 }) : placement;
    props.onMove({ nodeId: node.nodeId, parentId: node.parentId, index, placement: base });
  };

  const commitGeometry = (patch: Partial<LayoutRect>) => {
    if (readOnly || !geometryRect || !parentRect) return;
    const next = { ...geometryRect, ...patch };
    const base = placement ?? createPlacement(props.context, node.nodeId, label);
    const placed = absolutePlacementFromRect(next, parentRect, props.context, node.nodeId, label, base);
    const override: Partial<LayoutPlacement> = {};
    if (patch.width !== undefined) {
      const width = placementSizeConversion(next.width, base, parentRect.width, 'width');
      override.width = width.units;
      if (width.advancedBasis !== undefined) override.basisWidth = Math.round(width.advancedBasis);
    }
    if (patch.height !== undefined) {
      const height = placementSizeConversion(next.height, base, parentRect.height, 'height');
      override.height = height.units;
      if (height.advancedBasis !== undefined) override.basisHeight = Math.round(height.advancedBasis);
    }
    props.onPlace({ ...placed, ...override });
  };

  return (
    <div class="editor-layout-inspector" data-testid="layout-inspector">
      <h3>{label}</h3>
      <p class="editor-chain">layout &gt; {props.context.screenId} &gt; {node.nodeId}</p>
      <label>Режим
        <select
          data-testid="layout-mode"
          value={mode}
          disabled={readOnly}
          onChange={(event) => switchMode(event.currentTarget.value as 'flow' | 'absolute')}
        >
          <option value="flow" disabled={!node.parentId}>flow</option>
          <option value="absolute" disabled={!rect}>absolute</option>
        </select>
      </label>
      {mode === 'flow' && node.parentId && (
        <label>Позиция
          <select data-testid="layout-index" value={position} disabled={readOnly} onChange={(event) => moveTo(Number(event.currentTarget.value))}>
            {Array.from({ length: props.order.length + 1 }, (_, index) => (
              <option key={index} value={index}>{index + 1}</option>
            ))}
          </select>
        </label>
      )}
      {geometryRect && (
        <div class="editor-layout-geometry">
          <NumberField testId="layout-x" label="X" value={Math.round(geometryRect.x)} disabled={readOnly} onCommit={(x) => commitGeometry({ x })} />
          <NumberField testId="layout-y" label="Y" value={Math.round(geometryRect.y)} disabled={readOnly} onCommit={(y) => commitGeometry({ y })} />
          <NumberField testId="layout-width" label="Ширина" value={Math.round(geometryRect.width)} disabled={readOnly} onCommit={(width) => commitGeometry({ width })} />
          <NumberField testId="layout-height" label="Высота" value={Math.round(geometryRect.height)} disabled={readOnly} onCommit={(height) => commitGeometry({ height })} />
        </div>
      )}
      {mode === 'absolute' && !geometryRect && rect && (
        <dl class="editor-layout-geometry">
          <div><dt>X</dt><dd>{Math.round(rect.x)}</dd></div>
          <div><dt>Y</dt><dd>{Math.round(rect.y)}</dd></div>
          <div><dt>Ширина</dt><dd>{Math.round(rect.width)}</dd></div>
          <div><dt>Высота</dt><dd>{Math.round(rect.height)}</dd></div>
        </dl>
      )}
      <div class="editor-layout-spacing">
        <SpacingField
          testId="layout-padding"
          label="Внутренние поля"
          value={props.container?.padding}
          disabled={readOnly}
          onCommit={(padding) => props.onContainerPatch({ padding })}
        />
        <SpacingField
          testId="layout-margin"
          label="Внешние поля"
          value={placement?.margin}
          placeholder="0px"
          disabled={readOnly}
          onCommit={(margin) => props.onMargin(margin)}
        />
      </div>
      {!rect && <p class="editor-notice">Геометрия элемента недоступна в превью</p>}
    </div>
  );
}

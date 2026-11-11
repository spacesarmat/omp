import { useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { LayoutContainer, LayoutContext, LayoutPlacement } from '../../../design/schema.ts';
import type { LayoutNodeDescriptor } from '../../../design/layoutDom.ts';
import {
  absolutePlacementFromRect,
  createPlacement,
  DRAG_THRESHOLD_PX,
  screenToArtboard,
  type ClientPoint,
  type ClientRectLike,
  type LayoutRect,
} from '../layout/transactions.ts';

export interface MoveNodeArgs {
  nodeId: string;
  parentId: string;
  index: number;
  placement?: LayoutPlacement;
}

export interface SelectionOverlayProps {
  active: boolean;
  viewport: { width: number; height: number };
  zoom: number;
  context: LayoutContext;
  nodes: LayoutNodeDescriptor[];
  rects: Record<string, LayoutRect>;
  containers: LayoutContainer[];
  placements: LayoutPlacement[];
  selectedNodeId: string | null;
  getIframeRect(): ClientRectLike;
  onSelect(nodeId: string | null): void;
  onMoveNode(args: MoveNodeArgs): void;
  onPlaceNode(placement: LayoutPlacement): void;
}

interface InsertionTarget {
  parentId: string;
  index: number;
  row: boolean;
}

interface DragState {
  pointerId: number;
  nodeId: string;
  start: ClientPoint;
  started: boolean;
  emptyClick: boolean;
  point: ClientPoint;
  insertion: InsertionTarget | null;
}

interface DragPreview {
  nodeId: string;
  insertion: InsertionTarget | null;
  point: ClientPoint;
  start: ClientPoint;
}

function contains(rect: LayoutRect, point: ClientPoint): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function area(rect: LayoutRect): number {
  return rect.width * rect.height;
}

export function SelectionOverlay(props: SelectionOverlayProps) {
  const drag = useRef<DragState | null>(null);
  const [preview, setPreview] = useState<DragPreview | null>(null);

  const artboardPoint = (event: PointerEvent): ClientPoint => screenToArtboard(
    { x: event.clientX, y: event.clientY },
    props.getIframeRect(),
    props.viewport,
    props.zoom,
  );

  const hitTest = (point: ClientPoint): LayoutNodeDescriptor | null => {
    for (let index = props.nodes.length - 1; index >= 0; index -= 1) {
      const node = props.nodes[index];
      if (node.parentId === null) continue;
      const rect = props.rects[node.nodeId];
      if (rect && contains(rect, point)) return node;
    }
    return null;
  };

  const orderedChildren = (parentId: string, draggedId: string): LayoutRect[] => {
    const explicit = props.containers.find((container) => container.nodeId === parentId);
    const children = props.nodes.filter((node) => node.parentId === parentId && node.nodeId !== draggedId);
    if (explicit?.order.length) {
      const rank = new Map(explicit.order.map((nodeId, index) => [nodeId, index]));
      children.sort((a, b) => (rank.get(a.nodeId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.nodeId) ?? Number.MAX_SAFE_INTEGER));
    }
    return children
      .map((node) => props.rects[node.nodeId])
      .filter((rect): rect is LayoutRect => Boolean(rect));
  };

  const resolveInsertion = (point: ClientPoint, draggedId: string): InsertionTarget | null => {
    const dragged = props.nodes.find((node) => node.nodeId === draggedId);
    const eligible = new Map<string, boolean>();
    if (dragged?.parentId && props.rects[dragged.parentId]) eligible.set(dragged.parentId, false);
    for (const container of props.containers) {
      if (!eligible.has(container.nodeId) && props.rects[container.nodeId]) {
        eligible.set(container.nodeId, container.direction === 'row');
      }
    }
    let best: { parentId: string; row: boolean } | null = null;
    for (const [parentId, row] of eligible) {
      if (parentId === draggedId) continue;
      const rect = props.rects[parentId];
      if (!rect || !contains(rect, point)) continue;
      if (!best || area(rect) < area(props.rects[best.parentId])) best = { parentId, row };
    }
    if (!best) return null;
    const children = orderedChildren(best.parentId, draggedId);
    const axis = best.row ? 'x' : 'y';
    const size = best.row ? 'width' : 'height';
    const index = children.filter((rect) => rect[axis] + rect[size] / 2 < point[axis]).length;
    return { parentId: best.parentId, index, row: best.row };
  };

  const existingPlacement = (nodeId: string): LayoutPlacement | undefined => props.placements.find((entry) => entry.nodeId === nodeId);

  const commit = (state: DragState): void => {
    const node = props.nodes.find((entry) => entry.nodeId === state.nodeId);
    const rect = props.rects[state.nodeId];
    if (!node || !rect) return;
    if (state.insertion) {
      const current = existingPlacement(node.nodeId);
      const placement = current?.mode === 'absolute'
        ? createPlacement(props.context, node.nodeId, current.label, { ...current, mode: 'flow', x: 0, y: 0 })
        : undefined;
      props.onMoveNode({ nodeId: node.nodeId, parentId: state.insertion.parentId, index: state.insertion.index, placement });
      return;
    }
    const moved = {
      x: rect.x + state.point.x - state.start.x,
      y: rect.y + state.point.y - state.start.y,
      width: rect.width,
      height: rect.height,
    };
    const parentRect = node.parentId && props.rects[node.parentId]
      ? props.rects[node.parentId]
      : { x: 0, y: 0, width: props.viewport.width, height: props.viewport.height };
    props.onPlaceNode(absolutePlacementFromRect(moved, parentRect, props.context, node.nodeId, node.label, existingPlacement(node.nodeId)));
  };

  const release = (state: DragState, event: PointerEvent): void => {
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture?.(state.pointerId)) target.releasePointerCapture(state.pointerId);
    drag.current = null;
    setPreview(null);
  };

  const renderInsertionLine = (target: InsertionTarget): JSX.Element | null => {
    const containerRect = props.rects[target.parentId];
    if (!containerRect) return null;
    const children = orderedChildren(target.parentId, preview?.nodeId ?? '');
    const between = (before: LayoutRect | undefined, after: LayoutRect | undefined, lead: 'x' | 'y', size: 'width' | 'height'): number => {
      if (!before && !after) return containerRect[lead];
      if (!before) return after![lead];
      if (!after) return before[lead] + before[size];
      return (before[lead] + before[size] + after[lead]) / 2;
    };
    const style = target.row
      ? {
        left: `${between(children[target.index - 1], children[target.index], 'x', 'width')}px`,
        top: `${containerRect.y}px`,
        width: '2px',
        height: `${containerRect.height}px`,
      }
      : {
        left: `${containerRect.x}px`,
        top: `${between(children[target.index - 1], children[target.index], 'y', 'height')}px`,
        width: `${containerRect.width}px`,
        height: '2px',
      };
    return <div class="editor-insertion-line" data-testid="insertion-line" style={style} />;
  };

  const selectedRect = props.selectedNodeId ? props.rects[props.selectedNodeId] : undefined;
  const movedRect = selectedRect && preview && preview.nodeId === props.selectedNodeId && !preview.insertion
    ? {
      x: selectedRect.x + preview.point.x - preview.start.x,
      y: selectedRect.y + preview.point.y - preview.start.y,
      width: selectedRect.width,
      height: selectedRect.height,
    }
    : selectedRect;

  return (
    <div
      class="editor-selection-overlay"
      data-testid="selection-overlay"
      data-active={props.active ? 'true' : 'false'}
      style={{ width: `${props.viewport.width}px`, height: `${props.viewport.height}px`, pointerEvents: props.active ? 'auto' : 'none' }}
      onPointerDown={(event) => {
        if (!props.active || event.button !== 0) return;
        event.preventDefault();
        const point = artboardPoint(event);
        const hit = hitTest(point);
        drag.current = {
          pointerId: event.pointerId,
          nodeId: hit?.nodeId ?? '',
          start: point,
          started: false,
          emptyClick: !hit,
          point,
          insertion: null,
        };
        if (hit) {
          props.onSelect(hit.nodeId);
          (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
        }
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state || state.pointerId !== event.pointerId) return;
        const point = artboardPoint(event);
        state.point = point;
        if (!state.started) {
          const distance = Math.hypot(point.x - state.start.x, point.y - state.start.y);
          if (distance < DRAG_THRESHOLD_PX) return;
          state.started = true;
        }
        state.insertion = state.nodeId ? resolveInsertion(point, state.nodeId) : null;
        if (state.nodeId) setPreview({ nodeId: state.nodeId, insertion: state.insertion, point, start: state.start });
      }}
      onPointerUp={(event) => {
        const state = drag.current;
        if (!state || state.pointerId !== event.pointerId) return;
        if (!state.started) {
          if (state.emptyClick) props.onSelect(null);
          release(state, event);
          return;
        }
        commit(state);
        release(state, event);
      }}
      onPointerCancel={(event) => {
        const state = drag.current;
        if (!state || state.pointerId !== event.pointerId) return;
        release(state, event);
      }}
    >
      {movedRect && props.selectedNodeId && (
        <div
          class="editor-selection-box"
          data-testid="selection-box"
          data-layout-node={props.selectedNodeId}
          style={{ left: `${movedRect.x}px`, top: `${movedRect.y}px`, width: `${movedRect.width}px`, height: `${movedRect.height}px` }}
        />
      )}
      {preview && preview.nodeId === props.selectedNodeId && !preview.insertion && (
        <div class="editor-free-mode" data-testid="free-mode">Свободное размещение</div>
      )}
      {preview?.insertion && renderInsertionLine(preview.insertion)}
    </div>
  );
}

import { useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { LayoutContainer, LayoutContext, LayoutPlacement } from '../../../design/schema.ts';
import type { LayoutNodeDescriptor } from '../../../design/layoutDom.ts';
import {
  RESIZE_HANDLES,
  resizePlacement,
  type LayoutConstraints,
  type ResizeHandle,
} from '../../../design/geometry.ts';
import {
  absolutePlacementFromRect,
  createPlacement,
  DRAG_THRESHOLD_PX,
  LAYOUT_GEOMETRY_LIMIT,
  placementToRect,
  rectSizeToUnits,
  screenToArtboard,
  type ClientPoint,
  type ClientRectLike,
  type LayoutRect,
} from '../layout/transactions.ts';
import { reduceSelection, type SelectionState } from '../layout/selection.ts';
import {
  collectGuides,
  findSnap,
  getSafeArea,
  snapToGrid,
  DEFAULT_GUIDE_SETTINGS,
  type GuideLine,
  type GuideSettings,
  type Rect,
} from '../layout/guides.ts';
import { isTvTarget } from '../../shared/routes.ts';

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
  guideSettings?: GuideSettings;
  selectedIds: string[];
  anchorId: string | null;
  getIframeRect(): ClientRectLike;
  onSelect(state: SelectionState): void;
  onMoveNode(args: MoveNodeArgs): void;
  onPlaceNode(placement: LayoutPlacement): void;
  onPlaceNodes(placements: LayoutPlacement[]): void;
}

interface InsertionTarget {
  parentId: string;
  index: number;
  row: boolean;
}

interface DragState {
  pointerId: number;
  nodeId: string;
  groupIds: string[];
  start: ClientPoint;
  started: boolean;
  emptyClick: boolean;
  marquee: boolean;
  point: ClientPoint;
  insertion: InsertionTarget | null;
  altKey: boolean;
}

interface DragPreview {
  nodeId: string;
  insertion: InsertionTarget | null;
  point: ClientPoint;
  start: ClientPoint;
  rect: LayoutRect | null;
  groupRects: Record<string, LayoutRect> | null;
  lines: GuideLine[];
}

interface ResizeState {
  pointerId: number;
  nodeId: string;
  handle: ResizeHandle;
  start: ClientPoint;
  point: ClientPoint;
  started: boolean;
}

function contains(rect: LayoutRect, point: ClientPoint): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function area(rect: LayoutRect): number {
  return rect.width * rect.height;
}

export function SelectionOverlay(props: SelectionOverlayProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState | null>(null);
  const resize = useRef<ResizeState | null>(null);
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const [resizeRect, setResizeRect] = useState<LayoutRect | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<LayoutRect | null>(null);

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
    const draggedAbsolute = existingPlacement(draggedId)?.mode === 'absolute';
    // A node never inserts into itself or its own descendant: the recorded order would make the
    // runtime reparent it into its subtree and throw HierarchyRequestError.
    const insideDragged = (nodeId: string): boolean => {
      let current = props.nodes.find((node) => node.nodeId === nodeId)?.parentId ?? null;
      while (current) {
        if (current === draggedId) return true;
        current = props.nodes.find((node) => node.nodeId === current)?.parentId ?? null;
      }
      return false;
    };
    const eligible = new Map<string, boolean>();
    // Dragging an absolute node repositions it: only a drop into another recorded container is an
    // explicit flow insertion, so its own parent never offers one.
    if (!draggedAbsolute && dragged?.parentId && props.rects[dragged.parentId]) {
      const recorded = props.containers.find((container) => container.nodeId === dragged!.parentId);
      eligible.set(dragged.parentId, recorded?.direction === 'row');
    }
    for (const container of props.containers) {
      if (draggedAbsolute && container.nodeId === dragged?.parentId) continue;
      if (!eligible.has(container.nodeId) && props.rects[container.nodeId]) {
        eligible.set(container.nodeId, container.direction === 'row');
      }
    }
    let best: { parentId: string; row: boolean } | null = null;
    for (const [parentId, row] of eligible) {
      if (parentId === draggedId || insideDragged(parentId)) continue;
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

  const anchorId = props.selectedIds.length
    ? (props.anchorId && props.selectedIds.includes(props.anchorId) ? props.anchorId : props.selectedIds[props.selectedIds.length - 1])
    : null;

  const marqueeIds = (rect: LayoutRect): string[] => {
    const overlaps = (other: LayoutRect): boolean =>
      rect.x < other.x + other.width && rect.x + rect.width > other.x
        && rect.y < other.y + other.height && rect.y + rect.height > other.y;
    return props.nodes
      .filter((node) => node.parentId !== null && props.rects[node.nodeId] && overlaps(props.rects[node.nodeId]))
      .map((node) => node.nodeId);
  };

  const selectionState = (): SelectionState => ({ ids: props.selectedIds, anchorId: props.anchorId });

  const nodeParentRect = (node: LayoutNodeDescriptor): LayoutRect => (node.parentId && props.rects[node.parentId]
    ? props.rects[node.parentId]
    : { x: 0, y: 0, width: props.viewport.width, height: props.viewport.height });

  const zoomScale = props.zoom > 0 ? props.zoom : 1;
  const safeAreaRect = (): Rect => getSafeArea(props.context.target, props.viewport);
  const artboardRect = (): Rect => ({ x: 0, y: 0, width: props.viewport.width, height: props.viewport.height });
  const overflowsSafeArea = (rect: LayoutRect): boolean => {
    const safe = safeAreaRect();
    return rect.x < safe.x || rect.y < safe.y
      || rect.x + rect.width > safe.x + safe.width
      || rect.y + rect.height > safe.y + safe.height;
  };

  // Snapping runs in native artboard coordinates: the CSS scale of the canvas handles rendering,
  // so the same threshold works at any zoom. Alt held anywhere during the drag disables snapping,
  // and the grid only fills axes where no element, safe-area or artboard line matched.
  const guideSettings = props.guideSettings ?? DEFAULT_GUIDE_SETTINGS;
  const snapDragRect = (moved: LayoutRect, nodeId: string, altKey: boolean): { rect: LayoutRect; lines: GuideLine[] } => {
    if (altKey || !guideSettings.snapToGuides) return { rect: moved, lines: [] };
    const rects = Object.entries(props.rects)
      .filter(([id, rect]) => id !== nodeId && Boolean(rect))
      .map(([, rect]) => rect as Rect);
    const snap = findSnap(
      { x: moved.x, y: moved.y },
      [moved],
      collectGuides(rects, { safeArea: safeAreaRect(), artboard: artboardRect() }),
      guideSettings.snapThreshold,
    );
    let { x, y } = moved;
    if (snap.x !== null) x = snap.x;
    else if (guideSettings.snapToGrid) x = snapToGrid(x, guideSettings.gridSize);
    if (snap.y !== null) y = snap.y;
    else if (guideSettings.snapToGrid) y = snapToGrid(y, guideSettings.gridSize);
    return { rect: { ...moved, x, y }, lines: snap.lines };
  };

  // One snapped movement for the whole group, solved once and shared by the live preview and the
  // commit: the same outermost members move, the same guides are excluded and the same leader is
  // snapped, so what the user sees is exactly what lands in the draft. A drag that starts on a
  // selected descendant leads through its outermost selected ancestor, otherwise snapping would
  // silently disable because the hit node never moves on its own.
  const groupLeader = (members: string[], hitId: string): string => {
    if (members.includes(hitId)) return hitId;
    const nodeById = new Map(props.nodes.map((node) => [node.nodeId, node]));
    const containsHit = (id: string): boolean => {
      let current = nodeById.get(hitId)?.parentId ?? null;
      while (current) {
        if (current === id) return true;
        current = nodeById.get(current)?.parentId ?? null;
      }
      return false;
    };
    return members.find(containsHit) ?? members[0];
  };

  const groupSnapDelta = (members: string[], leaderId: string, delta: ClientPoint, altKey: boolean): { dx: number; dy: number; lines: GuideLine[] } => {
    if (altKey || !guideSettings.snapToGuides) return { dx: 0, dy: 0, lines: [] };
    const leaderBase = resolvedRect(leaderId);
    if (!leaderBase) return { dx: 0, dy: 0, lines: [] };
    const moved = { x: leaderBase.x + delta.x, y: leaderBase.y + delta.y, width: leaderBase.width, height: leaderBase.height };
    const memberSet = new Set(members);
    const guideRects = Object.entries(props.rects)
      .filter(([id, rect]) => !memberSet.has(id) && Boolean(rect))
      .map(([, rect]) => rect as Rect);
    const snap = findSnap(
      { x: moved.x, y: moved.y },
      [moved],
      collectGuides(guideRects, { safeArea: safeAreaRect(), artboard: artboardRect() }),
      guideSettings.snapThreshold,
    );
    let dx = 0;
    let dy = 0;
    if (snap.x !== null) dx = snap.x - moved.x;
    else if (guideSettings.snapToGrid) dx = snapToGrid(moved.x, guideSettings.gridSize) - moved.x;
    if (snap.y !== null) dy = snap.y - moved.y;
    else if (guideSettings.snapToGrid) dy = snapToGrid(moved.y, guideSettings.gridSize) - moved.y;
    return { dx, dy, lines: snap.lines };
  };

  interface GroupMove {
    members: string[];
    dx: number;
    dy: number;
    lines: GuideLine[];
  }

  const resolveGroupMove = (groupIds: string[], hitId: string, delta: ClientPoint, altKey: boolean): GroupMove => {
    const members = outermostGroupMembers(groupIds.length ? groupIds : [hitId]);
    const leader = groupLeader(members, hitId);
    const snap = groupSnapDelta(members, leader, delta, altKey);
    return { members, dx: delta.x + snap.dx, dy: delta.y + snap.dy, lines: snap.lines };
  };

  // Only the outermost selected nodes move: a selected descendant of another selected node rides
  // along inside its parent, and rewriting its placement against the parent old rect would shift
  // it a second time when the runtime applies both records.
  const outermostGroupMembers = (ids: string[]): string[] => {
    const idSet = new Set(ids);
    const nodeById = new Map(props.nodes.map((node) => [node.nodeId, node]));
    return ids.filter((id) => {
      let current = nodeById.get(id)?.parentId ?? null;
      while (current) {
        if (idSet.has(current)) return false;
        current = nodeById.get(current)?.parentId ?? null;
      }
      return true;
    });
  };

  // The selection box follows the committed placement geometry for absolute nodes so the
  // handles and the numeric inspector agree with the draft even before the preview repaints.
  const resolvedRect = (nodeId: string): LayoutRect | undefined => {
    const rect = props.rects[nodeId];
    if (!rect) return undefined;
    const node = props.nodes.find((entry) => entry.nodeId === nodeId);
    const placement = existingPlacement(nodeId);
    if (node?.parentId && placement?.mode === 'absolute' && props.rects[node.parentId]) {
      return placementToRect(placement, props.rects[node.parentId], rect);
    }
    return rect;
  };

  const resizeConstraints = (placement: LayoutPlacement | undefined, parentRect: LayoutRect): LayoutConstraints => {
    const toPx = (value: number | 'auto' | undefined, size: number): number | undefined =>
      typeof value === 'number' ? (value / LAYOUT_GEOMETRY_LIMIT) * size : undefined;
    return {
      minWidth: toPx(placement?.minWidth, parentRect.width),
      maxWidth: toPx(placement?.maxWidth, parentRect.width),
      minHeight: toPx(placement?.minHeight, parentRect.height),
      maxHeight: toPx(placement?.maxHeight, parentRect.height),
    };
  };

  const commitResize = (state: ResizeState, rect: LayoutRect): void => {
    const node = props.nodes.find((entry) => entry.nodeId === state.nodeId);
    if (!node) return;
    const parentRect = nodeParentRect(node);
    const placement = absolutePlacementFromRect(rect, parentRect, props.context, node.nodeId, node.label, existingPlacement(node.nodeId));
    props.onPlaceNode({
      ...placement,
      width: rectSizeToUnits(rect.width, parentRect.width),
      height: rectSizeToUnits(rect.height, parentRect.height),
    });
  };

  const commit = (state: DragState): void => {
    const node = props.nodes.find((entry) => entry.nodeId === state.nodeId);
    const rect = resolvedRect(state.nodeId);
    if (!node || !rect) return;
    if (state.insertion) {
      const current = existingPlacement(node.nodeId);
      const placement = current?.mode === 'absolute'
        ? createPlacement(props.context, node.nodeId, current.label, { ...current, mode: 'flow', x: 0, y: 0 })
        : undefined;
      props.onMoveNode({ nodeId: node.nodeId, parentId: state.insertion.parentId, index: state.insertion.index, placement });
      return;
    }
    const delta = { x: state.point.x - state.start.x, y: state.point.y - state.start.y };
    // A drag that started on a selected node moves the whole absolute group: every outermost
    // member follows the same snapped movement and all placements land in one update, so one undo
    // restores the group and the spacing between members never shears.
    const move = resolveGroupMove(state.groupIds, state.nodeId, delta, state.altKey);
    const placements: LayoutPlacement[] = [];
    for (const memberId of move.members) {
      const member = props.nodes.find((entry) => entry.nodeId === memberId);
      const memberRect = resolvedRect(memberId);
      if (!member || !memberRect) continue;
      const moved = {
        x: memberRect.x + move.dx,
        y: memberRect.y + move.dy,
        width: memberRect.width,
        height: memberRect.height,
      };
      placements.push(absolutePlacementFromRect(moved, nodeParentRect(member), props.context, member.nodeId, member.label, existingPlacement(member.nodeId)));
    }
    if (placements.length === 1) props.onPlaceNode(placements[0]);
    else if (placements.length > 1) props.onPlaceNodes(placements);
  };

  const release = (state: DragState, event: PointerEvent): void => {
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture?.(state.pointerId)) target.releasePointerCapture(state.pointerId);
    drag.current = null;
    setPreview(null);
    setMarqueeRect(null);
  };

  const releaseResize = (state: ResizeState, event: PointerEvent): void => {
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture?.(state.pointerId)) target.releasePointerCapture(state.pointerId);
    resize.current = null;
    setResizeRect(null);
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

  const selectedRect = anchorId ? resolvedRect(anchorId) : undefined;
  const movedRect = selectedRect && preview && preview.nodeId === anchorId && !preview.insertion
    ? (preview.rect ?? {
      x: selectedRect.x + preview.point.x - preview.start.x,
      y: selectedRect.y + preview.point.y - preview.start.y,
      width: selectedRect.width,
      height: selectedRect.height,
    })
    : selectedRect;
  const displayRect = resizeRect ?? movedRect;
  const selectedNode = anchorId ? props.nodes.find((entry) => entry.nodeId === anchorId) : undefined;
  const selectedPlacement = anchorId ? existingPlacement(anchorId) : undefined;
  const showResizeHandles = Boolean(
    props.active
    && displayRect
    && selectedNode
    && props.selectedIds.length === 1
    && selectedPlacement?.mode === 'absolute'
    && !preview
    && !resizeRect,
  );

  const startResize = (event: PointerEvent, handle: ResizeHandle): void => {
    if (!props.active || event.button !== 0 || !anchorId) return;
    event.preventDefault();
    event.stopPropagation();
    const state: ResizeState = {
      pointerId: event.pointerId,
      nodeId: anchorId,
      handle,
      start: artboardPoint(event),
      point: artboardPoint(event),
      started: false,
    };
    resize.current = state;
    rootRef.current?.setPointerCapture?.(event.pointerId);
  };

  const handlePositions: Record<ResizeHandle, { left: string; top: string; cursor: string }> = {
    nw: { left: '0px', top: '0px', cursor: 'nwse-resize' },
    n: { left: '50%', top: '0px', cursor: 'ns-resize' },
    ne: { left: '100%', top: '0px', cursor: 'nesw-resize' },
    e: { left: '100%', top: '50%', cursor: 'ew-resize' },
    se: { left: '100%', top: '100%', cursor: 'nwse-resize' },
    s: { left: '50%', top: '100%', cursor: 'ns-resize' },
    sw: { left: '0px', top: '100%', cursor: 'nesw-resize' },
    w: { left: '0px', top: '50%', cursor: 'ew-resize' },
  };

  return (
    <div
      ref={rootRef}
      class="editor-selection-overlay"
      data-testid="selection-overlay"
      data-active={props.active ? 'true' : 'false'}
      style={{ width: `${props.viewport.width}px`, height: `${props.viewport.height}px`, pointerEvents: props.active ? 'auto' : 'none' }}
      onPointerDown={(event) => {
        if (!props.active || event.button !== 0) return;
        event.preventDefault();
        const point = artboardPoint(event);
        const hit = hitTest(point);
        if (event.shiftKey && hit) {
          props.onSelect(reduceSelection(selectionState(), { type: 'toggle', id: hit.nodeId }));
          return;
        }
        let groupIds: string[] = [];
        if (hit && props.selectedIds.includes(hit.nodeId) && existingPlacement(hit.nodeId)?.mode === 'absolute') {
          const members = props.selectedIds.filter((id) => existingPlacement(id)?.mode === 'absolute');
          if (members.length > 1) groupIds = members;
        }
        drag.current = {
          pointerId: event.pointerId,
          nodeId: hit?.nodeId ?? '',
          groupIds,
          start: point,
          started: false,
          emptyClick: !hit,
          marquee: false,
          point,
          insertion: null,
          altKey: event.altKey,
        };
        if (hit) {
          // A drag starting on an already selected node keeps the group; only a fresh hit
          // replaces the selection with the single node under the pointer.
          if (!groupIds.length) props.onSelect({ ids: [hit.nodeId], anchorId: hit.nodeId });
          (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
        }
      }}
      onPointerMove={(event) => {
        const resizing = resize.current;
        if (resizing && resizing.pointerId === event.pointerId) {
          const point = artboardPoint(event);
          resizing.point = point;
          if (!resizing.started) {
            const distance = Math.hypot(point.x - resizing.start.x, point.y - resizing.start.y);
            if (distance < DRAG_THRESHOLD_PX) return;
            resizing.started = true;
          }
          const node = props.nodes.find((entry) => entry.nodeId === resizing.nodeId);
          const base = resolvedRect(resizing.nodeId);
          if (!node || !base) return;
          setResizeRect(resizePlacement(
            base,
            resizing.handle,
            { x: point.x - resizing.start.x, y: point.y - resizing.start.y },
            resizeConstraints(existingPlacement(resizing.nodeId), nodeParentRect(node)),
          ));
          return;
        }
        const state = drag.current;
        if (!state || state.pointerId !== event.pointerId) return;
        const point = artboardPoint(event);
        state.point = point;
        state.altKey = event.altKey;
        if (!state.started) {
          const distance = Math.hypot(point.x - state.start.x, point.y - state.start.y);
          if (distance < DRAG_THRESHOLD_PX) return;
          state.started = true;
        }
        if (!state.nodeId) {
          state.marquee = true;
          setMarqueeRect({
            x: Math.min(state.start.x, point.x),
            y: Math.min(state.start.y, point.y),
            width: Math.abs(point.x - state.start.x),
            height: Math.abs(point.y - state.start.y),
          });
          return;
        }
        if (state.groupIds.length) {
          state.insertion = null;
          const move = resolveGroupMove(state.groupIds, state.nodeId, { x: point.x - state.start.x, y: point.y - state.start.y }, event.altKey);
          const groupRects: Record<string, LayoutRect> = {};
          for (const memberId of state.groupIds) {
            const base = resolvedRect(memberId);
            if (base) {
              groupRects[memberId] = { x: base.x + move.dx, y: base.y + move.dy, width: base.width, height: base.height };
            }
          }
          setPreview({ nodeId: state.nodeId, insertion: null, point, start: state.start, rect: groupRects[state.nodeId] ?? null, groupRects, lines: move.lines });
          return;
        }
        state.insertion = resolveInsertion(point, state.nodeId);
        if (state.insertion) {
          setPreview({ nodeId: state.nodeId, insertion: state.insertion, point, start: state.start, rect: null, groupRects: null, lines: [] });
          return;
        }
        const base = resolvedRect(state.nodeId);
        if (!base) return;
        const snapped = snapDragRect(
          {
            x: base.x + point.x - state.start.x,
            y: base.y + point.y - state.start.y,
            width: base.width,
            height: base.height,
          },
          state.nodeId,
          event.altKey,
        );
        setPreview({ nodeId: state.nodeId, insertion: null, point, start: state.start, rect: snapped.rect, groupRects: null, lines: snapped.lines });
      }}
      onPointerUp={(event) => {
        const resizing = resize.current;
        if (resizing && resizing.pointerId === event.pointerId) {
          if (resizing.started) {
            const node = props.nodes.find((entry) => entry.nodeId === resizing.nodeId);
            const base = resolvedRect(resizing.nodeId);
            if (node && base) {
              commitResize(resizing, resizePlacement(
                base,
                resizing.handle,
                { x: resizing.point.x - resizing.start.x, y: resizing.point.y - resizing.start.y },
                resizeConstraints(existingPlacement(resizing.nodeId), nodeParentRect(node)),
              ));
            }
          }
          releaseResize(resizing, event);
          return;
        }
        const state = drag.current;
        if (!state || state.pointerId !== event.pointerId) return;
        if (!state.started) {
          if (state.emptyClick) props.onSelect({ ids: [], anchorId: null });
          release(state, event);
          return;
        }
        if (state.marquee) {
          const ids = marqueeIds({
            x: Math.min(state.start.x, state.point.x),
            y: Math.min(state.start.y, state.point.y),
            width: Math.abs(state.point.x - state.start.x),
            height: Math.abs(state.point.y - state.start.y),
          });
          props.onSelect(reduceSelection(selectionState(), { type: 'range', ids }));
          release(state, event);
          return;
        }
        commit(state);
        release(state, event);
      }}
      onPointerCancel={(event) => {
        const resizing = resize.current;
        if (resizing && resizing.pointerId === event.pointerId) {
          releaseResize(resizing, event);
          return;
        }
        const state = drag.current;
        if (!state || state.pointerId !== event.pointerId) return;
        release(state, event);
      }}
    >
      {isTvTarget(props.context.target) && (() => {
        const safe = safeAreaRect();
        return (
          <div
            class="editor-safe-area"
            data-testid="safe-area"
            style={{ left: `${safe.x}px`, top: `${safe.y}px`, width: `${safe.width}px`, height: `${safe.height}px` }}
          />
        );
      })()}
      {guideSettings.showGrid && (
        <div
          class="editor-grid-layer"
          data-testid="grid-layer"
          style={{ backgroundSize: `${guideSettings.gridSize}px ${guideSettings.gridSize}px` }}
        />
      )}
      {preview?.lines.map((guide, index) => (guide.axis === 'x' ? (
        <div
          key={index}
          class="editor-guide-line"
          data-testid="guide-line"
          data-axis="x"
          style={{ left: `${guide.position}px`, top: '0px', width: `${1 / zoomScale}px`, height: '100%' }}
        />
      ) : (
        <div
          key={index}
          class="editor-guide-line"
          data-testid="guide-line"
          data-axis="y"
          style={{ top: `${guide.position}px`, left: '0px', height: `${1 / zoomScale}px`, width: '100%' }}
        />
      )))}
      {props.selectedIds.map((nodeId) => {
        const rect = preview?.groupRects?.[nodeId] ?? (nodeId === anchorId ? displayRect : resolvedRect(nodeId));
        if (!rect) return null;
        return (
          <div
            class="editor-selection-box"
            data-testid="selection-box"
            data-anchor={nodeId === anchorId ? 'true' : 'false'}
            data-layout-node={nodeId}
            data-safe-overflow={overflowsSafeArea(rect) ? 'true' : 'false'}
            style={{ left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` }}
          >
            {nodeId === anchorId && showResizeHandles && RESIZE_HANDLES.map((handle) => (
              <span
                key={handle}
                class="editor-resize-handle"
                data-testid="resize-handle"
                data-handle={handle}
                style={{ left: handlePositions[handle].left, top: handlePositions[handle].top, cursor: handlePositions[handle].cursor }}
                onPointerDown={(event) => startResize(event, handle)}
              />
            ))}
          </div>
        );
      })}
      {marqueeRect && (
        <div
          class="editor-marquee-rect"
          data-testid="marquee-rect"
          style={{ left: `${marqueeRect.x}px`, top: `${marqueeRect.y}px`, width: `${marqueeRect.width}px`, height: `${marqueeRect.height}px` }}
        />
      )}
      {preview && !preview.insertion && (
        <div class="editor-free-mode" data-testid="free-mode">Свободное размещение</div>
      )}
      {preview?.insertion && renderInsertionLine(preview.insertion)}
    </div>
  );
}

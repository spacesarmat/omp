import type { LayoutAlignment, LayoutDistribution, LayoutPlacement } from '../../../design/schema.ts';
import { LAYOUT_GEOMETRY_LIMIT, type LayoutRect } from './transactions.ts';

export interface SelectionState {
  ids: string[];
  anchorId: string | null;
}

export type SelectionAction =
  | { type: 'select'; id: string | null }
  | { type: 'toggle'; id: string }
  | { type: 'range'; ids: string[] }
  | { type: 'prune'; liveIds: string[] };

export function reduceSelection(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'select':
      return action.id ? { ids: [action.id], anchorId: action.id } : { ids: [], anchorId: null };
    case 'toggle': {
      if (state.ids.includes(action.id)) {
        const ids = state.ids.filter((id) => id !== action.id);
        const anchorId = state.anchorId === action.id ? (ids[ids.length - 1] ?? null) : state.anchorId;
        return { ids, anchorId: ids.length ? anchorId : null };
      }
      return { ids: [...state.ids, action.id], anchorId: action.id };
    }
    case 'range':
      return { ids: [...action.ids], anchorId: action.ids.length ? action.ids[action.ids.length - 1] : null };
    case 'prune': {
      const live = new Set(action.liveIds);
      const ids = state.ids.filter((id) => live.has(id));
      const anchorId = state.anchorId && live.has(state.anchorId) ? state.anchorId : (ids[ids.length - 1] ?? null);
      return { ids, anchorId: ids.length ? anchorId : null };
    }
  }
}

export type SelectionAlignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

// Flow containers speak the schema alignment vocabulary, absolute coordinates use edge names.
export function flowAlignmentFor(alignment: SelectionAlignment): LayoutAlignment {
  if (alignment === 'left' || alignment === 'top') return 'start';
  if (alignment === 'right' || alignment === 'bottom') return 'end';
  return 'center';
}

// The start/center/end buttons drive the container main axis through justify-content, which
// speaks the same value space as alignment for those three names.
export function flowDistributionFor(alignment: SelectionAlignment): LayoutDistribution {
  const flow = flowAlignmentFor(alignment);
  return flow === 'stretch' ? 'start' : flow;
}

export function alignmentAxisOf(alignment: SelectionAlignment): 'x' | 'y' {
  return alignment === 'left' || alignment === 'center' || alignment === 'right' ? 'x' : 'y';
}

type Axis = 'x' | 'y';

function axisOf(alignment: SelectionAlignment): Axis {
  return alignment === 'left' || alignment === 'center' || alignment === 'right' ? 'x' : 'y';
}

function anchorAtEnd(placement: LayoutPlacement, axis: Axis): boolean {
  return axis === 'x'
    ? placement.anchor === 'top-right' || placement.anchor === 'bottom-right'
    : placement.anchor === 'bottom-left' || placement.anchor === 'bottom-right';
}

function sizeOf(placement: LayoutPlacement, axis: Axis): number | null {
  const size = axis === 'x' ? placement.width : placement.height;
  return typeof size === 'number' ? size : null;
}

function leadOf(placement: LayoutPlacement, axis: Axis): number | null {
  const size = sizeOf(placement, axis);
  if (size === null) return null;
  const offset = axis === 'x' ? placement.x : placement.y;
  return anchorAtEnd(placement, axis) ? LAYOUT_GEOMETRY_LIMIT - offset - size : offset;
}

function withLead(placement: LayoutPlacement, axis: Axis, lead: number): LayoutPlacement {
  const size = sizeOf(placement, axis)!;
  const clamped = Math.min(LAYOUT_GEOMETRY_LIMIT, Math.max(0, Math.round(lead)));
  if (axis === 'x') {
    return anchorAtEnd(placement, axis)
      ? { ...placement, x: LAYOUT_GEOMETRY_LIMIT - clamped - size }
      : { ...placement, x: clamped };
  }
  return anchorAtEnd(placement, axis)
    ? { ...placement, y: LAYOUT_GEOMETRY_LIMIT - clamped - size }
    : { ...placement, y: clamped };
}

function trailOf(placement: LayoutPlacement, axis: Axis): number | null {
  const lead = leadOf(placement, axis);
  return lead === null ? null : lead + sizeOf(placement, axis)!;
}

function participating(placements: LayoutPlacement[], axis: Axis): LayoutPlacement[] {
  return placements.filter((placement) => !placement.locked && leadOf(placement, axis) !== null);
}

// Group alignment works in fixed-point percent units so anchors cancel out: every offset is
// rewritten against the shared min/max edge of the participating nodes.
export function alignPlacements(placements: LayoutPlacement[], alignment: SelectionAlignment): LayoutPlacement[] {
  const axis = axisOf(alignment);
  const items = participating(placements, axis);
  if (items.length < 2) return [...placements];
  const leads = items.map((placement) => leadOf(placement, axis)!);
  const min = Math.min(...leads);
  const max = Math.max(...items.map((placement) => trailOf(placement, axis)!));
  const center = (min + max) / 2;
  const byNode = new Map(items.map((placement) => {
    const size = sizeOf(placement, axis)!;
    const lead = alignment === 'left' || alignment === 'top'
      ? min
      : alignment === 'right' || alignment === 'bottom'
        ? max - size
        : center - size / 2;
    return [placement.nodeId, lead];
  }));
  return placements.map((placement) => {
    if (!byNode.has(placement.nodeId)) return placement;
    return withLead(placement, axis, byNode.get(placement.nodeId)!);
  });
}

// Equal gaps between the participating nodes along the axis: the span from the first lead to the
// last trail is divided evenly. Nodes without an explicit size and locked nodes stay untouched.
export function distributePlacements(placements: LayoutPlacement[], axis: Axis): LayoutPlacement[] {
  const items = participating(placements, axis);
  if (items.length < 2) return [...placements];
  const sorted = [...items].sort((a, b) => leadOf(a, axis)! - leadOf(b, axis)!);
  const first = leadOf(sorted[0], axis)!;
  const last = trailOf(sorted[sorted.length - 1], axis)!;
  const totalSize = sorted.reduce((sum, placement) => sum + sizeOf(placement, axis)!, 0);
  const gap = (last - first - totalSize) / (sorted.length - 1);
  const next = new Map<string, number>();
  let cursor = first;
  for (const placement of sorted) {
    next.set(placement.nodeId, cursor);
    cursor += sizeOf(placement, axis)! + gap;
  }
  return placements.map((placement) => {
    if (!next.has(placement.nodeId)) return placement;
    return withLead(placement, axis, next.get(placement.nodeId)!);
  });
}

// Absolute nodes may sit in different parents, where percent units are not comparable, so group
// edits align the measured artboard rectangles in pixels; the caller converts every result back
// through the node's own parent rect.
export function alignRects(rects: LayoutRect[], alignment: SelectionAlignment): LayoutRect[] {
  const axis = axisOf(alignment);
  if (rects.length < 2) return [...rects];
  const lead = (rect: LayoutRect): number => (axis === 'x' ? rect.x : rect.y);
  const size = (rect: LayoutRect): number => (axis === 'x' ? rect.width : rect.height);
  const min = Math.min(...rects.map(lead));
  const max = Math.max(...rects.map((rect) => lead(rect) + size(rect)));
  const center = (min + max) / 2;
  return rects.map((rect) => {
    const target = alignment === 'left' || alignment === 'top'
      ? min
      : alignment === 'right' || alignment === 'bottom'
        ? max - size(rect)
        : center - size(rect) / 2;
    return axis === 'x' ? { ...rect, x: target } : { ...rect, y: target };
  });
}

export function distributeRects(rects: LayoutRect[], axis: Axis): LayoutRect[] {
  if (rects.length < 2) return [...rects];
  const lead = (rect: LayoutRect): number => (axis === 'x' ? rect.x : rect.y);
  const size = (rect: LayoutRect): number => (axis === 'x' ? rect.width : rect.height);
  const sorted = [...rects].sort((a, b) => lead(a) - lead(b));
  const first = lead(sorted[0]);
  const last = lead(sorted[sorted.length - 1]) + size(sorted[sorted.length - 1]);
  const totalSize = sorted.reduce((sum, rect) => sum + size(rect), 0);
  const gap = (last - first - totalSize) / (sorted.length - 1);
  const next = new Map<LayoutRect, number>();
  let cursor = first;
  for (const rect of sorted) {
    next.set(rect, cursor);
    cursor += size(rect) + gap;
  }
  return rects.map((rect) => {
    const at = next.get(rect)!;
    return axis === 'x' ? { ...rect, x: at } : { ...rect, y: at };
  });
}

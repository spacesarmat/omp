import type { LayoutAnchor } from './schema.ts';

export interface GeometryRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const RESIZE_HANDLES: readonly ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

// Documented size bounds in artboard pixels; resize math clamps to them and never
// lets a drag cross the fixed anchor (sizes below the minimum collapse to it).
export interface LayoutConstraints {
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
}

export function oppositeAnchor(handle: ResizeHandle): LayoutAnchor {
  const vertical = handle.includes('s') ? 'top' : 'bottom';
  const horizontal = handle.includes('e') ? 'left' : 'right';
  return `${vertical}-${horizontal}` as LayoutAnchor;
}

function clampSize(value: number, min: number | undefined, max: number | undefined): number {
  const lower = min ?? 0;
  const upper = Math.max(lower, max ?? Number.POSITIVE_INFINITY);
  return Math.min(upper, Math.max(lower, value));
}

export function resizePlacement(
  placement: GeometryRect,
  handle: ResizeHandle,
  delta: { x: number; y: number },
  constraints: LayoutConstraints = {},
): GeometryRect {
  const right = placement.x + placement.width;
  const bottom = placement.y + placement.height;
  const width = clampSize(
    placement.width + (handle.includes('e') ? delta.x : 0) - (handle.includes('w') ? delta.x : 0),
    constraints.minWidth,
    constraints.maxWidth,
  );
  const height = clampSize(
    placement.height + (handle.includes('s') ? delta.y : 0) - (handle.includes('n') ? delta.y : 0),
    constraints.minHeight,
    constraints.maxHeight,
  );
  return {
    x: handle.includes('w') ? right - width : placement.x,
    y: handle.includes('n') ? bottom - height : placement.y,
    width,
    height,
  };
}

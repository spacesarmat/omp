/** Horizontal swipe on a catalog row. A vertical move stays a scroll and does not open actions. */

export const ROW_SLOP = 10;
/** |dx| must beat |dy| by this much before the row claims the finger. */
export const ROW_DOMINANCE = 1.5;
/** A left drag at least this far opens the actions. A shorter one snaps shut. */
export const ROW_OPEN_AT = 56;
/** How far the row slides when the actions are open. */
export const ROW_REVEAL = 168;

export type RowPhase = 'pending' | 'horizontal' | 'vertical';

export interface RowGesture {
  phase: RowPhase;
  x0: number;
  y0: number;
  dx: number;
  open: boolean;
}

export function beginRowSwipe(x: number, y: number, open: boolean): RowGesture {
  return { phase: 'pending', x0: x, y0: y, dx: 0, open: open };
}

/** Locks the direction once the finger leaves the slop. A vertical lock never slides the row. */
export function moveRowSwipe(g: RowGesture, x: number, y: number): RowGesture {
  if (g.phase === 'vertical') return g;
  const dx = x - g.x0;
  const dy = y - g.y0;
  if (g.phase === 'pending') {
    if (Math.abs(dx) < ROW_SLOP && Math.abs(dy) < ROW_SLOP) return g;
    if (Math.abs(dx) < Math.abs(dy) * ROW_DOMINANCE) return { ...g, phase: 'vertical', dx: 0 };
    return { ...g, phase: 'horizontal', dx: dx };
  }
  return { ...g, dx: dx };
}

/** Left past the threshold opens. A rightward move closes. Anything else keeps the previous state. */
export function endRowSwipe(g: RowGesture): 'open' | 'closed' {
  if (g.phase !== 'horizontal') return g.open ? 'open' : 'closed';
  if (g.dx <= -ROW_OPEN_AT) return 'open';
  if (g.dx >= ROW_SLOP) return 'closed';
  return g.open ? 'open' : 'closed';
}

/** Pixel shift of the row while the finger is down. It never slides past the actions or to the right of rest. */
export function rowSwipeVisual(g: RowGesture): number {
  const base = g.open ? -ROW_REVEAL : 0;
  if (g.phase !== 'horizontal') return base;
  let x = base + g.dx;
  if (x > 0) x = 0;
  if (x < -ROW_REVEAL) x = -ROW_REVEAL;
  return x;
}

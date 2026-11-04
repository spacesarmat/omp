/** Horizontal swipe on a subscription card. A vertical move stays a scroll. */

/** px of movement before the gesture is told from a tap. */
export const SUB_SWIPE_SLOP = 10;
/** |dx| must be at least this many times |dy| before the swipe claims the finger. */
export const SUB_SWIPE_DOMINANCE = 1.5;
/** px past which a release runs the action. A shorter release snaps back. */
export const SUB_SWIPE_THRESHOLD = 72;
/** The card does not follow the finger past this. */
export const SUB_SWIPE_MAX = 112;

export type SubSwipeAction = 'check' | 'delete';
export type SubSwipePhase = 'pending' | 'horizontal' | 'vertical';

export interface SubSwipe {
  phase: SubSwipePhase;
  x0: number;
  y0: number;
  dx: number;
}

export function beginSubSwipe(x: number, y: number): SubSwipe {
  return { phase: 'pending', x0: x, y0: y, dx: 0 };
}

/** Moves the gesture. A vertical-dominant move is latched as a scroll and dx stays 0. */
export function moveSubSwipe(s: SubSwipe, x: number, y: number): SubSwipe {
  if (s.phase === 'vertical') return s;
  const dx = x - s.x0;
  const dy = y - s.y0;
  if (s.phase === 'pending') {
    if (Math.abs(dx) < SUB_SWIPE_SLOP && Math.abs(dy) < SUB_SWIPE_SLOP) return s;
    if (Math.abs(dx) < Math.abs(dy) * SUB_SWIPE_DOMINANCE) return { ...s, phase: 'vertical', dx: 0 };
    return { ...s, phase: 'horizontal', dx: dx };
  }
  return { ...s, dx: dx };
}

/** Right past the threshold checks, left past it deletes, otherwise the card snaps back. */
export function subSwipeAction(dx: number): SubSwipeAction | null {
  if (dx >= SUB_SWIPE_THRESHOLD) return 'check';
  if (dx <= -SUB_SWIPE_THRESHOLD) return 'delete';
  return null;
}

/** How far the card is drawn. Past the max it stays put. */
export function subSwipeVisual(dx: number): number {
  if (dx > SUB_SWIPE_MAX) return SUB_SWIPE_MAX;
  if (dx < -SUB_SWIPE_MAX) return -SUB_SWIPE_MAX;
  return dx;
}

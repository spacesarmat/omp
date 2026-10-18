/**
 * Phone coach marks. TV never mounts these.
 * A sheet, dialog, or the first-run tour blocks every hint until it is gone; the hint stays unseen, so it shows afterwards.
 */
export const HINT_OVERLAY = '[role="dialog"], [aria-modal="true"]';

export function hintBlockedByOverlay(root: ParentNode): boolean {
  return root.querySelector(HINT_OVERLAY) != null;
}

export interface HintBox {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface HintSpot {
  top: number;
  left: number;
  place: 'above' | 'below';
  /** Pixels from the bubble's left edge to the arrow, aimed at the target's center. */
  arrow: number;
}

export const HINT_MARGIN = 16;
export const HINT_GAP = 10;
export const HINT_MAX_W = 280;
/** Gap kept inside the safe area so the bubble does not touch the status bar or the gesture inset. */
const SAFE_GAP = 8;

export interface HintInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const ZERO_INSETS: HintInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export function hintBubbleWidth(viewportWidth: number): number {
  return Math.min(HINT_MAX_W, Math.max(0, viewportWidth - HINT_MARGIN * 2));
}

/** Padding of the safe-area probe (`env(safe-area-inset-*)`). Non-numbers count as no inset. */
export function readSafeInsets(style: { paddingTop: string; paddingRight: string; paddingBottom: string; paddingLeft: string }): HintInsets {
  const n = (v: string) => {
    const x = parseFloat(v);
    return Number.isFinite(x) ? Math.max(0, x) : 0;
  };
  return { top: n(style.paddingTop), right: n(style.paddingRight), bottom: n(style.paddingBottom), left: n(style.paddingLeft) };
}

/** Enough of the control still intersects the safe viewport to point at it. A sliver counts as offscreen. */
export function hintTargetVisible(anchor: HintBox, vw: number, vh: number, insets: HintInsets = ZERO_INSETS): boolean {
  if (anchor.width <= 0 || anchor.height <= 0 || vw <= 0 || vh <= 0) return false;
  const boundTop = insets.top;
  const boundLeft = insets.left;
  const boundRight = vw - insets.right;
  const boundBottom = vh - insets.bottom;
  if (boundBottom - boundTop < 8 || boundRight - boundLeft < 8) return false;
  const top = Math.max(anchor.top, boundTop);
  const bottom = Math.min(anchor.bottom, boundBottom);
  const left = Math.max(anchor.left, boundLeft);
  const right = Math.min(anchor.right, boundRight);
  return bottom - top >= Math.min(8, anchor.height) && right - left >= Math.min(8, anchor.width);
}

/**
 * Bubble next to the target. Above only when the whole bubble fits there inside the safe area
 * (status bar included); otherwise below. Clamped on both axes. The arrow stays aimed at the target.
 * Null when the target has scrolled away: the mark must not stay parked on whatever is there now.
 */
export function placeCoachMark(
  anchor: HintBox,
  hint: { width: number; height: number },
  vw: number,
  vh: number,
  insets: HintInsets = ZERO_INSETS,
): HintSpot | null {
  if (!hintTargetVisible(anchor, vw, vh, insets)) return null;
  const width = Math.min(hint.width > 0 ? hint.width : hintBubbleWidth(vw), Math.max(0, vw - insets.left - insets.right - HINT_MARGIN * 2));
  const height = hint.height > 0 ? hint.height : 112;
  if (width < 32 || height < 16) return null;
  const minTop = insets.top + SAFE_GAP;
  const maxBottom = vh - insets.bottom - SAFE_GAP;
  const minLeft = Math.max(HINT_MARGIN, insets.left);
  const maxRight = vw - Math.max(HINT_MARGIN, insets.right);
  const aboveTop = anchor.top - HINT_GAP - height;
  const belowTop = anchor.bottom + HINT_GAP;
  const fitsAbove = aboveTop >= minTop;
  const fitsBelow = belowTop + height <= maxBottom;
  // No room above the control (the status bar is in the way): sit underneath it.
  let placeBelow = fitsBelow || !fitsAbove;
  if (!fitsAbove && !fitsBelow) {
    const roomAbove = anchor.top - minTop;
    const roomBelow = maxBottom - anchor.bottom;
    placeBelow = roomBelow >= roomAbove;
  }
  let top = placeBelow ? Math.max(belowTop, minTop) : aboveTop;
  const maxTop = Math.max(minTop, maxBottom - height);
  top = Math.min(Math.max(top, minTop), maxTop);
  const maxLeft = Math.max(minLeft, maxRight - width);
  const center = anchor.left + anchor.width / 2;
  const left = Math.min(Math.max(center - width / 2, minLeft), maxLeft);
  const arrow = Math.min(Math.max(center - left, 14), Math.max(14, width - 14));
  const bubbleMid = top + height / 2;
  const anchorMid = (anchor.top + anchor.bottom) / 2;
  return { top, left, place: bubbleMid <= anchorMid ? 'above' : 'below', arrow };
}

/** How far a downward pull travels before a phone sheet dismisses. */
export const SHEET_DISMISS_DY = 96;
/** Movement below this stays a tap (the grab handle still closes on click). */
export const SHEET_DRAG_SLOP = 8;

export interface SheetDrag {
  latched: boolean;
  originY: number;
  originX: number;
  offset: number;
}

export function beginSheetDrag(y: number, x: number): SheetDrag {
  return { latched: false, originY: y, originX: x, offset: 0 };
}

/**
 * A downward pull drags the sheet once the finger has clearly moved down.
 * While a list under the finger is scrolled away from its top, the pull scrolls that list instead.
 * The grab handle always drags, even when the list is mid-scroll.
 * Offset starts at the latch point so a list that reaches the top mid-gesture does not jump.
 */
export function moveSheetDrag(d: SheetDrag, y: number, x: number, listScrolled: boolean, fromGrip: boolean): SheetDrag {
  if (d.latched) return { ...d, offset: Math.max(0, y - d.originY) };
  const dy = y - d.originY;
  const dx = x - d.originX;
  if (dy <= SHEET_DRAG_SLOP || Math.abs(dx) > dy) return d;
  if (listScrolled && !fromGrip) return d;
  return { latched: true, originY: y, originX: x, offset: 0 };
}

export function sheetDragDismisses(offset: number): boolean {
  return offset >= SHEET_DISMISS_DY;
}

/** True when some scroller between the finger and the sheet (including the sheet) is below its top. */
export function sheetListScrolled(sheet: HTMLElement, target: EventTarget | null): boolean {
  let n: Node | null = target instanceof Node ? target : null;
  while (n instanceof Element) {
    if (n instanceof HTMLElement && n.scrollTop > 1) return true;
    if (n === sheet) return false;
    n = n.parentElement;
  }
  return false;
}

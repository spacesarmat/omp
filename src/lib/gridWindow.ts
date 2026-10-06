// Long poster grids on webOS 4: the images of rows far from the focus are let go (the tile keeps its size, so the
// layout does not move) and come back once the focus is near again. Only the decoded posters are freed: the tiles stay.

/** The screen height of the TV layout, px. */
export const SCREEN_PX = 1080;
/** How far from the focused row images stay loaded, in screens. */
export const KEEP_SCREENS = 3;

/** The rows kept on each side of the focused one for rows `rowPx` tall: about KEEP_SCREENS screens' worth. */
export function keepRows(rowPx: number, screens: number = KEEP_SCREENS, screenPx: number = SCREEN_PX): number {
  return Math.max(1, Math.ceil((screens * screenPx) / Math.max(1, rowPx)));
}

/** The row of tile `i` in a grid of `cols` columns. */
export function rowOf(i: number, cols: number): number {
  return Math.floor(i / Math.max(1, cols));
}

/** Whether tile `i` keeps its image: its row is at most `keep` rows from the focused row. */
export function keepsImage(i: number, focusRow: number, cols: number, keep: number): boolean {
  return Math.abs(rowOf(i, cols) - focusRow) <= keep;
}

/** The row of the focused tile among `keys` (the tiles' focus keys in order); 0 when the focus is elsewhere. */
export function focusedRow(keys: string[], current: string, cols: number): number {
  const i = current ? keys.indexOf(current) : -1;
  return i >= 0 ? rowOf(i, cols) : 0;
}

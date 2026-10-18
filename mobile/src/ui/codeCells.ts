/**
 * Layout contract for the pairing-code cells. The stylesheet (`.m-code` in mobile.css)
 * is what the phone paints; these functions are the same numbers so a test can check
 * that six cells still fit the sheet down to 320dp.
 */

export const CODE_CELL_MIN = 44;
export const CODE_CELL_MAX = 60;
export const CODE_GAP_MIN = 2;
export const CODE_GAP_MAX = 12;
/** Worst case: a current Android TV shows six digits. */
export const CODE_CELLS = 6;
/** `.m-sheet` horizontal padding, each side. The row lines up with that inset. */
export const SHEET_PAD_X = 20;
/**
 * Subtracted from the content width before the gap is shared.
 * 6×44 plus one extra px per cell, so a rounded gap still leaves a 44px cell.
 */
export const CODE_ROW_BASIS = CODE_CELLS * CODE_CELL_MIN + CODE_CELLS;

/** Gap for the code row inside a sheet content box of `contentWidth` px. Sized so six cells still fit. */
export function codeRowGap(contentWidth: number): number {
  const raw = (contentWidth - CODE_ROW_BASIS) / (CODE_CELLS - 1);
  return Math.min(CODE_GAP_MAX, Math.max(CODE_GAP_MIN, raw));
}

/** Cell width after flex-grow, capped at the 60px design size. Below the 44px floor means the row overflows. */
export function codeCellWidth(contentWidth: number, cells: number): number {
  const gap = codeRowGap(contentWidth);
  const share = (contentWidth - gap * (cells - 1)) / cells;
  return Math.min(CODE_CELL_MAX, share);
}

/** Width the row actually occupies (centered once cells hit their max). */
export function codeRowUsed(contentWidth: number, cells: number): number {
  const gap = codeRowGap(contentWidth);
  const cell = Math.max(CODE_CELL_MIN, codeCellWidth(contentWidth, cells));
  return cell * cells + gap * (cells - 1);
}

/** Sheet content box at a viewport of `viewportWidth` dp (the sheet is full width). */
export function sheetContentWidth(viewportWidth: number): number {
  return viewportWidth - SHEET_PAD_X * 2;
}

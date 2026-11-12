// Catalog header collapse. The threshold is a fixed scroll offset, not the height of the content,
// with hysteresis so a few pixels of bounce do not flicker the bar.

export const HEADER_COLLAPSE_AT = 48;
export const HEADER_EXPAND_AT = 24;

export function nextHeaderCollapsed(collapsed: boolean, y: number): boolean {
  const top = y < 0 ? 0 : y;
  if (collapsed) return top > HEADER_EXPAND_AT;
  return top > HEADER_COLLAPSE_AT;
}

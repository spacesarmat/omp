// Phone poster grids («Обзор», a person's films, «Мои»): columns follow the content width.
// A card is never narrower than GRID_MIN, and auto-fit stretches a short row across the free width.
// Portrait and landscape use the same rule. The tab bar and the system insets stay outside the grid
// (screen padding), so a shorter window does not shrink the cards.
import { useEffect, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

/** Minimum card width (px) and the column gap for the two poster modes. */
export const GRID_MIN = { large: 156, small: 104 } as const;
export const GRID_GAP = { large: 12, small: 8 } as const;

export type GridMode = keyof typeof GRID_MIN;

/** How many cards of this mode fit in `width` px. One card when the row is narrower than the minimum. */
export function gridCols(width: number, mode: GridMode): number {
  if (!(width > 0)) return 1;
  const min = GRID_MIN[mode];
  const gap = GRID_GAP[mode];
  return Math.max(1, Math.floor((width + gap) / (min + gap)));
}

/** Card width when a full row is packed. A short row grows (auto-fit), so this is the smallest card. */
export function cardWidth(width: number, mode: GridMode): number {
  const n = gridCols(width, mode);
  const gap = GRID_GAP[mode];
  return (width - gap * (n - 1)) / n;
}

/**
 * Grid columns: as many as the minimum allows, and `min(..., 100%)` so one column cannot be wider
 * than the grid (no horizontal overflow on a narrow window).
 */
export function gridTemplate(mode: GridMode): string {
  return 'repeat(auto-fit, minmax(min(' + GRID_MIN[mode] + 'px, 100%), 1fr))';
}

/**
 * Content width of `ref` (0 before layout or when `active` is false). Resize and rotation update it;
 * the list itself is not remounted.
 */
export function useContentWidth(ref: RefObject<HTMLElement | null>, active = true): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!active) {
      setWidth((w) => (w === 0 ? w : 0));
      return;
    }
    const measure = () => {
      const el = ref.current;
      const w = el ? el.clientWidth : 0;
      setWidth((prev) => (prev === w ? prev : w));
    };
    measure();
    const raf = requestAnimationFrame(measure);
    const later = () => requestAnimationFrame(measure);
    window.addEventListener('resize', later);
    window.addEventListener('orientationchange', later);
    const ro = typeof ResizeObserver !== 'undefined' && ref.current ? new ResizeObserver(later) : null;
    if (ro && ref.current) {
      ro.observe(ref.current);
      if (ref.current.parentElement) ro.observe(ref.current.parentElement);
    }
    return () => {
      window.removeEventListener('resize', later);
      window.removeEventListener('orientationchange', later);
      if (ro) ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [ref, active]);
  return width;
}

// Poster grids in landscape («Обзор», a person's films, «Мои»): two whole cards with captions must fit between the
// actual grid top and the tab bar. Each card width comes from half that height, and the number of cards in a row is
// what fits across. Every card size keeps its own step: the biggest size is the biggest card that still fits, each
// smaller one has at least one more card per row. Portrait is untouched (the CSS classes of the grid decide there).
import { useEffect, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import { editableFocused } from './keyboard';

/** One card size of a grid: poster height / width, the tallest caption under the poster, the column gap (px). */
export type CardFit = { aspect: number; caption: number; gap: number };

/** Free space kept above and below a card that is fully on screen. */
export const LANDSCAPE_MARGIN = 8;
/** The biggest size never has fewer cards per row than this in landscape. */
export const LANDSCAPE_MIN_COLS = 3;
/** Complete card rows visible in landscape. */
export const LANDSCAPE_ROWS = 2;

/** The fewest columns of `width` px where a whole card of `fit` is at most `height` px tall. */
export function colsToFit(width: number, height: number, fit: CardFit): number {
  const poster = height - fit.caption - 2 * LANDSCAPE_MARGIN;
  if (!(width > 0) || !(poster > 0)) return 1;
  const card = poster / fit.aspect;
  return Math.max(1, Math.ceil((width + fit.gap) / (card + fit.gap) - 1e-6));
}

/**
 * Columns per card size, biggest size first: the biggest is the fewest columns where its card fits one of two rows
 * (at least LANDSCAPE_MIN_COLS), every smaller size at least one more than the size before it.
 */
export function landscapeCols(width: number, height: number, fits: CardFit[]): number[] {
  const out: number[] = [];
  fits.forEach((fit, i) => {
    const least = i === 0 ? LANDSCAPE_MIN_COLS : out[i - 1] + 1;
    out.push(Math.max(least, colsToFit(width, height / LANDSCAPE_ROWS, fit)));
  });
  return out;
}

/**
 * The visible height for the grid: from its actual top down to the top of the tab bar, without off-screen space above
 * the viewport. The TV mini-player is not taken off on purpose (Andy): the columns stay the same whether a TV is linked
 * or not, and the last row scrolls clear.
 */
export function visibleHeight(ref: RefObject<HTMLElement | null>, atPageTop = false): number {
  const nav = document.querySelector('.m-nav');
  const r = nav ? nav.getBoundingClientRect() : null;
  const bottom = r && r.height > 0 ? r.top : window.innerHeight;
  const safeTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--m-safe-top')) || 0;
  const scroll = atPageTop ? window.scrollY || document.documentElement.scrollTop || 0 : 0;
  const top = ref.current ? Math.max(safeTop, ref.current.getBoundingClientRect().top + scroll) : safeTop;
  return Math.max(0, bottom - top);
}

export type GridBox = { width: number; height: number };

/**
 * The grid box in landscape (null in portrait or before layout). `ref` is the element whose width the grid takes.
 * The soft keyboard only makes the window shorter: while a text field has the focus, the tallest height seen for that
 * width is kept, so typing in the search does not shrink the posters. Any other shorter window (split screen) counts.
 * `atPageTop` keeps the height budget valid when a horizontally scrolling rail is measured after the page scrolled.
 */
export function useLandscapeBox(ref: RefObject<HTMLElement | null>, active = true, atPageTop = false): GridBox | null {
  const [box, setBox] = useState<GridBox | null>(null);
  useEffect(() => {
    let tallest = { w: 0, h: 0 };
    const measure = () => {
      const el = ref.current;
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (!el || !(w > h)) {
        tallest = { w: 0, h: 0 };
        setBox((b) => (b ? null : b));
        return;
      }
      if (tallest.w !== w || h > tallest.h || !editableFocused()) tallest = { w, h };
      const width = el.clientWidth;
      const height = Math.round(visibleHeight(ref, atPageTop) + (tallest.h - h));
      if (!(width > 0) || !(height > 0)) return;
      setBox((b) => (b && b.width === width && b.height === height ? b : { width, height }));
    };
    if (!active) return;
    measure();
    // the tab bar is drawn by the app shell, maybe after this effect: one more look on the next frame
    const raf = requestAnimationFrame(measure);
    // the tab bar gets short in landscape by a media query: measure again once the new layout is in
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
  }, [ref, active, atPageTop]);
  return box;
}

/** A landscape rail tile never gets wider than this (px), however tall the window is. */
export const RAIL_TILE_MAX = 160;

/** The rail tile width where a whole card (the poster and the caption under it) takes at most `height` px. */
export function railTileWidth(height: number, fit: CardFit): number {
  const w = Math.floor((height - fit.caption - 2 * LANDSCAPE_MARGIN) / fit.aspect);
  return w > 0 ? Math.min(RAIL_TILE_MAX, w) : 0;
}

/** The inline style of a grid with `n` columns (none in portrait). */
export function colsStyle(n: number | null): { gridTemplateColumns: string } | undefined {
  return n ? { gridTemplateColumns: 'repeat(' + n + ', minmax(0, 1fr))' } : undefined;
}

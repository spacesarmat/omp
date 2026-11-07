// «Обзор»: posters per row (2, 3 or 4), stepped by a two-finger pinch and kept across launches.
import { loadJson, saveJson } from '../../../../src/store/storage';
import { landscapeCols, type CardFit } from '../../ui/landscapeCols';

export type DiscoverCols = 2 | 3 | 4;

/** Smallest posters first: the pinch steps through these (spread = fewer, bigger posters). */
export const COLS_BY_SIZE: DiscoverCols[] = [4, 3, 2];

export const DISCOVER_COLS_KEY = 'tsp.discoverCols';

export const isDiscoverCols = (v: unknown): v is DiscoverCols => v === 2 || v === 3 || v === 4;

/** The stored choice; anything else (missing, a string, another number, broken JSON) is the default 2. */
export function readDiscoverCols(): DiscoverCols {
  return loadJson<DiscoverCols>(DISCOVER_COLS_KEY, 2, isDiscoverCols);
}

export function saveDiscoverCols(n: DiscoverCols): void {
  saveJson(DISCOVER_COLS_KEY, n);
}

/**
 * Landscape: a tile per card size, biggest first (the 2, 3 and 4 classes): a 2:3 poster, the tallest caption (two
 * title lines, the meta line and the date line with their gaps) and the column gap of that class.
 */
export const DISCOVER_FITS: CardFit[] = [
  { aspect: 1.5, caption: 56, gap: 12 },
  { aspect: 1.5, caption: 56, gap: 8 },
  { aspect: 1.5, caption: 56, gap: 6 },
];
export const DISCOVER_FITS_TALL: CardFit[] = [
  { aspect: 1.5, caption: 86, gap: 12 },
  { aspect: 1.5, caption: 80, gap: 8 },
  { aspect: 1.5, caption: 62, gap: 6 },
];

/** The compact captions in mobile.css stop at 560px; taller landscape windows use the portrait caption sizes. */
export function discoverFitsForHeight(height: number): CardFit[] {
  return height > 560 ? DISCOVER_FITS_TALL : DISCOVER_FITS;
}

/**
 * The home rails: the same tile as the grid, its three inter-line gaps included (28/38 title, the meta and the date
 * lines, the gaps). Compact up to 560px, the portrait caption sizes above.
 */
export function discoverRailFit(height: number): CardFit {
  return { aspect: 1.5, caption: height > 560 ? 90 : 58, gap: 10 };
}

/** Posters per row for the chosen size, in a grid `width` px wide with `height` px available for two rows. */
export function discoverLandscapeCols(cols: DiscoverCols, width: number, height: number, fits = DISCOVER_FITS): number {
  return landscapeCols(width, height, fits)[2 - COLS_BY_SIZE.indexOf(cols)];
}

/** The grid classes of a size: the smaller sizes have tighter gaps and smaller labels. */
export function discoverGridClass(cols: DiscoverCols): string {
  return 'm-disc-grid' + (cols === 3 ? ' m-cols-3' : cols === 4 ? ' m-cols-3 m-cols-4' : '');
}

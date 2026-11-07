// «Обзор» view, kept across launches. The old store was posters per row (2, 3 or 4).
import { loadJson, saveJson } from '../../../../src/store/storage';
import type { LibraryView } from '../../../../src/lib/libraryView';

export type DiscoverView = LibraryView;

export const DISCOVER_COLS_KEY = 'tsp.discoverCols';

/** Home-rail tile width (px). Large cards are wider; the others stay the readable portrait size. */
export function railTilePx(view: DiscoverView): number {
  return view === 'large' ? 156 : 112;
}

/** Old 2 columns are large cards. Old 3 and 4 columns are medium cards. The four names pass through. */
export function migrateDiscoverView(v: unknown): DiscoverView | null {
  if (v === 'large' || v === 'small' || v === 'list' || v === 'compact') return v;
  if (v === 2) return 'large';
  if (v === 3 || v === 4) return 'small';
  return null;
}

function isStoredDiscover(v: unknown): boolean {
  return migrateDiscoverView(v) !== null;
}

/** The stored view. A legacy column count is rewritten to one of the four modes. Anything else is large cards. */
export function readDiscoverCols(): DiscoverView {
  const raw = loadJson<unknown>(DISCOVER_COLS_KEY, undefined, isStoredDiscover);
  const view = migrateDiscoverView(raw);
  if (!view) return 'large';
  if (typeof raw === 'number') saveJson(DISCOVER_COLS_KEY, view);
  return view;
}

export function saveDiscoverCols(v: DiscoverView): void {
  saveJson(DISCOVER_COLS_KEY, v);
}

/** Backup cleaner: legacy counts migrate, unknown values are dropped. */
export function cleanDiscoverView(v: unknown): DiscoverView | undefined {
  return migrateDiscoverView(v) || undefined;
}

/** Poster grids keep the medium-card type styles (m-cols-3). Lists are rows. */
export function discoverGridClass(view: DiscoverView): string {
  if (view === 'list') return 'm-vlist m-disc-rows';
  if (view === 'compact') return 'm-vlist m-clist m-disc-rows';
  return 'm-disc-grid' + (view === 'small' ? ' m-cards-medium m-cols-3' : ' m-cards-large');
}

export function isGridDiscoverView(view: DiscoverView): boolean {
  return view === 'large' || view === 'small';
}

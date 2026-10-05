// «Обзор»: posters per row (2, 3 or 4), stepped by a two-finger pinch and kept across launches.
import { loadJson, saveJson } from '../../../../src/store/storage';

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

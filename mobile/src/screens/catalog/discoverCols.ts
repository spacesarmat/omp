// «Обзор»: posters per row (2 or 3), stepped by a two-finger pinch and kept across launches.
import { loadJson, saveJson } from '../../../../src/store/storage';

export type DiscoverCols = 2 | 3;

export const DISCOVER_COLS_KEY = 'tsp.discoverCols';

const isCols = (v: unknown): v is DiscoverCols => v === 2 || v === 3;

/** The stored choice; anything else (missing, a string, another number, broken JSON) is the default 2. */
export function readDiscoverCols(): DiscoverCols {
  return loadJson<DiscoverCols>(DISCOVER_COLS_KEY, 2, isCols);
}

export function saveDiscoverCols(n: DiscoverCols): void {
  saveJson(DISCOVER_COLS_KEY, n);
}

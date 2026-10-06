// The TV search screen's sort: quality (best release first, then seeds) besides the shared seeds / date / size.
// Chromium 53 safe; stable on old engines (equal items keep their order).
import { qualityRank } from '../monitor/quality';
import { resultKey, sortResults, type SortKey } from './view';
import type { SourceResult } from './types';

export type TvSortKey = 'quality' | SortKey;

/** A sorted copy, descending. Quality: qualityRank of the title, then seeds. */
export function sortTvResults<T extends SourceResult>(list: T[], key: TvSortKey): T[] {
  if (key !== 'quality') return sortResults(list, key) as T[];
  return list
    .map((r, i) => ({ r: r, i: i, q: qualityRank(r.Title || ''), s: r.Seed || 0 }))
    .sort((a, b) => b.q - a.q || b.s - a.s || a.i - b.i)
    .map((x) => x.r);
}

/**
 * Order while results still stream in (as stableOrder in view.ts): rows already on screen keep their places, new
 * rows go below them, sorted among themselves.
 */
export function stableTvOrder<T extends SourceResult>(shownKeys: string[], list: T[], key: TvSortKey): T[] {
  const byKey: { [k: string]: T } = {};
  list.forEach((r) => {
    byKey[resultKey(r)] = r;
  });
  const kept: T[] = [];
  const seen: { [k: string]: boolean } = {};
  shownKeys.forEach((k) => {
    if (byKey[k] && !seen[k]) {
      kept.push(byKey[k]);
      seen[k] = true;
    }
  });
  return kept.concat(sortTvResults(list.filter((r) => !seen[resultKey(r)]), key));
}

// Cache of the «Новое» feed per category: filled by the tab and by the background check, so the tab opens with fresh
// rows. Chromium 53 safe.
import { isObject, loadJson, saveJson } from '../store/storage';
import type { FeedCategory, SourceResult } from '../sources/types';
import { sanitizeResult } from './subs';

export const FEED_KEY = 'tsp.newsFeed';
export const FEED_MAX = 100;
/** The feed is not asked again sooner (spec: «не чаще раза в 10 минут»). */
export const FEED_FRESH_MS = 10 * 60 * 1000;

export interface FeedCache {
  /** Unix ms of the refresh. */
  at: number;
  /** Newest first. */
  results: SourceResult[];
}

function loadAll(): { [category: string]: unknown } {
  return loadJson<{ [category: string]: unknown }>(FEED_KEY, {}, isObject);
}

export function loadFeed(category: FeedCategory): FeedCache | null {
  const v = loadAll()[category];
  if (!isObject(v) || typeof v.at !== 'number' || !Array.isArray(v.results)) return null;
  const results: SourceResult[] = [];
  v.results.forEach((r) => {
    const s = sanitizeResult(r);
    if (s && results.length < FEED_MAX) results.push(s);
  });
  return { at: v.at, results };
}

export function saveFeed(category: FeedCategory, results: SourceResult[], at: number): void {
  const all = loadAll();
  all[category] = { at, results: results.slice(0, FEED_MAX) };
  saveJson(FEED_KEY, all);
}

/** Refreshed less than FEED_FRESH_MS ago. */
export function feedFresh(category: FeedCategory, now: number): boolean {
  const c = loadFeed(category);
  return !!c && now - c.at >= 0 && now - c.at < FEED_FRESH_MS;
}

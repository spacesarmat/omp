// Cache of the «Новое» feed per category: filled by the tab and by the background check, so the tab opens with fresh
// rows. Chromium 53 safe.
import { isObject, loadJson, saveJson } from '../store/storage';
import type { FeedCategory, SourceResult } from '../sources/types';
import { sanitizeResult } from './subs';
import { resultKey, sortResults } from '../sources/view';

export const FEED_KEY = 'tsp.newsFeed';
export const FEED_MAX = 100;
/** The feed is not asked again sooner (spec: «не чаще раза в 10 минут»). */
export const FEED_FRESH_MS = 10 * 60 * 1000;

export interface FeedCache {
  /** Unix ms of the refresh. */
  at: number;
  /** Newest first. */
  results: SourceResult[];
  /** Ids of the sources the rows came from (the ones that answered); absent in caches of older builds. */
  sources?: string[];
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
  const out: FeedCache = { at: v.at, results };
  if (Array.isArray(v.sources)) {
    const ids: string[] = [];
    v.sources.forEach((id) => {
      if (typeof id === 'string' && id && ids.indexOf(id) < 0) ids.push(id);
    });
    out.sources = ids;
  }
  return out;
}

export function saveFeed(category: FeedCategory, results: SourceResult[], at: number, sources?: string[]): void {
  const all = loadAll();
  const entry: { at: number; results: SourceResult[]; sources?: string[] } = { at, results: results.slice(0, FEED_MAX) };
  if (sources) entry.sources = sources.slice();
  all[category] = entry;
  saveJson(FEED_KEY, all);
}

/**
 * Stores a refresh: the rows of the sources that answered replace their old rows; the cached rows of sources that did
 * not answer this time are kept (a partial answer does not empty the feed). Newest first. Nothing is stored when no
 * source answered. Returns the stored cache, or null.
 */
export function storeFeedRefresh(category: FeedCategory, results: SourceResult[], answered: string[], at: number): FeedCache | null {
  if (!answered.length) return null;
  const prev = loadFeed(category);
  const fromAnswered = (r: SourceResult) => answered.indexOf(r.source) >= 0;
  const kept = prev ? prev.results.filter((r) => !fromAnswered(r)) : [];
  const seen: { [k: string]: boolean } = {};
  const merged: SourceResult[] = [];
  results.concat(kept).forEach((r) => {
    const k = resultKey(r);
    if (seen[k]) return;
    seen[k] = true;
    merged.push(r);
  });
  const sources = answered.slice();
  kept.forEach((r) => {
    if (sources.indexOf(r.source) < 0) sources.push(r.source);
  });
  const list = sortResults(merged, 'date');
  saveFeed(category, list, at, sources);
  return loadFeed(category);
}

/** Refreshed less than FEED_FRESH_MS ago. */
export function feedFresh(category: FeedCategory, now: number): boolean {
  const c = loadFeed(category);
  return !!c && now - c.at >= 0 && now - c.at < FEED_FRESH_MS;
}

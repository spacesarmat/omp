// TV «Обзор»: the sort and the filters (kept across launches, sanitized on read) and the loaded feed of this run
// (kept in memory so Back from a title card shows the same pages and the same open search).
import { loadJson, saveJson } from './storage';
import { sanitizeDiscoverQuery, type DiscoverQuery } from '../catalog/discoverQuery';
import type { CatalogTitle, Kind } from '../catalog/tmdb';

export const TV_DISCOVER_QUERY_KEY = 'tsp.tvDiscoverQuery';

export type DiscoverKind = Kind | 'all';

export interface DiscoverFeed {
  items: CatalogTitle[];
  page: number;
  pages: number;
}

export interface DiscoverSearch {
  q: string;
  items: CatalogTitle[] | null;
}

export interface DiscoverState {
  /** 'want': the «Хочу» list (no feed of its own). */
  kind: DiscoverKind | 'want';
  /** discoverQueryKey of the query the feed was loaded with. */
  qkey: string;
  feed: DiscoverFeed | null;
  search: DiscoverSearch | null;
  at: number;
}

export function loadTvDiscoverQuery(): DiscoverQuery {
  return sanitizeDiscoverQuery(loadJson<unknown>(TV_DISCOVER_QUERY_KEY, null));
}

export function saveTvDiscoverQuery(q: DiscoverQuery): void {
  saveJson(TV_DISCOVER_QUERY_KEY, sanitizeDiscoverQuery(q));
}

/** A kept feed older than this is loaded again. */
export const DISCOVER_KEEP_MS = 15 * 60 * 1000;

let kept: DiscoverState | null = null;

/** The state of the last visit (null when none or stale). */
export function readDiscoverState(now: number = Date.now()): DiscoverState | null {
  if (!kept || now - kept.at > DISCOVER_KEEP_MS) return null;
  return kept;
}

export function saveDiscoverState(s: Omit<DiscoverState, 'at'>, now: number = Date.now()): void {
  kept = { kind: s.kind, qkey: s.qkey, feed: s.feed, search: s.search, at: now };
}

export function resetDiscoverState(): void {
  kept = null;
}

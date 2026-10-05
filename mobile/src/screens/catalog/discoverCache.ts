// «Обзор» state kept across remounts (a title card opened and closed with «Назад», a tab switch): the loaded feed
// pages, the chip and the open search. In memory only; tied to the active server and the UI language; the feed also
// to the sort and filters it was loaded with.
import { activeServerId } from '../../../../src/store/servers';
import { lang } from '../../../../src/i18n';
import type { CatalogTitle, Kind } from '../../../../src/catalog/tmdb';

/** Same as the list TTL: an older feed is fetched again. */
export const DISCOVER_TTL_MS = 15 * 60 * 1000;

export type Filter = Kind | 'all';

export interface Feed {
  items: CatalogTitle[];
  page: number;
  pages: number;
}

export interface DiscoverState {
  filter: Filter;
  /** null: not loaded (or failed): the next mount fetches it. */
  feed: Feed | null;
  /** discoverQueryKey() of the sort and filters the feed was loaded with. */
  query: string;
  /** The search screen is open: its text and results (null: none yet). */
  search: { text: string; items: CatalogTitle[] | null } | null;
}

let cache: { key: string; at: number; state: DiscoverState } | null = null;

function cacheKey(): string {
  return (activeServerId.peek() || '') + '|' + lang.peek();
}

/**
 * The kept state, or null when there is none, it belongs to another server or language, or it is too old. With
 * `query` (the current sort and filters), a feed loaded with other ones comes back as null.
 */
export function readDiscover(query?: string): DiscoverState | null {
  if (!cache) return null;
  if (cache.key !== cacheKey() || Date.now() - cache.at > DISCOVER_TTL_MS) {
    cache = null;
    return null;
  }
  const s = cache.state;
  if (query !== undefined && s.query !== query) return { filter: s.filter, feed: null, query: query, search: s.search };
  return s;
}

/** Updates the kept state. A new feed (another chip, «Повторить», a page) restarts the TTL. */
export function saveDiscover(patch: Partial<DiscoverState>): void {
  const prev = readDiscover();
  const state: DiscoverState = {
    filter: prev ? prev.filter : 'all',
    feed: prev ? prev.feed : null,
    query: prev ? prev.query : '',
    search: prev ? prev.search : null,
  };
  if (patch.filter !== undefined) state.filter = patch.filter;
  if (patch.feed !== undefined) state.feed = patch.feed;
  if (patch.query !== undefined) state.query = patch.query;
  if (patch.search !== undefined) state.search = patch.search;
  const renewed = !prev || !cache || (patch.feed !== undefined && patch.feed !== prev.feed);
  cache = { key: cacheKey(), at: renewed || !cache ? Date.now() : cache.at, state };
}

export function clearDiscover(): void {
  cache = null;
}

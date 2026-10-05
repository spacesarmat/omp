// The «Новое» feed: fresh releases of a category from every switched-on source that has a «new» page, in parallel,
// 15 s per source, merged like the unified search. Feed pages differ from the search pages, so the answers are not
// recorded in the source health. Chromium 53 safe.
import { allSources } from './registry';
import { runSources, type SearchAllOptions, type SearchHandle } from './search';
import { enabledSources } from './store';
import type { FeedCategory, Source, SourceContext } from './types';

export interface FeedAllOptions extends Pick<SearchAllOptions, 'onResult' | 'onDone' | 'timeoutMs' | 'cloudflareTimeoutMs'> {
  /** Ids to ask; default: the switched-on sources. Sources without `latest` are always left out. */
  sources?: string[];
  /** Candidate sources; default: allSources(). */
  from?: Source[];
}

/** Sources that can fill the feed (have `latest`), among `from` (default: allSources()). */
export function feedSources(from?: Source[]): Source[] {
  return (from || allSources()).filter((s) => typeof s.latest === 'function');
}

/**
 * Fresh releases of `category` from the feed sources. The handle is the one of searchAll; its results() are merged
 * duplicates in answer order — sort them by date for the screen (sortResults(list, 'date')).
 */
export function feedAll(ctx: SourceContext, category: FeedCategory, opts?: FeedAllOptions): SearchHandle {
  const o = opts || {};
  const from = feedSources(o.from);
  const chosen = o.sources ? from.filter((s) => o.sources!.indexOf(s.id) >= 0) : enabledSources(from);
  return runSources(chosen, (source) => source.latest!(ctx, category), {
    onResult: o.onResult,
    onDone: o.onDone,
    timeoutMs: o.timeoutMs,
    cloudflareTimeoutMs: o.cloudflareTimeoutMs,
    health: false,
  });
}

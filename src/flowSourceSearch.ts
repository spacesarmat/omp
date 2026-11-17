import { allSources } from './sources/registry';
import { sourcesForSearch, searchAll, type SearchHandle } from './sources/search';
import { enabledSources, getHealth } from './sources/store';
import type { SourceContext } from './sources/types';
import type { FlowDispatchOutcome } from '../design/production-flow';

export interface FlowSourceSearchOptions {
  platform: string;
  /** The active search query from the search screen route; undefined when there is none. */
  query(): string | undefined;
  context(): SourceContext;
  /** Reports the outcome of a started search (result count, screen sync, ...). */
  report(handle: SearchHandle): void;
}

export interface FlowSourceSearch {
  retry(): FlowDispatchOutcome;
  next(): FlowDispatchOutcome;
}

// source.retry/source.next against the existing search path: searchAll with the same
// source selection the search screens use (sourcesForSearch over enabledSources). The last
// flow search remembers its failed sources (retried by source.retry) and the rotation
// cursor (advanced by source.next over the sources whose latest health is usable).
export function createFlowSourceSearch(options: FlowSourceSearchOptions): FlowSourceSearch {
  let session: { query: string; cursor: number; failed: string[] } | null = null;

  const enabledIds = (): string[] =>
    sourcesForSearch(enabledSources(allSources())).map((source) => source.id);

  const available = (id: string): boolean => {
    const health = getHealth(id);
    return !health || health.state === 'ok';
  };

  const start = (query: string, sources: string[] | undefined, cursor: number): FlowDispatchOutcome => {
    const handle = searchAll(query, { ctx: options.context(), ...(sources ? { sources } : {}) });
    session = { query, cursor, failed: [] };
    if (handle.done) {
      void handle.done.then(() => {
        if (session && session.query === query) session.failed = handle.failed();
      });
    }
    options.report(handle);
    return { ok: true };
  };

  return {
    retry() {
      const query = options.query() ?? session?.query;
      if (!query) {
        return { ok: false, error: `source.retry is unavailable on ${options.platform}: the search screen has no active query` };
      }
      const failed = session && session.query === query ? session.failed : [];
      return start(query, failed.length ? failed : undefined, session?.cursor ?? -1);
    },
    next() {
      const query = options.query() ?? session?.query;
      if (!query) {
        return { ok: false, error: `source.next is unavailable on ${options.platform}: the search screen has no active query` };
      }
      const ids = enabledIds();
      if (!ids.length) return { ok: false, error: `source.next is unavailable on ${options.platform}: no search source is enabled` };
      const cursor = session && session.query === query ? session.cursor : -1;
      for (let step = 1; step <= ids.length; step += 1) {
        const at = (cursor + step) % ids.length;
        if (!available(ids[at])) continue;
        return start(query, [ids[at]], at);
      }
      return { ok: false, error: `source.next is unavailable on ${options.platform}: every enabled source reported an error or needs a login` };
    },
  };
}

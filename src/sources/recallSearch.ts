// One search the person typed, asked as several titles: the cleaned line at once, then TMDB's
// other names, then one relaxed retry when nothing relevant came back. Each source runs its
// queries one after another (a tracker that is hit twice at once bans the IP); sources stay parallel.
// Chromium 53: no ?., no ??, no regex u flag.
import { activeCatalog } from '../catalog/activeCatalog';
import type { CatalogTitle } from '../catalog/tmdb';
import { t } from '../i18n';
import { mergeResults, normalizeTitle } from './merge';
import { splitByQueries } from './relevance';
import { relaxedQueries, trackerQueries, type RecallHint } from './recall';
import { allSources } from './registry';
import { CLOUDFLARE_TIMEOUT_MS, SOURCE_TIMEOUT_MS, sourcesForSearch, type SearchAllOptions, type SearchHandle } from './search';
import { isIpBan } from './ipBan';
import { isCloudflareBypassOn, setHealth as recordHealth } from './store';
import { isTlsError } from './tls';
import { parseSearchQuery, type ParsedQuery } from './queryParse';
import { isLoginRequired, type Source, type SourceResult } from './types';

export interface RecallSearchOptions extends SearchAllOptions {
  /** The TMDB row the person picked. Its titles are searched and the catalog is not asked again. */
  hint?: RecallHint | null;
  /** Other titles to search. Default: one cached TMDB search. Failure is an empty list. */
  lookup?: (parsed: ParsedQuery) => Promise<string[]>;
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    /* a UI callback must not stop the other sources */
  }
}

function asError(e: unknown): Error {
  if (e instanceof Error) return e;
  return new Error(String(e));
}

/** Titles of the best TMDB hit for the cleaned query (Russian and original). Cached by the catalog client. */
export function lookupRecallTitles(parsed: ParsedQuery): Promise<string[]> {
  if (!parsed.title || parsed.title.length < 2) return Promise.resolve([]);
  return activeCatalog(false).then(
    (c) => c.search(parsed.title, 1).then(
      (r) => {
        const items = r && r.items ? r.items : [];
        let best: CatalogTitle | null = items.length ? items[0] : null;
        if (parsed.year) {
          for (let i = 0; i < items.length; i++) {
            if (items[i].year === parsed.year) {
              best = items[i];
              break;
            }
          }
        }
        if (!best) return [];
        return [best.title, best.original];
      },
      () => [],
    ),
    () => [],
  );
}

/**
 * searchAll for every title of this query. `results()` is the merged list (infohash, then title).
 * `queries()` is what was actually sent. `done` waits for the relaxed retry too.
 */
export function searchRecall(raw: string, opts: RecallSearchOptions): SearchHandle {
  const from = opts.from || allSources();
  const chosen = sourcesForSearch(from, opts.sources);
  const parsed = parseSearchQuery(raw);
  const hint = opts.hint || null;
  const lookup = opts.lookup || lookupRecallTitles;
  const timeoutMs = opts.timeoutMs || SOURCE_TIMEOUT_MS;
  const cfTimeout = Math.max(timeoutMs, opts.cloudflareTimeoutMs || CLOUDFLARE_TIMEOUT_MS);
  const collected: SourceResult[] = [];
  const queries: string[] = [];
  const seenQ: { [k: string]: boolean } = {};
  const answered: string[] = [];
  const failed: string[] = [];
  const pending = chosen.map((s) => s.id);
  const cursor: { [id: string]: number } = {};
  const ok: { [id: string]: boolean } = {};
  const settled: { [id: string]: boolean } = {};
  const firstErr: { [id: string]: Error } = {};
  const waiters: (() => void)[] = [];
  const idleWait: (() => void)[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  let inflight = 0;
  let cancelled = false;
  let closed = false;
  let relaxUsed = false;
  let ended = false;
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const end = () => {
    if (ended) return;
    ended = true;
    finish();
  };

  const wake = () => {
    const list = waiters.splice(0, waiters.length);
    for (let i = 0; i < list.length; i++) list[i]();
  };

  const idleNow = (): boolean => {
    if (inflight > 0) return false;
    for (let i = 0; i < chosen.length; i++) {
      if ((cursor[chosen[i].id] || 0) < queries.length) return false;
    }
    return true;
  };

  const noteIdle = () => {
    if (!idleNow()) return;
    const list = idleWait.splice(0, idleWait.length);
    for (let i = 0; i < list.length; i++) list[i]();
  };

  const whenIdle = (): Promise<void> => {
    if (idleNow()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      idleWait.push(resolve);
    });
  };

  const add = (list: string[]) => {
    let any = false;
    for (let i = 0; i < list.length; i++) {
      const q = (list[i] || '').replace(/\s+/g, ' ').trim();
      const k = normalizeTitle(q);
      if (!q || !k || seenQ[k]) continue;
      seenQ[k] = true;
      queries.push(q);
      any = true;
    }
    if (!any) return;
    // A source that already answered the first title goes back to "searching" for the next one.
    for (let i = 0; i < chosen.length; i++) {
      const id = chosen[i].id;
      if (!settled[id] && pending.indexOf(id) < 0) pending.push(id);
    }
    wake();
  };

  const timeoutOf = (source: Source): number => (isCloudflareBypassOn(source) ? cfTimeout : timeoutMs);

  const runQuery = (source: Source, q: string): Promise<SourceResult[]> => new Promise((resolve, reject) => {
    let over = false;
    const timer = setTimeout(() => {
      if (over) return;
      over = true;
      reject(new Error(t('sources.sourceTimeout')));
    }, timeoutOf(source));
    timers.push(timer);
    let run: Promise<SourceResult[]>;
    try {
      run = Promise.resolve(source.search(q, opts.ctx));
    } catch (e) {
      run = Promise.reject(e);
    }
    run.then(
      (list) => {
        if (over) return;
        over = true;
        clearTimeout(timer);
        resolve(Array.isArray(list) ? list : []);
      },
      (e) => {
        if (over) return;
        over = true;
        clearTimeout(timer);
        reject(e);
      },
    );
  });

  const dropQuiet = (source: Source) => {
    if (settled[source.id]) return;
    settled[source.id] = true;
    const i = pending.indexOf(source.id);
    if (i >= 0) pending.splice(i, 1);
  };

  const noteFailure = (source: Source, err: Error) => {
    if (cancelled || ok[source.id]) return;
    if (failed.indexOf(source.id) < 0) failed.push(source.id);
    if (isLoginRequired(err)) recordHealth(source.id, { state: 'login', at: Date.now() });
    else if (isIpBan(err)) recordHealth(source.id, { state: 'error', at: Date.now(), message: err.message, code: 'ipban' });
    else if (isTlsError(err)) recordHealth(source.id, { state: 'error', at: Date.now(), message: err.message, code: 'tls' });
    else recordHealth(source.id, { state: 'error', at: Date.now(), message: err.message });
    safe(() => opts.onDone && opts.onDone(source.id, err));
  };

  const finishSource = (source: Source, err?: Error) => {
    if (cancelled) {
      dropQuiet(source);
      return;
    }
    if (settled[source.id]) return;
    settled[source.id] = true;
    const i = pending.indexOf(source.id);
    if (i >= 0) pending.splice(i, 1);
    if (err && !ok[source.id]) noteFailure(source, err);
    else if (ok[source.id]) safe(() => opts.onDone && opts.onDone(source.id));
    else {
      // Asked nothing (the line had no title). Not a failure.
      answered.push(source.id);
      safe(() => opts.onDone && opts.onDone(source.id));
    }
    if (!pending.length) end();
  };

  chosen.forEach((source) => {
    cursor[source.id] = 0;
    let running = false;
    const pump = () => {
      if (running) return;
      running = true;
      const step = () => {
        if (cancelled) {
          running = false;
          dropQuiet(source);
          return;
        }
        if (cursor[source.id] < queries.length) {
          const q = queries[cursor[source.id]];
          cursor[source.id]++;
          inflight++;
          runQuery(source, q).then(
            (list) => {
              inflight--;
              if (cancelled) {
                dropQuiet(source);
                noteIdle();
                return;
              }
              const rows = list.map((r) => (r.source ? r : { ...r, source: source.id }));
              for (let i = 0; i < rows.length; i++) collected.push(rows[i]);
              if (!ok[source.id]) {
                ok[source.id] = true;
                answered.push(source.id);
                recordHealth(source.id, { state: 'ok', at: Date.now() });
              }
              safe(() => opts.onResult && opts.onResult(source.id, rows));
              noteIdle();
              step();
            },
            (e) => {
              inflight--;
              if (cancelled) {
                dropQuiet(source);
                noteIdle();
                return;
              }
              // Keep the first failure. A later title can still succeed and replace it.
              if (!ok[source.id] && !firstErr[source.id]) firstErr[source.id] = asError(e);
              noteIdle();
              step();
            },
          );
          return;
        }
        running = false;
        noteIdle();
        if (running) return;
        if (!closed) {
          waiters.push(pump);
          return;
        }
        const failedAll = !ok[source.id] && queries.length > 0;
        const err = failedAll ? firstErr[source.id] || new Error(t('sources.sourceTimeout')) : undefined;
        finishSource(source, err);
      };
      step();
    };
    pump();
  });

  if (!chosen.length) end();

  const hintTitles = hint ? [hint.title, hint.original].concat(hint.alts || []) : [];
  add(trackerQueries(parsed, hintTitles));

  const decide = (): Promise<void> => whenIdle().then(() => {
    if (cancelled || relaxUsed) return;
    const split = splitByQueries(mergeResults(collected), queries.length ? queries : [parsed.title || raw]);
    // A weak match is still a result on screen. Retry only when the list is empty.
    if (split.hits.length || split.similar.length) return;
    relaxUsed = true;
    const more = relaxedQueries(parsed, queries);
    if (!more.length) return;
    add(more);
    return whenIdle();
  });

  const looked = hint ? Promise.resolve(hintTitles) : lookup(parsed).then((v) => (Array.isArray(v) ? v : []), () => []);
  looked.then(
    (extras) => {
      if (cancelled) return;
      add(trackerQueries(parsed, extras));
      return decide();
    },
    () => decide(),
  ).then(() => {
    if (cancelled) return;
    closed = true;
    wake();
    if (!chosen.length) end();
    // Every source was already past the end and waiting. wake() runs them.
    if (chosen.length && !pending.length) end();
  });

  return {
    sourceIds: chosen.map((s) => s.id),
    results: () => mergeResults(collected),
    pending: () => pending.slice(),
    answered: () => answered.slice(),
    failed: () => failed.slice(),
    queries: () => queries.slice(),
    done,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      closed = true;
      for (let i = 0; i < timers.length; i++) clearTimeout(timers[i]);
      wake();
      end();
    },
  };
}

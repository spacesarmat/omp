// Unified search: every chosen source in parallel, results streamed per source, 15 s per source.
import { mergeResults } from './merge';
import { allSources } from './registry';
import { enabledSources, setHealth as recordHealth } from './store';
import { isLoginRequired } from './types';
import type { Source, SourceContext, SourceResult } from './types';

export const SOURCE_TIMEOUT_MS = 15000;

export interface SearchAllOptions {
  ctx: SourceContext;
  /** Ids chosen for this search («Все источники · N»); default: the sources switched on. */
  sources?: string[];
  /** Candidate sources; default: allSources(). */
  from?: Source[];
  onResult?: (sourceId: string, results: SourceResult[]) => void;
  /** Once per source: after its results, or with the error (timeout included). */
  onDone?: (sourceId: string, error?: Error) => void;
  timeoutMs?: number;
}

export interface SearchHandle {
  /** Ids of the sources searched, in order. */
  sourceIds: string[];
  /** Merged results so far. */
  results(): SourceResult[];
  /** Sources still searching. */
  pending(): string[];
  /** Sources that answered, in answer order. */
  answered(): string[];
  /** Sources that failed (error, timeout, login needed). */
  failed(): string[];
  /** Settles when every source has answered, failed or timed out (or on cancel). */
  done: Promise<void>;
  /** Stops callbacks; running requests are left to finish and ignored. */
  cancel(): void;
}

function asError(e: unknown): Error {
  if (e instanceof Error) return e;
  const msg = e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string' ? (e as { message: string }).message : String(e);
  return new Error(msg);
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    /* a UI callback failure must not stop the other sources */
  }
}

export function searchAll(query: string, opts: SearchAllOptions): SearchHandle {
  const from = opts.from || allSources();
  const chosen = opts.sources ? from.filter((s) => opts.sources!.indexOf(s.id) >= 0) : enabledSources(from);
  return runSources(chosen, (source) => source.search(query, opts.ctx), opts);
}

/**
 * The engine of searchAll and feedAll: `call` on every source in parallel, results streamed per source, a timeout per
 * source, health recorded, results merged.
 */
export interface RunOptions extends Pick<SearchAllOptions, 'onResult' | 'onDone' | 'timeoutMs'> {
  /** Record the answers in the source health («Источники поиска»); default true. The feed passes false. */
  health?: boolean;
}

export function runSources(
  chosen: Source[],
  call: (source: Source) => Promise<SourceResult[]>,
  opts: RunOptions,
): SearchHandle {
  const timeoutMs = opts.timeoutMs || SOURCE_TIMEOUT_MS;
  const setHealth: typeof recordHealth = opts.health === false ? () => undefined : recordHealth;
  const collected: SourceResult[] = [];
  const answered: string[] = [];
  const failed: string[] = [];
  const pending = chosen.map((s) => s.id);
  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const settle = (id: string) => {
    const i = pending.indexOf(id);
    if (i >= 0) pending.splice(i, 1);
    if (!pending.length) finish();
  };

  chosen.forEach((source) => {
    const started = Date.now();
    let over = false;
    const timer = setTimeout(() => {
      if (over) return;
      over = true;
      if (cancelled) return;
      const err = new Error('Источник не отвечает');
      failed.push(source.id);
      setHealth(source.id, { state: 'error', at: Date.now(), message: err.message });
      settle(source.id);
      safe(() => opts.onDone && opts.onDone(source.id, err));
    }, timeoutMs);
    timers.push(timer);

    let run: Promise<SourceResult[]>;
    try {
      run = Promise.resolve(call(source));
    } catch (e) {
      run = Promise.reject(e);
    }
    run.then(
      (list) => {
        if (over) return;
        over = true;
        clearTimeout(timer);
        if (cancelled) return;
        const results = (Array.isArray(list) ? list : []).map((r) => (r.source ? r : { ...r, source: source.id }));
        const now = Date.now();
        setHealth(source.id, { state: 'ok', ms: now - started, at: now });
        results.forEach((r) => collected.push(r));
        answered.push(source.id);
        settle(source.id);
        safe(() => opts.onResult && opts.onResult(source.id, results));
        safe(() => opts.onDone && opts.onDone(source.id));
      },
      (e) => {
        if (over) return;
        over = true;
        clearTimeout(timer);
        if (cancelled) return;
        const err = asError(e);
        failed.push(source.id);
        if (isLoginRequired(e)) setHealth(source.id, { state: 'login', at: Date.now() });
        else setHealth(source.id, { state: 'error', at: Date.now(), message: err.message });
        settle(source.id);
        safe(() => opts.onDone && opts.onDone(source.id, err));
      },
    );
  });
  if (!pending.length) finish();

  return {
    sourceIds: chosen.map((s) => s.id),
    results: () => mergeResults(collected),
    pending: () => pending.slice(),
    answered: () => answered.slice(),
    failed: () => failed.slice(),
    done,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      timers.forEach((t) => clearTimeout(t));
      finish();
    },
  };
}

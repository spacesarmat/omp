// The TV's site search: through the phone's sources when a phone is linked (its OMP app answers over RPC), else, or
// when the phone stops answering, the TorrServer sources. Both are a TvSearchHandle the screen reads the same way.
// Chromium 53: no ?. / ??, plain setTimeout loops.
import { searchAll } from '../sources/search';
import { torrServerSources } from '../sources/registry';
import { tvSourceContext } from '../sources/tvContext';
import { resolveLink } from '../sources/view';
import { getHealth } from '../sources/store';
import { infohashFromMagnet, parseDate } from '../sources/html';
import type { SourceResult } from '../sources/types';
import { phoneLink } from './phoneStore';
import { PhoneRpcError, phoneRpc } from './rpc';
import type { RpcFailure, RpcPoll, RpcResult } from './rpcTypes';
import { relevantRows } from '../sources/relevance';

/** A row; `via` is set on the rows found by the phone (resolveTvResult asks the phone for their link). */
export type TvResult = SourceResult & { via?: { handle: string; key: string } };

export interface TvSearchHandle {
  by: 'phone' | 'torrserver';
  sourceIds: string[];
  results(): TvResult[];
  pending(): string[];
  answered(): string[];
  failed(): string[];
  failures(): RpcFailure[];
  done: Promise<void>;
  /**
   * Stops the search. While it still runs, the phone is told to drop it (`searchCancel`) and its rows can no longer
   * be resolved. Once it has finished on its own, only the local state stops: the phone keeps the search (until its
   * TTL or its limit of live searches), so the rows stay resolvable. Safe to call on unmount.
   */
  cancel(): void;
  /** Called after every change; returns unsubscribe. */
  subscribe(cb: () => void): () => void;
}

export const POLL_MS = 800;
/** Consecutive failed polls after which the phone counts as gone and TorrServer takes over. */
const POLL_FAILURES = 2;
const RESOLVE_TRIES = 4;
const RESOLVE_GAP_MS = 1500;

const ADDABLE = /^(magnet:\?|https?:\/\/)/i;

function listeners() {
  const cbs: Array<() => void> = [];
  return {
    add(cb: () => void): () => void {
      cbs.push(cb);
      return () => {
        const i = cbs.indexOf(cb);
        if (i >= 0) cbs.splice(i, 1);
      };
    },
    fire(): void {
      cbs.slice().forEach((cb) => {
        try {
          cb();
        } catch (e) {
          /* a screen callback failure must not stop the search */
        }
      });
    },
  };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
}

/** A phone row as a TV row; null for a malformed one. */
export function fromRpcResult(r: RpcResult, handle: string): TvResult | null {
  if (!r || typeof r !== 'object' || typeof r.key !== 'string' || !r.key || typeof r.Title !== 'string' || !r.Title) return null;
  const out: TvResult = {
    Title: r.Title,
    Size: str(r.Size),
    Seed: num(r.Seed),
    Peer: num(r.Peer),
    Tracker: str(r.Tracker),
    CreateDate: str(r.CreateDate),
    Categories: str(r.Categories),
    Link: '',
    Magnet: str(r.Magnet),
    Hash: str(r.Hash),
    source: str(r.source),
    // the row's identity on screen: the phone's key is unique within its search
    groupKey: 'phone:' + handle + ':' + r.key,
    via: { handle: handle, key: r.key },
  };
  const others = strings(r.sources);
  if (others.length) out.sources = others;
  if (typeof r.sizeBytes === 'number' && isFinite(r.sizeBytes)) out.sizeBytes = r.sizeBytes;
  // `date` is a display string (dd.mm.yyyy) on the wire; SourceResult.date is unix ms
  const date = parseDate(str(r.date)) !== undefined ? parseDate(str(r.date)) : parseDate(out.CreateDate);
  if (date !== undefined) out.date = date;
  const hex = out.Hash.toLowerCase();
  const hash = /^[0-9a-f]{40}$/.test(hex) ? hex : infohashFromMagnet(out.Magnet);
  if (hash) out.hash = hash;
  return out;
}

function failuresOf(ids: string[]): RpcFailure[] {
  return ids.map((id) => {
    const h = getHealth(id);
    const f: RpcFailure = { id: id, message: h && h.message ? h.message : '' };
    if (h && h.code) f.code = h.code;
    else if (h && h.state === 'login') f.code = 'login';
    return f;
  });
}

/** The TorrServer sources (rutor, Torznab) of the TV's own server. */
export function torrServerSearch(query: string): TvSearchHandle {
  const subs = listeners();
  const s = searchAll(query, {
    ctx: tvSourceContext(),
    from: torrServerSources(),
    onResult: () => subs.fire(),
    onDone: () => subs.fire(),
  });
  return {
    by: 'torrserver',
    sourceIds: s.sourceIds,
    // a site that ignores the query (its latest list) brings nothing on the screen
    results: () => relevantRows(s.results(), query),
    pending: () => s.pending(),
    answered: () => s.answered(),
    failed: () => s.failed(),
    failures: () => failuresOf(s.failed()),
    done: s.done,
    cancel: () => s.cancel(),
    subscribe: (cb) => subs.add(cb),
  };
}

interface SearchStarted {
  handle: string;
  sourceIds: string[];
}

function sanitizeFailures(v: unknown): RpcFailure[] {
  if (!Array.isArray(v)) return [];
  const out: RpcFailure[] = [];
  v.forEach((f) => {
    if (!f || typeof f !== 'object' || typeof f.id !== 'string') return;
    const one: RpcFailure = { id: f.id, message: str(f.message) };
    if (f.code === 'ipban' || f.code === 'tls' || f.code === 'cloudflare' || f.code === 'login') one.code = f.code;
    out.push(one);
  });
  return out;
}

function phoneHandle(query: string, started: SearchStarted): TvSearchHandle {
  const id = started.handle;
  const subs = listeners();
  const sourceIds = started.sourceIds.slice();
  let rows: TvResult[] = [];
  let pending = sourceIds.slice();
  let answered: string[] = [];
  let failed: string[] = [];
  let failures: RpcFailure[] = [];
  let rev = 0;
  let misses = 0;
  let over = false;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ts: TvSearchHandle | null = null;
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const end = (): void => {
    if (over) return;
    over = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (ts) ts.done.then(() => finish());
    else finish();
  };

  const fallback = (): void => {
    // the phone stopped answering: its unfinished sources count as failed, TorrServer takes over
    failed = failed.concat(pending);
    pending = [];
    failures = failures.concat([{ id: 'phone', message: '' }]);
    ts = torrServerSearch(query);
    ts.sourceIds.forEach((s) => sourceIds.push(s));
    ts.subscribe(() => subs.fire());
    end();
    subs.fire();
  };

  const schedule = (): void => {
    if (over || cancelled) return;
    timer = setTimeout(poll, POLL_MS);
  };

  function poll(): void {
    timer = null;
    if (over || cancelled) return;
    phoneRpc<RpcPoll>('searchPoll', { handle: id, rev: rev }).then(
      (p) => {
        if (over || cancelled) return;
        misses = 0;
        if (!p || typeof p !== 'object') {
          schedule();
          return;
        }
        const changed = p.rev !== rev || Array.isArray(p.results);
        if (typeof p.rev === 'number') rev = p.rev;
        if (Array.isArray(p.results)) {
          const next: TvResult[] = [];
          p.results.forEach((r) => {
            const row = fromRpcResult(r, id);
            if (row) next.push(row);
          });
          rows = next;
        }
        pending = strings(p.pending);
        answered = strings(p.answered);
        failures = sanitizeFailures(p.failed);
        failed = failures.map((f) => f.id);
        if (p.done === true) {
          pending = [];
          end();
          subs.fire();
          return;
        }
        if (changed) subs.fire();
        schedule();
      },
      (e) => {
        if (over || cancelled) return;
        if (e instanceof PhoneRpcError && e.code === 'expired') {
          // the phone dropped this search: keep the rows so far
          failed = failed.concat(pending);
          pending = [];
          end();
          subs.fire();
          return;
        }
        misses++;
        if (misses >= POLL_FAILURES) fallback();
        else schedule();
      },
    );
  }

  schedule();

  return {
    by: 'phone',
    sourceIds: sourceIds,
    results: () => {
      // the phone's rows without the ones that share no word with the query (TorrServer's are filtered by its handle)
      if (!ts) return relevantRows(rows, query);
      // a release found by both: keep the TorrServer row (it has a magnet and resolves on the TV)
      const theirs = ts.results();
      const seen: { [hash: string]: boolean } = {};
      theirs.forEach((r) => {
        if (r.hash) seen[r.hash] = true;
      });
      return relevantRows(rows, query).filter((r) => !r.hash || !seen[r.hash]).concat(theirs);
    },
    pending: () => (ts ? pending.concat(ts.pending()) : pending.slice()),
    answered: () => (ts ? answered.concat(ts.answered()) : answered.slice()),
    failed: () => (ts ? failed.concat(ts.failed()) : failed.slice()),
    failures: () => (ts ? failures.concat(ts.failures()) : failures.slice()),
    done: done,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      // a search that ended on its own (done, expired, or the fallback) stays on the phone: its rows still resolve
      if (!over) {
        phoneRpc('searchCancel', { handle: id }).then(
          () => undefined,
          () => undefined,
        );
      }
      if (ts) ts.cancel();
      over = true;
      finish();
    },
    subscribe: (cb) => subs.add(cb),
  };
}

/** A search through the phone's sources; rejects with the PhoneRpcError of `search`. */
export function phoneSearch(query: string): Promise<TvSearchHandle> {
  return phoneRpc<SearchStarted>('search', { query: query }).then((r) => {
    if (!r || typeof r !== 'object' || typeof r.handle !== 'string' || !r.handle) throw new PhoneRpcError('failed');
    return phoneHandle(query, { handle: r.handle, sourceIds: strings(r.sourceIds) });
  });
}

export interface TvSearchStart {
  handle: TvSearchHandle;
  /** phoneDown: a phone is linked but did not answer; noPhone: no phone is linked. */
  note: '' | 'phoneDown' | 'noPhone';
}

export function startTvSearch(query: string): Promise<TvSearchStart> {
  if (!phoneLink.value) return Promise.resolve({ handle: torrServerSearch(query), note: 'noPhone' as const });
  return phoneSearch(query).then(
    (handle) => ({ handle: handle, note: '' as const }),
    () => ({ handle: torrServerSearch(query), note: 'phoneDown' as const }),
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The link to add: the row's magnet, else the TV's own resolve for a TorrServer row, else the phone's `resolve`
 * (retried while the phone still fetches the release page). Rejects PhoneRpcError: 'timeout' when the phone
 * keeps answering pending, 'expired' when the search is gone (the screen asks to search again), 'failed' with
 * the phone's text (e.g. a release that exists only as a .torrent file on the phone).
 */
export function resolveTvResult(r: TvResult): Promise<string> {
  const via = r.via;
  if (r.Magnet || !via) return resolveLink(r, tvSourceContext());
  const ask = (n: number): Promise<string> =>
    phoneRpc<{ link?: unknown; pending?: unknown }>('resolve', { handle: via.handle, key: via.key }).then((a) => {
      if (a && typeof a.link === 'string') {
        const link = a.link.trim();
        if (ADDABLE.test(link)) return link;
        throw new PhoneRpcError('failed');
      }
      if (a && a.pending === true) {
        if (n >= RESOLVE_TRIES) throw new PhoneRpcError('timeout');
        return wait(RESOLVE_GAP_MS).then(() => ask(n + 1));
      }
      throw new PhoneRpcError('failed');
    });
  return ask(1);
}

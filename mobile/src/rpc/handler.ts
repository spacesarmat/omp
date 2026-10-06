// The methods of the TV search server (android/.../rpc/PhoneRpcService.kt): the TV asks the phone's sources through the
// hidden page mobile/rpc.html. Pure: every input comes from `deps`, the store and the view helpers; tested in
// mobile/tests/rpcHandler.test.ts. The wire shapes below are what the TV parses.
import { t } from '../../../src/i18n';
import { isStashedFile, takeStashedFile } from '../../../src/api/torrentFiles';
import { searchAll } from '../../../src/sources/search';
import { getHealth, isSourceOn, reloadSourcePrefs, setSourceOn } from '../../../src/sources/store';
import { isCloudflare, resolveLink, resultDate, resultKey, sortResults } from '../../../src/sources/view';
import type { Subscription } from '../../../src/monitor/types';
import { monitorMethods } from './monitorMethods';
import type { SearchHandle } from '../../../src/sources/search';
import type { Source, SourceContext, SourceResult } from '../../../src/sources/types';
import type { RpcFailure, RpcPoll, RpcResult, RpcSource, RpcSourceState } from '../../../src/phone/rpcTypes';

export interface RpcDeps {
  sources(): Source[];
  ctx(): SourceContext;
  now(): number;
  search?: typeof searchAll;
  resolve?: typeof resolveLink;
  /** Checks one subscription now over `from` (`subCheck`); absent: `subCheck` fails. */
  checkSubscription?: (sub: Subscription, from: Source[]) => Promise<unknown>;
}

export type RpcErrorCode = 'bad_request' | 'unknown_method' | 'expired' | 'failed';

export class RpcError extends Error {
  code: RpcErrorCode;
  constructor(code: RpcErrorCode, message?: string) {
    super(message || '');
    this.code = code;
    this.name = 'RpcError';
    Object.setPrototypeOf(this, RpcError.prototype);
  }
}

export const MAX_RESULTS = 300;
export const MAX_HANDLES = 3;
export const HANDLE_TTL_MS = 10 * 60_000;
export const RESOLVE_WAIT_MS = 3_500;
export const SOURCES_WAIT_MS = 3_500;
export const MAX_QUERY = 200;
const SWEEP_MS = 60_000;

export interface Resolving {
  promise: Promise<void>;
  state: 'pending' | 'ok' | 'error';
  link?: string;
  message?: string;
}

interface Live {
  id: string;
  search: SearchHandle;
  rev: number;
  used: number;
  /** resultKey(row) -> opaque key, and back: the TV never sees a row's URLs. */
  keys: Map<string, string>;
  rows: Map<string, string>;
  resolving: Map<string, Resolving>;
}

export type Params = { [k: string]: unknown };
export type ResolveAnswer = { link: string } | { pending: true };
export type ResolveRow = (cache: Map<string, Resolving>, key: string, find: () => SourceResult | undefined) => Promise<ResolveAnswer>;

function asParams(v: unknown): Params {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Params) : {};
}

export function bad(message: string): RpcError {
  return new RpcError('bad_request', message);
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') return (e as { message: string }).message;
  return String(e);
}

function randomId(): string {
  const bytes = new Uint8Array(8);
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return out;
}

export const searchable = (s: Source): boolean => s.kind !== 'torrserver';
/** What the TV's own TorrServer can add: a magnet, or an http(s) .torrent link it downloads itself. */
const ADDABLE = /^(magnet:\?|https?:\/\/)/i;

/** The opaque key of a row of `h`, made on first sight and kept for the life of the search. */
function opaqueKey(h: Live, r: SourceResult): string {
  const real = resultKey(r);
  let k = h.keys.get(real);
  if (!k) {
    k = (h.keys.size + 1).toString(36);
    h.keys.set(real, k);
    h.rows.set(k, real);
  }
  return k;
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0);

export function toRpcResult(r: SourceResult, key: string): RpcResult {
  const out: RpcResult = {
    key,
    Title: str(r.Title),
    Size: str(r.Size),
    Seed: num(r.Seed),
    Peer: num(r.Peer),
    Tracker: str(r.Tracker),
    CreateDate: str(r.CreateDate),
    Categories: str(r.Categories),
    Magnet: str(r.Magnet),
    Hash: str(r.Hash) || str(r.hash),
    source: str(r.source),
  };
  if (typeof r.sizeBytes === 'number' && isFinite(r.sizeBytes)) out.sizeBytes = r.sizeBytes;
  const date = resultDate(r);
  if (date) out.date = date;
  if (Array.isArray(r.sources) && r.sources.length) out.sources = r.sources.filter((s) => typeof s === 'string');
  return out;
}

function failure(id: string): RpcFailure {
  const h = getHealth(id);
  const message = (h && h.message) || '';
  const out: RpcFailure = { id, message };
  if (h && h.code) out.code = h.code;
  else if (h && h.state === 'login') out.code = 'login';
  else if (isCloudflare(message)) out.code = 'cloudflare';
  return out;
}

/** loggedIn() of the source, undefined when it has none, failed, or did not answer within SOURCES_WAIT_MS. */
function loggedIn(s: Source, ctx: SourceContext): Promise<boolean | undefined> {
  if (!s.loggedIn) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), SOURCES_WAIT_MS);
    const end = (v: boolean | undefined) => {
      clearTimeout(timer);
      resolve(v);
    };
    try {
      Promise.resolve(s.loggedIn!(ctx)).then(
        (v) => end(typeof v === 'boolean' ? v : undefined),
        () => end(undefined),
      );
    } catch {
      end(undefined);
    }
  });
}

/** The state the phone's Sources screen (mobile/src/screens/Sources.tsx) shows, as one word. */
function sourceState(s: Source, on: boolean, logged: boolean | undefined): { state: RpcSourceState; message?: string } {
  if (!on) return { state: 'off' };
  if (s.needsLogin && logged === false) return { state: 'login' };
  const h = getHealth(s.id);
  if (h && h.state !== 'ok') {
    const message = h.message || '';
    if (h.state === 'login') return message ? { state: 'login', message } : { state: 'login' };
    if (isCloudflare(message)) return { state: 'cloudflare', message };
    return message ? { state: 'error', message } : { state: 'error' };
  }
  if (logged === true && !h) return { state: 'loggedIn' };
  if (h) return { state: 'ok' };
  return { state: 'unknown' };
}

export function createRpcHandler(deps: RpcDeps): { dispatch(method: string, params: unknown): Promise<unknown>; dispose(): void } {
  const search = deps.search || searchAll;
  const resolve = deps.resolve || resolveLink;
  const handles = new Map<string, Live>();
  let sweeper: ReturnType<typeof setInterval> | null = null;

  const drop = (h: Live) => {
    handles.delete(h.id);
    try {
      h.search.cancel();
    } catch {
      /* the handle is gone either way */
    }
    if (!handles.size && sweeper) {
      clearInterval(sweeper);
      sweeper = null;
    }
  };

  const sweep = () => {
    const now = deps.now();
    Array.from(handles.values()).forEach((h) => {
      if (now - h.used > HANDLE_TTL_MS) drop(h);
    });
  };

  const live = (p: Params): Live => {
    if (typeof p.handle !== 'string' || !p.handle) throw bad('handle');
    const h = handles.get(p.handle);
    if (!h) throw new RpcError('expired');
    const now = deps.now();
    if (now - h.used > HANDLE_TTL_MS) {
      drop(h);
      throw new RpcError('expired');
    }
    h.used = now;
    return h;
  };

  /**
   * The link of `row` for the TV: answers within RESOLVE_WAIT_MS with `{link}`, or `{pending:true}` while the phone is
   * still fetching it (the TV asks again). `cache` keeps the fetch between calls; `find` is asked only on the first
   * call and must return a row this phone found (undefined is a bad key).
   */
  const resolveRow = async (cache: Map<string, Resolving>, key: string, find: () => SourceResult | undefined): Promise<ResolveAnswer> => {
    let r = cache.get(key);
    if (!r) {
      const row = find();
      if (!row) throw bad('key');
      let started: Promise<string>;
      try {
        started = Promise.resolve(resolve(row, deps.ctx()));
      } catch (e) {
        started = Promise.reject(e);
      }
      const entry: Resolving = { state: 'pending', promise: Promise.resolve() };
      entry.promise = started.then(
        (link) => {
          if (typeof link === 'string' && isStashedFile(link)) {
            // a .torrent the phone downloaded itself (rustorka, kinozal, an indexer): its bytes stay in this page,
            // the TV's TorrServer cannot add it
            takeStashedFile(link);
            entry.state = 'error';
            entry.message = t('sources.tvFileOnly');
            return;
          }
          if (typeof link !== 'string' || !ADDABLE.test(link.trim())) {
            entry.state = 'error';
            entry.message = t('sources.cannotGetLink');
            return;
          }
          entry.state = 'ok';
          entry.link = link.trim();
        },
        (e: unknown) => {
          entry.state = 'error';
          entry.message = errorText(e);
        },
      );
      cache.set(key, entry);
      r = entry;
    }
    if (r.state === 'pending') {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([r.promise, new Promise<void>((res) => (timer = setTimeout(res, RESOLVE_WAIT_MS)))]);
      if (timer !== undefined) clearTimeout(timer);
    }
    if (r.state === 'ok') return { link: r.link! };
    if (r.state === 'error') {
      // the next call tries again (the person may have signed in on the phone meanwhile)
      cache.delete(key);
      throw new RpcError('failed', r.message);
    }
    return { pending: true };
  };

  const methods: { [name: string]: (p: Params) => Promise<unknown> | unknown } = {
    async sources() {
      reloadSourcePrefs();
      const ctx = deps.ctx();
      const list = deps.sources().filter(searchable);
      const ons = list.map((s) => isSourceOn(s));
      const logged = await Promise.all(list.map((s, i) => (ons[i] ? loggedIn(s, ctx) : Promise.resolve(undefined))));
      const sources: RpcSource[] = list.map((s, i) => ({ id: s.id, name: s.name, on: ons[i], ...sourceState(s, ons[i], logged[i]) }));
      return { sources };
    },

    search(p) {
      const query = typeof p.query === 'string' ? p.query.trim() : '';
      if (!query || query.length > MAX_QUERY) throw bad('query');
      let wanted: string[] | null = null;
      if (p.sources !== undefined && p.sources !== null) {
        if (!Array.isArray(p.sources) || p.sources.some((x) => typeof x !== 'string')) throw bad('sources');
        wanted = p.sources as string[];
      }
      reloadSourcePrefs();
      const chosen = deps
        .sources()
        .filter((s) => searchable(s) && isSourceOn(s) && (!wanted || wanted.indexOf(s.id) >= 0));
      while (handles.size >= MAX_HANDLES) {
        let oldest: Live | null = null;
        handles.forEach((h) => {
          if (!oldest) oldest = h;
        });
        drop(oldest!);
      }
      let id = randomId();
      while (handles.has(id)) id = randomId();
      const entry: Live = { id, search: null as unknown as SearchHandle, rev: 1, used: deps.now(), keys: new Map(), rows: new Map(), resolving: new Map() };
      const bump = () => {
        entry.rev++;
      };
      entry.search = search(query, {
        ctx: deps.ctx(),
        from: chosen,
        sources: chosen.map((s) => s.id),
        onResult: bump,
        onDone: bump,
      });
      handles.set(id, entry);
      if (!sweeper) sweeper = setInterval(sweep, SWEEP_MS);
      return { handle: id, sourceIds: entry.search.sourceIds.slice() };
    },

    searchPoll(p) {
      const h = live(p);
      const s = h.search;
      const out: RpcPoll = {
        rev: h.rev,
        done: s.pending().length === 0,
        pending: s.pending().slice(),
        answered: s.answered().slice(),
        failed: s.failed().map(failure),
      };
      if (p.rev !== h.rev) out.results = sortResults(s.results(), 'seeds').slice(0, MAX_RESULTS).map((r) => toRpcResult(r, opaqueKey(h, r)));
      return out;
    },

    searchCancel(p) {
      if (typeof p.handle !== 'string') throw bad('handle');
      const h = handles.get(p.handle);
      if (h) drop(h);
      return {};
    },

    setSourceEnabled(p) {
      if (typeof p.id !== 'string' || typeof p.on !== 'boolean') throw bad('id/on');
      const id = p.id;
      const s = deps.sources().filter((x) => x.id === id)[0];
      if (!s || !searchable(s)) throw bad('id');
      // setSourceOn saves the whole prefs object: re-read it first, or the app's changes since the last read are undone
      reloadSourcePrefs();
      setSourceOn(id, p.on);
      return { on: p.on };
    },

    resolve(p) {
      const h = live(p);
      if (typeof p.key !== 'string' || !p.key) throw bad('key');
      const key = p.key;
      // only a row this phone found in this search: the TV cannot make the phone fetch an address of its choice
      return resolveRow(h.resolving, key, () => {
        const real = h.rows.get(key);
        return real === undefined ? undefined : h.search.results().filter((x) => resultKey(x) === real)[0];
      });
    },

    ...monitorMethods({ deps, resolveRow }),
  };

  return {
    dispatch(method, params) {
      const m = Object.prototype.hasOwnProperty.call(methods, method) ? methods[method] : undefined;
      if (!m) return Promise.reject(new RpcError('unknown_method', method));
      try {
        return Promise.resolve(m(asParams(params)));
      } catch (e) {
        return Promise.reject(e);
      }
    },
    dispose() {
      Array.from(handles.values()).forEach(drop);
      if (sweeper) clearInterval(sweeper);
      sweeper = null;
    },
  };
}

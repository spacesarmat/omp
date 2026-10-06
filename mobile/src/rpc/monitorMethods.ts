// Monitoring methods of the TV search server: the new-findings feed, subscriptions and "want to watch" for the TV.
// The store is read on every call (the phone app's own page writes the same localStorage keys). Tested in
// mobile/tests/rpcMonitor.test.ts.
import {
  addSubscription,
  FOUND_MAX,
  getSubscription,
  loadFound,
  loadSubs,
  markFindingsSeen,
  removeSubscription,
  sameQuery,
  updateSubscription,
} from '../../../src/monitor/subs';
import { reloadSourcePrefs } from '../../../src/sources/store';
import { loadLastRun } from '../../../src/monitor/settings';
import { BETTER_ID, EPISODES_ID, type Finding, type Subscription } from '../../../src/monitor/types';
import type { RpcFeed, RpcFinding, RpcFindingKind, RpcSub } from '../../../src/phone/rpcTypes';
import { bad, MAX_QUERY, RpcError, searchable, toRpcResult, type Params, type Resolving, type ResolveRow, type RpcDeps } from './handler';

/** Subscriptions with a `subCheck` running (module-level: one RPC page serves one TV at a time, but a check outlives a handler). */
const checking: { [id: string]: true } = {};

function kindOf(subId: string): RpcFindingKind {
  return subId === EPISODES_ID ? 'episodes' : subId === BETTER_ID ? 'better' : 'sub';
}

function toRpcFinding(f: Finding, subs: Subscription[]): RpcFinding {
  const kind = kindOf(f.subId);
  let title = '';
  if (kind === 'episodes' && f.episodes) title = f.episodes.torrentTitle;
  else if (kind === 'better' && f.better) title = f.better.torrentTitle;
  else {
    const sub = subs.filter((s) => s.id === f.subId)[0];
    title = sub ? sub.query : '';
  }
  const out: RpcFinding = { subId: f.subId, key: f.key, kind, at: f.at, seen: f.seen === true, result: toRpcResult(f.result, f.key), title: title || f.result.Title };
  if (f.episodes) {
    const e = f.episodes;
    out.episodes = e.from !== undefined
      ? { torrentHash: e.torrentHash, season: e.season, from: e.from, to: e.to }
      : { torrentHash: e.torrentHash, season: e.season, to: e.to };
  }
  if (f.better) out.better = { torrentHash: f.better.torrentHash, have: f.better.have, got: f.better.got };
  return out;
}

function toRpcSub(s: Subscription, found: Finding[]): RpcSub {
  return {
    id: s.id,
    query: s.query,
    quality: s.quality,
    notify: s.notify,
    better: s.better === true,
    unseen: found.filter((f) => !f.seen && f.subId === s.id).length,
    checking: checking[s.id] === true,
    createdAt: s.createdAt,
  };
}

function subOf(id: string): RpcSub {
  const s = getSubscription(id);
  if (!s) throw bad('id');
  return toRpcSub(s, loadFound());
}

function idParam(p: Params, name = 'id'): string {
  if (typeof p[name] !== 'string' || !p[name]) throw bad(name);
  return p[name] as string;
}

function optBool(p: Params, name: string): boolean | undefined {
  const v = p[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') throw bad(name);
  return v;
}

export function monitorMethods(kit: { deps: RpcDeps; resolveRow: ResolveRow }): { [name: string]: (p: Params) => Promise<unknown> | unknown } {
  const { deps, resolveRow } = kit;
  /** Links of findings being fetched, by subId + ' ' + key. */
  const links = new Map<string, Resolving>();

  return {
    feed(): RpcFeed {
      const subs = loadSubs();
      const findings = loadFound()
        .slice(0, FOUND_MAX)
        .map((f) => toRpcFinding(f, subs));
      const last = loadLastRun();
      return { findings, lastRun: last ? last.at : null };
    },

    subs(): { subs: RpcSub[] } {
      const found = loadFound();
      return { subs: loadSubs().map((s) => toRpcSub(s, found)) };
    },

    subCheck(p) {
      const id = idParam(p);
      const sub = getSubscription(id);
      if (!sub) throw bad('id');
      const check = deps.checkSubscription;
      if (!check) throw new RpcError('failed');
      if (checking[id]) return { started: true };
      checking[id] = true;
      const clear = () => {
        delete checking[id];
      };
      let run: Promise<unknown>;
      try {
        // like `search`: the app may have switched sources or added an indexer since this page started
        reloadSourcePrefs();
        run = Promise.resolve(check(sub, deps.sources().filter(searchable)));
      } catch (e) {
        run = Promise.reject(e);
      }
      run.then(clear, clear);
      return { started: true };
    },

    subSet(p) {
      const id = idParam(p);
      const notify = optBool(p, 'notify');
      const better = optBool(p, 'better');
      const patch: { notify?: boolean; better?: boolean } = {};
      if (notify !== undefined) patch.notify = notify;
      if (better !== undefined) patch.better = better;
      if (!getSubscription(id)) throw bad('id');
      if (Object.keys(patch).length && !updateSubscription(id, patch)) throw bad('id');
      return { sub: subOf(id) };
    },

    subRemove(p) {
      const id = idParam(p);
      // only a real subscription: the reserved ids (EPISODES_ID, BETTER_ID) would wipe those findings
      if (getSubscription(id)) removeSubscription(id);
      return { removed: true };
    },

    wantAdd(p) {
      const query = typeof p.query === 'string' ? p.query.replace(/\s+/g, ' ').trim() : '';
      if (!query || query.length > MAX_QUERY) throw bad('query');
      const better = optBool(p, 'better');
      const found = loadFound();
      const had = loadSubs().filter((s) => sameQuery(s.query, query))[0];
      if (had) return { sub: toRpcSub(had, found), created: false };
      const sub = addSubscription({ query, quality: '', sources: null, notify: true, better: better !== false }, deps.now());
      if (!sub) throw bad('query');
      return { sub: toRpcSub(sub, found), created: true };
    },

    findingLink(p) {
      const subId = idParam(p, 'subId');
      const key = idParam(p, 'key');
      // only a finding stored on this phone: the TV cannot make the phone fetch an address of its choice
      return resolveRow(links, subId + ' ' + key, () => {
        const f = loadFound().filter((x) => x.subId === subId && x.key === key)[0];
        return f ? f.result : undefined;
      });
    },

    findingsSeen(p) {
      let subId: string | undefined;
      let keys: string[] | undefined;
      if (p.subId !== undefined && p.subId !== null) subId = idParam(p, 'subId');
      if (p.keys !== undefined && p.keys !== null) {
        if (!Array.isArray(p.keys) || p.keys.some((k) => typeof k !== 'string')) throw bad('keys');
        keys = p.keys as string[];
      }
      markFindingsSeen(subId, keys);
      return { ok: true };
    },
  };
}

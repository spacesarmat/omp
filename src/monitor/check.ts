// Checking subscriptions: the unified search over the subscription's sources, its filters, then the results not seen
// before. A «Только лучшее качество» subscription reports only the best new result above the best rank it reported
// before. The first check of a subscription (and the first answer of each source) only remembers what is there.
// Chromium 53 safe.
import { searchAll, SOURCE_TIMEOUT_MS, type SearchAllOptions, type SearchHandle } from '../sources/search';
import type { Source, SourceContext, SourceResult } from '../sources/types';
import { filterForSubscription, isSeen, resultKeys, seenEntry, seenIndex } from './match';
import { qualityRank } from './quality';
import { addFindings, bestRank, getSubscription, loadSubs, rememberBestRank, rememberSeen, sameSearch, seenKeys, seenSources } from './subs';
import type { Finding, Subscription } from './types';

/** searchAll or a test double. */
export type SearchFn = (query: string, opts: SearchAllOptions) => SearchHandle;

export interface CheckOptions {
  /** Default: searchAll. */
  search?: SearchFn;
  /** Candidate sources for the search (default: allSources()). */
  from?: Source[];
  /** Per-source timeout, ms (default: SOURCE_TIMEOUT_MS). */
  timeoutMs?: number;
  /** Unix ms of the findings (default: now). */
  now?: number;
}

export interface CheckAllOptions extends CheckOptions {
  /** Default: the saved subscriptions. */
  subs?: Subscription[];
  /** Subscriptions searched at the same time (default 2: the sites are not flooded). */
  concurrency?: number;
}

export interface SubCheckResult {
  sub: Subscription;
  /** New results (saved to the findings), best first as merged by the search. */
  findings: Finding[];
  /** The first check of the subscription: what was found only became «seen». */
  first: boolean;
  /** Source ids that answered / failed. No answer at all leaves the seen keys untouched. */
  answered: string[];
  failed: string[];
}

export interface CheckResult {
  /** Every new finding, subscription by subscription. */
  findings: Finding[];
  subs: SubCheckResult[];
  /** When the check ran, unix ms. */
  at: number;
}

interface SearchOutcome {
  results: SourceResult[];
  answered: string[];
  failed: string[];
}

function runSearch(query: string, ctx: SourceContext, sources: string[] | undefined, opts: CheckOptions): Promise<SearchOutcome> {
  const search = opts.search || searchAll;
  let h: SearchHandle;
  try {
    // background runs keep the normal per-source timeout for Cloudflare sites too (the run has a deadline); a hidden
    // check still finishes natively and its cookies serve the next run
    h = search(query, { ctx, sources, from: opts.from, timeoutMs: opts.timeoutMs, cloudflareTimeoutMs: opts.timeoutMs || SOURCE_TIMEOUT_MS });
  } catch (e) {
    return Promise.resolve({ results: [], answered: [], failed: [] });
  }
  return h.done.then(
    () => ({ results: h.results(), answered: h.answered(), failed: h.failed() }),
    () => ({ results: [], answered: [], failed: h.failed() }),
  );
}

/** The source ids of a merged result (the kept one and its duplicates). */
function sourcesOf(r: SourceResult): string[] {
  return [r.source].concat(r.sources || []);
}

/** The highest quality rank among `list` (-1 for an empty one). */
function topRank(list: SourceResult[]): number {
  let max = -1;
  list.forEach((r) => {
    const rank = qualityRank(r.Title);
    if (rank > max) max = rank;
  });
  return max;
}

/**
 * «Только лучшее качество»: the one best new result (rank, then seeds) above the floor, which is the highest rank among
 * the stored best rank and every result seen before (a better release already listed is not news). Without a stored
 * rank (the flag was just switched on) nothing is reported: the caller stores the current best rank.
 */
function bestOnly(subId: string, fresh: SourceResult[], known: SourceResult[]): SourceResult[] {
  const stored = bestRank(subId);
  if (stored < 0) return [];
  const floor = Math.max(stored, topRank(known));
  let pick: SourceResult | null = null;
  let pickRank = -1;
  for (let i = 0; i < fresh.length; i++) {
    const r = fresh[i];
    const rank = qualityRank(r.Title);
    if (rank <= floor) continue;
    if (!pick || rank > pickRank || (rank === pickRank && (r.Seed || 0) > (pick.Seed || 0))) {
      pick = r;
      pickRank = rank;
    }
  }
  return pick ? [pick] : [];
}

/**
 * Checks one subscription (see the file comment); never rejects. A source answering for the first time is silent too:
 * a result only it lists is remembered, not reported.
 */
export function checkSubscription(ctx: SourceContext, sub: Subscription, opts?: CheckOptions): Promise<SubCheckResult> {
  const o = opts || {};
  return runSearch(sub.query, ctx, sub.sources || undefined, o).then((out) => {
    const seen = seenKeys(sub.id);
    const base: SubCheckResult = { sub, findings: [], first: seen === null, answered: out.answered, failed: out.failed };
    if (!out.answered.length) return base;
    // deleted or edited while the search ran: its findings and seen results would be orphans (or stale)
    if (!sameSearch(sub, getSubscription(sub.id))) return base;
    const matched = filterForSubscription(sub, out.results);
    if (seen !== null) {
      const known = seenSources(sub.id);
      const index = seenIndex(seen);
      const at = o.now === undefined ? Date.now() : o.now;
      const isNew = (r: SourceResult) => !isSeen(r, index) && sourcesOf(r).some((id) => known.indexOf(id) >= 0);
      let fresh = matched.filter(isNew);
      if (sub.better) fresh = bestOnly(sub.id, fresh, matched.filter((r) => !isNew(r)));
      base.findings = fresh.map((r) => ({ subId: sub.id, key: resultKeys(r)[0], result: r, at }));
      addFindings(base.findings);
    }
    rememberSeen(sub.id, matched.map(seenEntry), out.answered);
    // the first check (and the first one after the flag was switched on) stores the best rank listed now, silently
    if (sub.better) rememberBestRank(sub.id, topRank(matched));
    return base;
  });
}

/** Checks the subscriptions (default: all saved), a few at a time; never rejects. */
export function checkSubscriptions(ctx: SourceContext, opts?: CheckAllOptions): Promise<CheckResult> {
  const o = opts || {};
  const subs = o.subs || loadSubs();
  const at = o.now === undefined ? Date.now() : o.now;
  const results: SubCheckResult[] = [];
  const limit = Math.max(1, o.concurrency || 2);
  let next = 0;
  const worker = (): Promise<void> => {
    if (next >= subs.length) return Promise.resolve();
    const i = next++;
    return checkSubscription(ctx, subs[i], { ...o, now: at }).then((r) => {
      results[i] = r;
      return worker();
    });
  };
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(limit, subs.length); w++) workers.push(worker());
  return Promise.all(workers).then(() => ({
    findings: results.reduce((acc: Finding[], r) => acc.concat(r.findings), []),
    subs: results,
    at,
  }));
}

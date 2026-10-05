// Monitoring store on the phone: subscriptions (tsp.subs), seen results per subscription (tsp.subsSeen, SEEN_MAX
// each) and the findings for the screen (tsp.monitorFound, the last FOUND_MAX). Read from localStorage on every call:
// the background page and the app write the same keys from different JS contexts. Chromium 53 safe.
import { isObject, loadJson, saveJson } from '../store/storage';
import type { SourceResult } from '../sources/types';
import { BETTER_ID, EPISODES_ID, type BetterInfo, type EpisodesInfo, type Finding, type SubQuality, type Subscription, type SubscriptionInput } from './types';

export const SUBS_KEY = 'tsp.subs';
export const SEEN_KEY = 'tsp.subsSeen';
export const FOUND_KEY = 'tsp.monitorFound';
/** Seen results kept per subscription (the latest check is always kept whole, up to SEEN_HARD_MAX). */
export const SEEN_MAX = 300;
export const SEEN_HARD_MAX = 2000;
export const FOUND_MAX = 100;
const QUERY_MAX = 200;

const QUALITIES: SubQuality[] = ['', '720', '1080', '2160'];

function finite(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function strings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const had: { [k: string]: boolean } = {};
  v.forEach((x) => {
    if (typeof x === 'string' && x && !had[x]) {
      had[x] = true;
      out.push(x);
    }
  });
  return out;
}

function cleanQuery(v: unknown): string {
  return str(v).replace(/\s+/g, ' ').trim().slice(0, QUERY_MAX);
}

/** A stored subscription, or null when it has no id or query; malformed options fall back to defaults. */
export function sanitizeSubscription(v: unknown): Subscription | null {
  if (!isObject(v)) return null;
  const id = str(v.id);
  const query = cleanQuery(v.query);
  if (!id || !query) return null;
  const quality = QUALITIES.indexOf(v.quality as SubQuality) >= 0 ? (v.quality as SubQuality) : '';
  const createdAt = finite(v.createdAt);
  const out: Subscription = {
    id,
    query,
    quality,
    sources: Array.isArray(v.sources) ? strings(v.sources) : null,
    notify: v.notify !== false,
    createdAt: createdAt !== null && createdAt > 0 ? createdAt : 0,
  };
  const seeds = finite(v.minSeeds);
  if (seeds !== null && seeds >= 1) out.minSeeds = Math.floor(seeds);
  const size = finite(v.maxSizeGb);
  if (size !== null && size > 0) out.maxSizeGb = size;
  if (v.better === true) out.better = true;
  return out;
}

export function sanitizeSubs(v: unknown): Subscription[] {
  if (!Array.isArray(v)) return [];
  const out: Subscription[] = [];
  v.forEach((x) => {
    const s = sanitizeSubscription(x);
    if (s && !out.some((o) => o.id === s.id)) out.push(s);
  });
  return out;
}

export function loadSubs(): Subscription[] {
  return sanitizeSubs(loadJson<unknown>(SUBS_KEY, [], Array.isArray));
}

export function saveSubs(list: Subscription[]): void {
  saveJson(SUBS_KEY, list);
}

export function getSubscription(id: string): Subscription | null {
  return loadSubs().filter((s) => s.id === id)[0] || null;
}

function newId(now: number, taken: Subscription[]): string {
  let id = '';
  do {
    id = 's' + now.toString(36) + Math.floor(Math.random() * 1679616).toString(36);
  } while (taken.some((s) => s.id === id));
  return id;
}

/** «+ Новая подписка» / «Подписаться»: the saved subscription, or null for an empty query. */
export function addSubscription(input: SubscriptionInput, now?: number): Subscription | null {
  const at = now === undefined ? Date.now() : now;
  const list = loadSubs();
  const sub = sanitizeSubscription({ ...input, id: newId(at, list), createdAt: at });
  if (!sub) return null;
  saveSubs(list.concat([sub]));
  return sub;
}

function searchOf(s: Subscription): string {
  return JSON.stringify([s.query, s.quality, s.minSeeds || 0, s.maxSizeGb || 0, s.sources]);
}

/** The subscription still exists with the same query and filters (a check that started earlier may be outdated). */
export function sameSearch(a: Subscription, b: Subscription | null): boolean {
  return !!b && searchOf(a) === searchOf(b);
}

/**
 * «Изменить»: merges `patch` (an undefined minSeeds / maxSizeGb clears it); null when unknown or the query is empty.
 * A new query, quality, seeds, size or sources forgets the seen results: the next check is silent, like the first.
 */
export function updateSubscription(id: string, patch: Partial<SubscriptionInput>): Subscription | null {
  const list = loadSubs();
  for (let i = 0; i < list.length; i++) {
    if (list[i].id !== id) continue;
    const merged: { [k: string]: unknown } = { ...list[i] };
    Object.keys(patch).forEach((k) => {
      merged[k] = (patch as { [k: string]: unknown })[k];
    });
    const next = sanitizeSubscription(merged);
    if (!next) return null;
    const changed = searchOf(next) !== searchOf(list[i]);
    list[i] = next;
    saveSubs(list);
    // another query or other filters see other results: start over silently instead of reporting old ones as new
    if (changed) forgetSeen(id);
    return next;
  }
  return null;
}

/** Deletes the subscription with its seen results and findings. */
export function removeSubscription(id: string): void {
  saveSubs(loadSubs().filter((s) => s.id !== id));
  forgetSeen(id);
  removeFindings(id);
}

// --- seen results
// tsp.subsSeen: { [subId]: { k: entries, s: source ids that have answered, b?: best rank reported by a «Только лучшее качество» subscription } }. An entry is one result: its seen keys
// joined by '|' (see match.ts seenEntry). Every entry of the latest check is kept, older ones fill up to SEEN_MAX.

interface SeenRecord {
  k: string[];
  s: string[];
  /** Best quality rank reported («Только лучшее качество»). */
  b?: number;
}

function loadSeen(): { [subId: string]: SeenRecord } {
  const v = loadJson<unknown>(SEEN_KEY, {}, isObject) as { [k: string]: unknown };
  const out: { [subId: string]: SeenRecord } = {};
  Object.keys(v).forEach((id) => {
    const r = v[id];
    if (Array.isArray(r)) out[id] = { k: strings(r).slice(0, SEEN_HARD_MAX), s: [] };
    else if (isObject(r) && Array.isArray(r.k)) {
      const rec: SeenRecord = { k: strings(r.k).slice(0, SEEN_HARD_MAX), s: strings(r.s) };
      const b = finite(r.b);
      if (b !== null && b >= -1) rec.b = b;
      out[id] = rec;
    }
  });
  return out;
}

/** Entries already seen by a subscription (or EPISODES_ID); null before its first check. */
export function seenKeys(subId: string): string[] | null {
  const seen = loadSeen();
  return Object.prototype.hasOwnProperty.call(seen, subId) ? seen[subId].k : null;
}

/** Source ids that have answered a check of the subscription (their first answer is silent). */
export function seenSources(subId: string): string[] {
  const r = loadSeen()[subId];
  return r ? r.s.slice() : [];
}

/**
 * Remembers the entries of the latest check: all of them first (each once, never trimmed), then older ones up to
 * SEEN_MAX in all; `sources` are added to the answered sources. An empty list marks «checked».
 */
export function rememberSeen(subId: string, entries: string[], sources?: string[]): void {
  const seen = loadSeen();
  const prev = seen[subId] || { k: [], s: [] };
  const fresh = strings(entries).slice(0, SEEN_HARD_MAX);
  const index: { [k: string]: boolean } = {};
  fresh.forEach((k) => {
    index[k] = true;
  });
  const old = prev.k.filter((k) => !index[k]);
  const k = fresh.concat(old.slice(0, Math.max(0, SEEN_MAX - fresh.length)));
  const s = prev.s.concat(strings(sources).filter((id) => prev.s.indexOf(id) < 0));
  seen[subId] = prev.b !== undefined ? { k, s, b: prev.b } : { k, s };
  saveJson(SEEN_KEY, seen);
}

/** Forgets what a subscription has seen: its next check is silent again, like the first. */
export function forgetSeen(subId: string): void {
  const seen = loadSeen();
  if (!seen[subId]) return;
  delete seen[subId];
  saveJson(SEEN_KEY, seen);
}

/** A best rank is stored (-1 included: nothing was listed at the first check) — the flag has been through a check. */
export function hasBestRank(subId: string): boolean {
  const r = loadSeen()[subId];
  return !!r && r.b !== undefined;
}

/** The best quality rank reported by a «Только лучшее качество» subscription; -1 when none is stored (or nothing was listed). */
export function bestRank(subId: string): number {
  const r = loadSeen()[subId];
  return r && r.b !== undefined ? r.b : -1;
}

/**
 * Raises the reported rank (never lowers it). Lives in the seen record: a new query or filters (forgetSeen) reset it.
 * A no-op before the first check (no record yet: that check is silent anyway).
 */
export function rememberBestRank(subId: string, rank: number): void {
  const seen = loadSeen();
  const prev = seen[subId];
  if (!prev || (prev.b !== undefined && prev.b >= rank)) return;
  seen[subId] = { k: prev.k, s: prev.s, b: rank };
  saveJson(SEEN_KEY, seen);
}

// --- findings

const HASH = /^[0-9a-f]{40}$/;

/** A stored result, or null without a title or source. */
export function sanitizeResult(v: unknown): SourceResult | null {
  if (!isObject(v)) return null;
  const Title = str(v.Title);
  const source = str(v.source);
  if (!Title || !source) return null;
  const peer = finite(v.Peer);
  const seed = finite(v.Seed);
  const r: SourceResult = {
    Title,
    Categories: str(v.Categories),
    Size: str(v.Size),
    CreateDate: str(v.CreateDate),
    Tracker: str(v.Tracker),
    Link: str(v.Link),
    Magnet: str(v.Magnet),
    Hash: str(v.Hash),
    Peer: peer !== null && peer > 0 ? peer : 0,
    Seed: seed !== null && seed > 0 ? seed : 0,
    source,
  };
  const others = strings(v.sources);
  if (others.length) r.sources = others;
  if (typeof v.detailUrl === 'string' && v.detailUrl) r.detailUrl = v.detailUrl;
  if (typeof v.hash === 'string' && HASH.test(v.hash)) r.hash = v.hash;
  const date = finite(v.date);
  if (date !== null && date > 0) r.date = date;
  const size = finite(v.sizeBytes);
  if (size !== null && size >= 0) r.sizeBytes = size;
  if (typeof v.groupKey === 'string' && v.groupKey) r.groupKey = v.groupKey;
  return r;
}

function sanitizeEpisodes(v: unknown): EpisodesInfo | null {
  if (!isObject(v)) return null;
  const season = finite(v.season);
  const haveTo = finite(v.haveTo);
  const to = finite(v.to);
  const hash = str(v.torrentHash);
  if (!hash || season === null || haveTo === null || to === null) return null;
  const e: EpisodesInfo = { torrentHash: hash, torrentTitle: str(v.torrentTitle), season, haveTo, to };
  const from = finite(v.from);
  if (from !== null) e.from = from;
  return e;
}

function sanitizeBetter(v: unknown): BetterInfo | null {
  if (!isObject(v)) return null;
  const hash = str(v.torrentHash);
  if (!hash) return null;
  return { torrentHash: hash, torrentTitle: str(v.torrentTitle), have: str(v.have), got: str(v.got) };
}

export function sanitizeFinding(v: unknown): Finding | null {
  if (!isObject(v)) return null;
  const subId = str(v.subId);
  const key = str(v.key);
  const at = finite(v.at);
  const result = sanitizeResult(v.result);
  if (!subId || !key || at === null || !result) return null;
  const f: Finding = { subId, key, result, at };
  if (v.seen === true) f.seen = true;
  if (subId === EPISODES_ID) {
    const e = sanitizeEpisodes(v.episodes);
    if (!e) return null;
    f.episodes = e;
  }
  if (subId === BETTER_ID) {
    const b = sanitizeBetter(v.better);
    if (!b) return null;
    f.better = b;
  }
  return f;
}

/** Every stored finding, newest first. */
export function loadFound(): Finding[] {
  const v = loadJson<unknown>(FOUND_KEY, [], Array.isArray) as unknown[];
  const out: Finding[] = [];
  v.forEach((x) => {
    const f = sanitizeFinding(x);
    if (f) out.push(f);
  });
  return out.sort((a, b) => b.at - a.at).slice(0, FOUND_MAX);
}

function saveFound(list: Finding[]): void {
  saveJson(FOUND_KEY, list.slice(0, FOUND_MAX));
}

/** Findings of one subscription (or EPISODES_ID), newest first. */
export function findingsOf(subId: string): Finding[] {
  return loadFound().filter((f) => f.subId === subId);
}

function sameCard(a: Finding, b: Finding): boolean {
  if (a.subId !== b.subId) return false;
  if (a.key === b.key) return true;
  // one card per library torrent: a newer release replaces the older one
  return (
    (!!a.episodes && !!b.episodes && a.episodes.torrentHash === b.episodes.torrentHash) ||
    (!!a.better && !!b.better && a.better.torrentHash === b.better.torrentHash)
  );
}

/** Adds findings (a finding with the same key — or of the same library torrent — is replaced), newest first. */
export function addFindings(list: Finding[]): void {
  if (!list.length) return;
  let all = loadFound();
  list.forEach((f) => {
    all = all.filter((o) => !sameCard(o, f));
    all.push(f);
  });
  saveFound(all.sort((a, b) => b.at - a.at));
}

/** Marks findings looked at: all, those of a subscription, or only `keys` of it. */
export function markFindingsSeen(subId?: string, keys?: string[]): void {
  let changed = false;
  const all = loadFound().map((f) => {
    if (f.seen || (subId !== undefined && f.subId !== subId) || (keys && keys.indexOf(f.key) < 0)) return f;
    changed = true;
    return { ...f, seen: true };
  });
  if (changed) saveFound(all);
}

/** Drops the findings of a subscription, or one of them by key. */
export function removeFindings(subId: string, key?: string): void {
  const all = loadFound();
  const left = all.filter((f) => f.subId !== subId || (key !== undefined && f.key !== key));
  if (left.length !== all.length) saveFound(left);
}

/** Drops the new-episodes and better-quality cards of library torrents for which `keep(hash)` is false (gone). */
export function pruneEpisodeFindings(keep: (hash: string) => boolean): void {
  const all = loadFound();
  const left = all.filter((f) => {
    if (f.subId === EPISODES_ID && f.episodes) return keep(f.episodes.torrentHash);
    if (f.subId === BETTER_ID && f.better) return keep(f.better.torrentHash);
    return true;
  });
  if (left.length !== all.length) saveFound(left);
}

/** Findings not looked at yet (the bell badge), of one subscription or all. */
export function unseenCount(subId?: string): number {
  return loadFound().filter((f) => !f.seen && (subId === undefined || f.subId === subId)).length;
}

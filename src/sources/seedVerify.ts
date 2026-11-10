// Asks billing to check the top rows, then writes the answer onto a copy of the list.
// The first paint stays the tracker numbers. Chromium 53 safe: no ?., no ??, no async.
import { billingPost } from '../billing/client';
import { billingSession } from '../billing/session';
import { withDeviceToken } from '../billing/tokens';
import { infohashOf } from './liveSeeds';
import { rankSearchResults } from './seedRank';
import type { SourceContext, SourceResult } from './types';

export const SEED_CHECK_LIMIT = 30;
export const SEED_CHECK_TIMEOUT_MS = 8000;
const SEED_CHECK_DELAY_MS = 1200;

export interface SeedMeasure {
  infohash: string;
  verified: boolean;
  live: boolean;
  seeders: number;
  leechers: number;
  seedersMax: number;
  seedersMedian: number;
  peers: number;
  samples: number;
  measuredAt: number;
}

export function seedCheckAvailable(ctx: SourceContext | null): boolean {
  if (!ctx || !ctx.http || typeof ctx.http.post !== 'function') return false;
  if (!billingSession()) return false;
  return true;
}

function trackersOf(r: SourceResult): string[] {
  const magnet = r.Magnet || '';
  const out: string[] = [];
  const seen: { [k: string]: boolean } = {};
  const re = /[?&]tr=([^&]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(magnet)) && out.length < 4) {
    let raw = m[1];
    try {
      raw = decodeURIComponent(raw.replace(/\+/g, '%20'));
    } catch (e) {
      continue;
    }
    if (!raw || raw.length > 300 || seen[raw]) continue;
    seen[raw] = true;
    out.push(raw);
  }
  return out;
}

/** The rows worth a server check: best by the current ranking, and only those with an infohash. */
export function pickProbeRows(rows: SourceResult[], query: string, limit: number): SourceResult[] {
  const ranked = rankSearchResults(rows, query, 0);
  const out: SourceResult[] = [];
  const seen: { [h: string]: boolean } = {};
  for (let i = 0; i < ranked.length && out.length < limit; i++) {
    const hash = infohashOf(ranked[i]);
    if (!hash || seen[hash]) continue;
    seen[hash] = true;
    out.push(ranked[i]);
  }
  return out;
}

export function parseSeedResponse(text: string): SeedMeasure[] | null {
  let v: { items?: unknown };
  try {
    v = JSON.parse(text || '') as { items?: unknown };
  } catch (e) {
    return null;
  }
  if (!v || !Array.isArray(v.items)) return null;
  const out: SeedMeasure[] = [];
  for (let i = 0; i < v.items.length; i++) {
    const it = v.items[i] as { [k: string]: unknown };
    if (!it) continue;
    const hash = typeof it.infohash === 'string' ? it.infohash.toLowerCase() : '';
    if (!/^[0-9a-f]{40}$/.test(hash)) continue;
    const num = (k: string) => (typeof it[k] === 'number' && isFinite(it[k] as number) ? Math.floor(it[k] as number) : 0);
    out.push({
      infohash: hash,
      verified: it.verified === true,
      live: it.live === true,
      seeders: num('seeders'),
      leechers: num('leechers'),
      seedersMax: num('seedersMax'),
      seedersMedian: num('seedersMedian'),
      peers: num('peers'),
      samples: num('samples'),
      measuredAt: num('measuredAt'),
    });
  }
  return out;
}

/** Copies the round onto the rows. Hashes that were not confirmed are marked unverified. */
export function applySeedRound(rows: SourceResult[], measures: SeedMeasure[] | null, finished: boolean): SourceResult[] {
  if (!finished || !measures) return rows;
  const by: { [h: string]: SeedMeasure } = {};
  for (let i = 0; i < measures.length; i++) by[measures[i].infohash] = measures[i];
  return rows.map((r) => {
    const hash = infohashOf(r);
    if (!hash) return { ...r, seedCheck: 'unverified' as const };
    const m = by[hash];
    if (m && m.verified && m.live) {
      return {
        ...r,
        hash: r.hash || hash,
        Seed: m.seeders,
        Peer: m.leechers,
        seedCheck: 'live' as const,
        seedCheckAt: m.measuredAt,
        seedersMax: m.seedersMax,
        seedersMedian: m.seedersMedian,
        dhtPeers: m.peers,
      };
    }
    if (m && m.verified && m.peers > 0) {
      return { ...r, hash: r.hash || hash, seedCheck: 'dht' as const, seedCheckAt: m.measuredAt, dhtPeers: m.peers };
    }
    return { ...r, hash: r.hash || hash, seedCheck: 'unverified' as const };
  });
}

export function requestSeedCheck(rows: SourceResult[], query: string, ctx: SourceContext): Promise<SeedMeasure[] | null> {
  if (!seedCheckAvailable(ctx)) return Promise.resolve(null);
  const picked = pickProbeRows(rows, query, SEED_CHECK_LIMIT);
  if (!picked.length) return Promise.resolve([]);
  const items: { infohash: string; trackers: string[] }[] = [];
  for (let i = 0; i < picked.length; i++) {
    const hash = infohashOf(picked[i]);
    if (!hash) continue;
    items.push({ infohash: hash, trackers: trackersOf(picked[i]) });
  }
  if (!items.length) return Promise.resolve([]);
  return withDeviceToken(ctx, (headers) =>
    billingPost(ctx, '/v1/seed-check', { items: JSON.stringify(items) }, { headers: headers, timeoutMs: SEED_CHECK_TIMEOUT_MS }),
  ).then(
    (res) => {
      if (res.status !== 200) return null;
      return parseSeedResponse(res.text);
    },
    () => null,
  );
}

export interface SeedWatch {
  notify(): void;
  cancel(): void;
}

/**
 * One check per search. It starts when the sources have finished, or `delayMs` after the first rows,
 * whichever comes first. A missing session does nothing, and the tracker numbers stay.
 */
export function watchSeedVerify(opts: {
  query: string;
  ctx: SourceContext | null;
  getRows: () => SourceResult[];
  getPending: () => number;
  onApply: (measures: SeedMeasure[]) => void;
  /** Called once when the check finished, was skipped, or failed. `null` means there are no measures. */
  onSettled?: (measures: SeedMeasure[] | null) => void;
  request?: (rows: SourceResult[], query: string, ctx: SourceContext) => Promise<SeedMeasure[] | null>;
  delayMs?: number;
}): SeedWatch {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let started = false;
  let dead = false;
  const delay = opts.delayMs === undefined ? SEED_CHECK_DELAY_MS : opts.delayMs;
  const ask = opts.request || requestSeedCheck;

  function finish(list: SeedMeasure[] | null): void {
    if (dead || started) return;
    started = true;
    if (timer) clearTimeout(timer);
    timer = null;
    if (list && list.length) opts.onApply(list);
    if (opts.onSettled) opts.onSettled(list);
  }

  function start(): void {
    if (dead || started) return;
    const rows = opts.getRows();
    if (!seedCheckAvailable(opts.ctx) || !rows.length) {
      finish(null);
      return;
    }
    started = true;
    if (timer) clearTimeout(timer);
    timer = null;
    ask(rows, opts.query, opts.ctx as SourceContext).then(
      (list) => {
        if (dead) return;
        if (list && list.length) opts.onApply(list);
        if (opts.onSettled) opts.onSettled(list);
      },
      () => {
        if (dead) return;
        if (opts.onSettled) opts.onSettled(null);
      },
    );
  }

  return {
    notify() {
      if (dead || started) return;
      if (!opts.getPending()) {
        start();
        return;
      }
      if (!opts.getRows().length) return;
      if (!seedCheckAvailable(opts.ctx)) {
        finish(null);
        return;
      }
      if (!timer) timer = setTimeout(start, delay);
    },
    cancel() {
      dead = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

// The one queue for search rows. Tests (vitest) get a transport that never touches the network.
import { createScrapeQueue, infohashOf, liveSeedCache, noopTransport, trackerTargets, type ScrapeQueue } from './liveSeeds';
import { platformTransport } from './liveSeedsTransport';
import { resolveRowMagnet } from './rowMagnet';
import type { SourceContext, SourceResult } from './types';

export type ProbeResult =
  | { ok: true; seeders: number; leechers: number }
  | { ok: false; reason: 'nohash' | 'notrackers' | 'timeout'; note?: string };

let probeContext: (() => SourceContext | null) | null = null;

/** Phone (or TV) context used to open a topic page when the list row has no magnet. Null skips that fetch. */
export function setProbeContext(fn: (() => SourceContext | null) | null): void {
  probeContext = fn;
}

function probeReady(r: SourceResult): Promise<ProbeResult> {
  const hash = infohashOf(r);
  if (!hash) return Promise.resolve({ ok: false, reason: 'nohash' });
  const targets = trackerTargets(r.Magnet || '', hash);
  if (!targets.length) return Promise.resolve({ ok: false, reason: 'notrackers' });
  return liveSeeds().check({ hash: hash, trackers: targets, seed: r.Seed || 0, peer: r.Peer || 0 }).then((e) => {
    if (!e.live) return { ok: false, reason: 'timeout' };
    return { ok: true, seeders: e.seeders, leechers: e.leechers };
  });
}

/** One manual check of a release. Does not read the «Актуальные сиды» setting. */
export function probeSeeds(r: SourceResult): Promise<ProbeResult> {
  const ctx = probeContext ? probeContext() : null;
  if (!ctx) return probeReady(r);
  return resolveRowMagnet(r, ctx).then((got) => {
    const hash = infohashOf(got.row);
    const listed = !!hash && trackerTargets(got.row.Magnet || '', hash).length > 0;
    if (got.note && !listed) return { ok: false, reason: 'notrackers', note: got.note };
    return probeReady(got.row);
  });
}

let queue: ScrapeQueue | null = null;

function underTest(): boolean {
  try {
    return !!(import.meta as { env?: { VITEST?: boolean } }).env?.VITEST;
  } catch (e) {
    return false;
  }
}

export function liveSeeds(): ScrapeQueue {
  if (!queue) {
    queue = createScrapeQueue({
      transport: underTest() ? noopTransport() : platformTransport(),
      cache: liveSeedCache,
    });
  }
  return queue;
}

// The one queue for search rows. Tests (vitest) get a transport that never touches the network.
import { createScrapeQueue, infohashOf, liveSeedCache, noopTransport, trackerTargets, type ScrapeQueue } from './liveSeeds';
import { platformTransport } from './liveSeedsTransport';
import type { SourceResult } from './types';

export type ProbeResult =
  | { ok: true; seeders: number; leechers: number }
  | { ok: false; reason: 'nohash' | 'notrackers' | 'timeout' };

/** One manual check of a release. Does not read the «Актуальные сиды» setting. */
export function probeSeeds(r: SourceResult): Promise<ProbeResult> {
  const hash = infohashOf(r);
  if (!hash) return Promise.resolve({ ok: false, reason: 'nohash' });
  const targets = trackerTargets(r.Magnet || '', hash);
  if (!targets.length) return Promise.resolve({ ok: false, reason: 'notrackers' });
  return liveSeeds().check({ hash: hash, trackers: targets, seed: r.Seed || 0, peer: r.Peer || 0 }).then((e) => {
    if (!e.live) return { ok: false, reason: 'timeout' };
    return { ok: true, seeders: e.seeders, leechers: e.leechers };
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

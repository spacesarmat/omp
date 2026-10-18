// The one queue for search rows. Tests (vitest) get a transport that never touches the network.
import { createScrapeQueue, liveSeedCache, noopTransport, type ScrapeQueue } from './liveSeeds';
import { platformTransport } from './liveSeedsTransport';

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

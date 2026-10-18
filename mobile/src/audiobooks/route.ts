// Where a library torrent opens: a book goes to the book card, anything else to the torrent screen.
import { isAudiobookTorrent } from '../../../src/lib/audiobookRoute';
import type { Torrent } from '../../../src/api/types';
import { torrents } from '../../../src/store/library';
import type { MRoute } from '../nav';

export function routeForTorrent(tor: Torrent): MRoute {
  return isAudiobookTorrent(tor) ? { name: 'audiobook', hash: tor.hash } : { name: 'torrent', hash: tor.hash };
}

/** A hash from a catalog tile. The library copy, when it is loaded, decides the screen. */
export function routeForHash(hash: string): MRoute {
  const want = (hash || '').toLowerCase();
  const tor = torrents.peek().find((t) => t.hash.toLowerCase() === want);
  return tor ? routeForTorrent(tor) : { name: 'torrent', hash };
}

import type { TorrServerClient } from '../../../src/api/torrserver';
import { torrents, refreshTorrents } from '../../../src/store/library';
import { pruneEpisodeFindings } from '../../../src/monitor/subs';
import { reloadMonitor } from '../monitor/ui';
import { showToast } from '../ui/toast';
import { t } from '../../../src/i18n';
import { continueWatching } from '../../../src/store/progress';
import type { TorrentFile } from '../../../src/lib/episodes';
import { episodeCopies, seriesSiblings } from '../../../src/lib/episodeProgress';
import { sharedWatched } from './sharedProgress';

/**
 * Where «Смотреть на ТВ» continues: the latest started episode of the torrent, also when it was started in another
 * release of the series (the same SxxEyy here); else the first episode not watched in any release once some are;
 * else the first playable file (none: undefined).
 */
export function watchTarget(hash: string, playable: TorrentFile[]): TorrentFile | undefined {
  const list = torrents.value;
  const recent = continueWatching(list, 1000);
  const tor = list.find((x) => x.hash === hash);
  const siblings = tor ? seriesSiblings(list, tor).map((x) => x.hash) : [hash];
  for (const e of recent) {
    if (e.torrent.hash === hash) {
      const own = playable.find((f) => f.id === e.fileIndex);
      if (own) return own;
      continue;
    }
    if (siblings.indexOf(e.torrent.hash) < 0) continue;
    const same = playable.find((f) =>
      episodeCopies(list, hash, f.id).some((c) => c.hash === e.torrent.hash && c.fileIndex === e.fileIndex),
    );
    if (same) return same;
  }
  if (playable.some((f) => sharedWatched(hash, f.id))) {
    const next = playable.find((f) => !sharedWatched(hash, f.id));
    if (next) return next;
  }
  return playable[0];
}

export interface DeleteResult {
  deleted: string[];
  failed: string[];
  /** the first failure, for a message (the others are only counted) */
  firstError?: unknown;
}

/**
 * Removes the torrents from the server one by one. Never throws: the ones that could not be removed are returned in `failed`.
 * For the removed ones: leaves the local list, drops their «New episodes» cards, one list refresh at the end.
 */
export async function deleteTorrents(c: TorrServerClient, hashes: string[]): Promise<DeleteResult> {
  const deleted: string[] = [];
  const failed: string[] = [];
  let firstError: unknown;
  for (const hash of hashes) {
    try {
      await c.remove(hash);
      deleted.push(hash);
    } catch (e) {
      if (!failed.length) firstError = e;
      failed.push(hash);
    }
  }
  if (deleted.length) {
    const gone = new Set(deleted.map((h) => h.toLowerCase()));
    torrents.value = torrents.value.filter((x) => !gone.has(x.hash.toLowerCase()));
    // their «New episodes» cards can't be replaced any more
    pruneEpisodeFindings((h) => !gone.has(h.toLowerCase()));
    reloadMonitor();
    void refreshTorrents(c).catch(() => {});
  }
  return { deleted, failed, firstError };
}

/** The toast after a delete: the failures win over the count of the removed ones. */
export function reportDeleted(r: DeleteResult): void {
  if (r.failed.length) showToast(t('library.deleteFailed', { n: r.failed.length }));
  else if (r.deleted.length) showToast(t('library.deletedN', { n: r.deleted.length }));
}

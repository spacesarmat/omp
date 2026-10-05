import type { TorrServerClient } from '../../../src/api/torrserver';
import { torrents, refreshTorrents } from '../../../src/store/library';
import { pruneEpisodeFindings } from '../../../src/monitor/subs';
import { reloadMonitor } from '../monitor/ui';
import { showToast } from '../ui/toast';
import { t } from '../../../src/i18n';
import { continueWatching } from '../../../src/store/progress';
import type { TorrentFile } from '../../../src/lib/episodes';

/** Where «Смотреть на ТВ» continues: the latest started file of the torrent, else the first playable one (none: undefined). */
export function watchTarget(hash: string, playable: TorrentFile[]): TorrentFile | undefined {
  const last = continueWatching(torrents.value, 1000).find((e) => e.torrent.hash === hash);
  return (last && playable.find((f) => f.id === last.fileIndex)) || playable[0];
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

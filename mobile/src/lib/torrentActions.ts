import type { TorrServerClient } from '../../../src/api/torrserver';
import { torrents, refreshTorrents } from '../../../src/store/library';
import { pruneEpisodeFindings } from '../../../src/monitor/subs';
import { reloadMonitor } from '../monitor/ui';
import { showToast } from '../ui/toast';
import { t, tp } from '../../../src/i18n';
import { continueWatching } from '../../../src/store/progress';
import type { TorrentFile } from '../../../src/lib/episodes';
import { episodeCopies, isEpisodeFile, seriesSiblings } from '../../../src/lib/episodeProgress';
import { sharedWatched } from './sharedProgress';
import type { Torrent } from '../../../src/api/types';
import { askConfirm } from '../ui/confirm';
import { nowPlaying } from '../tv/playerLink';
import { carryWatch, forgetRemoved, pickKeeper } from '../../../src/store/releaseCarry';

/**
 * Where «Смотреть на ТВ» continues: the latest started episode of the torrent, also when it was started in another
 * release of the series (the same SxxEyy here), unless a newer copy says it is watched; else, when some episodes
 * (SxxEyy files) are watched in any release, the next one not watched after the last watched (at the end, the first
 * one skipped); else the first playable file (none: undefined).
 */
export function watchTarget(hash: string, playable: TorrentFile[]): TorrentFile | undefined {
  const list = torrents.value;
  const recent = continueWatching(list, 1000);
  const tor = list.find((x) => x.hash === hash);
  const siblings = tor ? seriesSiblings(list, tor).map((x) => x.hash) : [hash];
  for (const e of recent) {
    let f: TorrentFile | undefined;
    if (e.torrent.hash === hash) f = playable.find((x) => x.id === e.fileIndex);
    else if (siblings.indexOf(e.torrent.hash) >= 0) {
      f = playable.find((x) =>
        episodeCopies(list, hash, x.id).some((c) => c.hash === e.torrent.hash && c.fileIndex === e.fileIndex),
      );
    }
    // a newer copy finished it: not a place to continue
    if (f && !sharedWatched(hash, f.id)) return f;
  }
  const episodes = playable.filter((f) => isEpisodeFile(list, hash, f.id));
  const watched = episodes.map((f) => sharedWatched(hash, f.id));
  const last = watched.lastIndexOf(true);
  if (last >= 0) {
    // the episode after the last one watched; at the end of the list, the first one skipped
    const next = episodes.filter((_, i) => i > last && !watched[i])[0] || episodes.filter((_, i) => !watched[i])[0];
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

/**
 * The trash on a release in «Другая раздача» / «Раздачи (N)»: `tor` goes, what was watched in it moves to the one that
 * stays first (src/store/releaseCarry). `rows`: the releases of the season (of the film), `current` the one shown now.
 * The release playing on the TV is never removed; removing the one shown says so and the watching goes on in the one
 * that stays. Resolves with the one that stays when `tor` was removed, else null (cancelled or failed, said in a toast).
 */
export async function deleteRelease(
  c: TorrServerClient,
  p: { tor: Torrent; rows: Torrent[]; current: string; season: number; name: (x: Torrent) => string },
): Promise<Torrent | null> {
  // one at a time: two deletes in flight could each keep the release the other one removes
  if (releaseDeleting) {
    showToast(t('series.releaseDeleteBusy'));
    return null;
  }
  if (isPlayingOnTv(p.tor.hash)) {
    showToast(t('series.releaseDeletePlaying'));
    return null;
  }
  const isCurrent = p.tor.hash === p.current;
  const keeper = isCurrent ? pickKeeper(p.rows, p.tor) : p.rows.filter((r) => r.hash === p.current)[0] || pickKeeper(p.rows, p.tor);
  if (!keeper) return null;
  const vars = { name: p.name(p.tor), keeper: p.name(keeper) };
  const ask = isCurrent ? t('series.releaseDeleteCurrentAsk', vars) : t('series.releaseDeleteAsk', vars);
  if (!(await askConfirm(ask, t('common.delete'), { destructive: true, testId: 'PD57' }))) return null;
  if (releaseDeleting) {
    showToast(t('series.releaseDeleteBusy'));
    return null;
  }
  releaseDeleting = true;
  try {
    let carried = await carryWatch(c, p.tor, keeper, p.season);
    if (!carried.ok && carried.lost) {
      const lossAsk = tp('series.releaseDeleteLossAsk', carried.lost, { keeper: vars.keeper });
      if (!(await askConfirm(lossAsk, t('common.delete'), { destructive: true, testId: 'PD57' }))) return null;
      carried = await carryWatch(c, p.tor, keeper, p.season, { allowLoss: true });
    }
    if (!carried.ok) {
      showToast(t('series.releaseCarryFailed'));
      return null;
    }
    // the one that stays must still be there, and the one that goes must not have started on the TV meanwhile
    if (!torrents.value.some((x) => x.hash === keeper.hash)) {
      showToast(t('series.releaseCarryFailed'));
      return null;
    }
    if (isPlayingOnTv(p.tor.hash)) {
      showToast(t('series.releaseDeletePlaying'));
      return null;
    }
    const r = await deleteTorrents(c, [p.tor.hash]);
    if (!r.deleted.length) {
      reportDeleted(r);
      return null;
    }
    forgetRemoved(p.tor.hash);
    showToast(t('series.releaseDeleted'));
    return keeper;
  } finally {
    releaseDeleting = false;
  }
}

let releaseDeleting = false;

function isPlayingOnTv(hash: string): boolean {
  const playing = nowPlaying.value;
  return !!playing && playing.hash.toLowerCase() === hash.toLowerCase();
}

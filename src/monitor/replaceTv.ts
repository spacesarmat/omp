// «Заменить» on the TV: one sequence for «В лучшем качестве» (BetterDialog) and the «Новое» tab. The release replaces
// the torrent in place (replaceWithResult), this TV's watch positions move to the new files (carryProgress) and the
// library list is refreshed. Chromium 53 safe.
import type { TorrServerClient } from '../api/torrserver';
import type { TorrentFile } from '../lib/episodes';
import { torrents, refreshTorrents } from '../store/library';
import { tvSourceContext } from '../sources/tvContext';
import type { SourceResult } from '../sources/types';
import { t } from '../i18n';
import { replaceWithResult, type ReplaceAbort, type ReplaceResult } from './replace';
import { carryProgress } from './upgrade';

const FILES_TIMEOUT_MS = 10000;
/** The longest the TV waits for a replace before it gives up as a timeout. */
export const TV_REPLACE_WAIT_MS = 45000;

function sameHash(a: string, b: string): boolean {
  return (a || '').toLowerCase() === (b || '').toLowerCase();
}

/** The files of a torrent: from the listed one when it has them, else asked of TorrServer (at most 10 s, [] on failure). */
export function torrentFilesOf(c: TorrServerClient, hash: string): Promise<TorrentFile[]> {
  const listed = torrents.value.filter((x) => sameHash(x.hash, hash))[0];
  if (listed && c.files(listed).length) return Promise.resolve(c.files(listed));
  return new Promise<TorrentFile[]>((resolve) => {
    const timer = setTimeout(() => resolve([]), FILES_TIMEOUT_MS);
    c.loadInfo(hash).then(
      (i) => {
        clearTimeout(timer);
        resolve(c.files(i));
      },
      () => {
        clearTimeout(timer);
        resolve([]);
      },
    );
  });
}

/**
 * Replaces `oldHash` with the release `r`. `oldFiles` are the old torrent's files (this TV's positions are keyed by
 * file index); null asks for them first, while the old torrent is still there. Never rejects.
 */
export function replaceOnTv(
  c: TorrServerClient,
  oldHash: string,
  oldFiles: TorrentFile[] | null,
  r: SourceResult,
  abort?: ReplaceAbort,
): Promise<ReplaceResult> {
  const files: Promise<TorrentFile[]> = oldFiles ? Promise.resolve(oldFiles) : torrentFilesOf(c, oldHash);
  return files.then((old) =>
    replaceWithResult(c, oldHash, r, tvSourceContext(), {
      abort: abort,
      timeoutMs: TV_REPLACE_WAIT_MS,
      deadlineMs: TV_REPLACE_WAIT_MS,
    })
      .catch((): ReplaceResult => ({ ok: false, error: t('monitor.replace.failed') }))
      .then((res) => {
        if (!res.ok) {
          if (res.cause === 'both') void refreshTorrents(c).catch(() => undefined);
          return res;
        }
        return torrentFilesOf(c, res.hash).then((fresh) => {
          try {
            carryProgress(oldHash, old, res.hash, fresh);
          } catch (e) {
            // the replace itself is done: losing the positions must not fail it
            console.warn('carryProgress failed', e);
          }
          void refreshTorrents(c).catch(() => undefined);
          return res;
        });
      }),
  );
}

/** The same with a link already in hand (the phone gave it): no source is asked again. */
export function replaceWithLink(
  c: TorrServerClient,
  oldHash: string,
  r: SourceResult,
  link: string,
  abort?: ReplaceAbort,
): Promise<ReplaceResult> {
  return replaceOnTv(c, oldHash, null, { ...r, Magnet: link }, abort);
}
